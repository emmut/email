import { useEffect, useRef, useState } from "react";
import {
  Archive,
  MailOpen,
  MailX,
  Search,
  SquarePen,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { MailSidebar } from "@/components/mail/mail-sidebar";
import {
  ComposeDialog,
  type ComposeDraft,
} from "@/components/mail/compose";
import { MailList } from "@/components/mail/mail-list";
import { MailDisplay } from "@/components/mail/mail-display";
import type { Mail as MailItem } from "@/components/mail/data";
import { ShortcutsHelp } from "@/components/mail/shortcuts-help";
import { CommandPalette } from "@/components/mail/command-palette";
import { useKeyboardShortcuts } from "@/hooks/use-shortcuts";
import { noDialogOpen, useMenuEvents } from "@/hooks/use-menu";
import { folders } from "@/components/mail/data";
import { useMailActions, type MailAction } from "@/hooks/use-mail-actions";
import {
  emptyTrash,
  gmailCachedListQuery,
  mailListQuery,
  tagIdFromFolder,
  tagsQuery,
  useGmailSync,
} from "@/lib/gmail";
import {
  ICLOUD_FOLDER_NAMES,
  icloudEmptyFolder,
  icloudFolderName,
  icloudLocalMessagesQuery,
  icloudMailboxFromFolder,
  icloudMessagesQuery,
  icloudSearchQuery,
  toMail,
} from "@/lib/icloud";
import { useAccount } from "@/context/AccountContext";
import { useOfflineQueue } from "@/lib/offline";

export function Mail() {
  const [activeFolder, setActiveFolder] = useState("inbox");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [composeDraft, setComposeDraft] = useState<ComposeDraft | null>(null);
  // Emails read while the unread tab is open stay listed until the view changes
  const [keptReadIds, setKeptReadIds] = useState<Set<string>>(new Set());
  const [helpOpen, setHelpOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Multi-select (checkboxes, Cmd/Ctrl+click); bulk actions act on the set.
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [confirmDeleteChecked, setConfirmDeleteChecked] = useState(false);
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false);
  const checkAnchor = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const { activeAccount } = useAccount();
  const isIcloud = activeAccount?.kind === "icloud";
  const inTrash = activeFolder === "trash";

  useGmailSync(!isIcloud);
  useOfflineQueue();

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const gmailList = mailListQuery(activeFolder, debouncedSearch);
  const gmailQuery = useQuery({ ...gmailList, enabled: !isIcloud });
  // Cached copy of the folder painted while the network listing loads.
  const gmailLocal = useQuery({
    ...gmailCachedListQuery(activeFolder),
    enabled: !isIcloud && !debouncedSearch,
  });
  const icloudList = icloudMessagesQuery(
    activeAccount?.id ?? "",
    icloudFolderName(activeFolder),
  );
  const icloudQuery = useQuery({
    ...icloudList,
    enabled: isIcloud,
    select: (msgs) => msgs.map(toMail),
  });
  const icloudLocal = useQuery({
    ...icloudLocalMessagesQuery(
      activeAccount?.id ?? "",
      icloudFolderName(activeFolder),
    ),
    enabled: isIcloud,
    select: (msgs) => msgs.map(toMail),
  });
  // Server-side full-mailbox search; the client filter over the cached page
  // stands in while it loads (or offline).
  const icloudSearch = useQuery({
    ...icloudSearchQuery(
      activeAccount?.id ?? "",
      icloudFolderName(activeFolder),
      debouncedSearch,
    ),
    enabled: isIcloud && !!debouncedSearch,
    select: (msgs) => msgs.map(toMail),
  });

  const matchesSearch = (m: MailItem) => {
    const q = debouncedSearch.toLowerCase();
    return [m.name, m.email, m.subject, m.text].some((s) =>
      s.toLowerCase().includes(q),
    );
  };
  const networkQuery = isIcloud
    ? debouncedSearch
      ? icloudSearch
      : icloudQuery
    : gmailQuery;
  // Cache is a fallback, not truth: only stand in while the network query has
  // nothing, and only if it actually holds messages.
  let listData: MailItem[] | undefined;
  if (isIcloud) {
    const cached = icloudQuery.data ?? icloudLocal.data;
    listData = debouncedSearch
      ? (icloudSearch.data ?? cached?.filter(matchesSearch))
      : (icloudQuery.data ?? (icloudLocal.data?.length ? icloudLocal.data : undefined));
  } else {
    listData =
      gmailQuery.data ??
      (!debouncedSearch && gmailLocal.data?.length
        ? gmailLocal.data
        : undefined);
  }
  const mails = listData;
  const isPending = networkQuery.isPending && listData === undefined;
  const isError = networkQuery.isError && listData === undefined;
  const { error, refetch } = networkQuery;

  // Shared optimistic mail actions (provider-aware: Gmail or iCloud).
  const { act } = useMailActions();

  const queryClient = useQueryClient();
  const emptyTrashMutation = useMutation({
    mutationFn: () =>
      isIcloud && activeAccount
        ? icloudEmptyFolder(activeAccount.id, ICLOUD_FOLDER_NAMES.trash)
        : emptyTrash(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail"] });
      queryClient.invalidateQueries({ queryKey: ["icloud"] });
      setSelectedId(null);
      setCheckedIds(new Set());
    },
  });

  const selectFolder = (folder: string) => {
    setActiveFolder(folder);
    setSelectedId(null);
    setKeptReadIds(new Set());
    setCheckedIds(new Set());
  };

  const selectMail = (id: string) => {
    setSelectedId(id);
    const mail = mails?.find((m) => m.id === id);
    if (mail && !mail.read) {
      if (tab === "unread") {
        setKeptReadIds((prev) => new Set(prev).add(id));
      }
      act("read", id);
    }
  };

  const items = (mails ?? []).filter(
    (m) => tab === "all" || !m.read || keptReadIds.has(m.id),
  );
  const selected = mails?.find((m) => m.id === selectedId) ?? null;

  // Checkbox/Cmd+click toggles one; Shift+click extends from the last toggle.
  const toggleCheck = (id: string, range: boolean) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      const anchor = checkAnchor.current;
      if (range && anchor) {
        const a = items.findIndex((m) => m.id === anchor);
        const b = items.findIndex((m) => m.id === id);
        if (a !== -1 && b !== -1) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++)
            next.add(items[i].id);
          return next;
        }
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    checkAnchor.current = id;
  };

  // Read/unread keeps the selection (chainable); archive/trash consumes it.
  const actChecked = (action: MailAction) => {
    if (action === "read" && tab === "unread") {
      setKeptReadIds((prev) => new Set([...prev, ...checkedIds]));
    }
    for (const id of checkedIds) act(action, id);
    if (action !== "read" && action !== "unread") setCheckedIds(new Set());
  };

  const { data: tags } = useQuery({ ...tagsQuery, enabled: !isIcloud });
  const activeTagId = tagIdFromFolder(activeFolder);
  const title = activeTagId
    ? (tags?.find((t) => t.id === activeTagId)?.name ?? "Tag")
    : (icloudMailboxFromFolder(activeFolder) ?? activeFolder);

  const moveSelection = (delta: number) => {
    if (!items.length) return;
    const index = items.findIndex((m) => m.id === selectedId);
    const next =
      index === -1
        ? delta > 0
          ? 0
          : items.length - 1
        : Math.min(items.length - 1, Math.max(0, index + delta));
    selectMail(items[next].id);
  };

  useKeyboardShortcuts({
    c: () => setComposeDraft({}),
    j: () => moveSelection(1),
    k: () => moveSelection(-1),
    "/": () => searchRef.current?.focus(),
    u: () => {
      if (checkedIds.size) actChecked("unread");
      else if (selected?.read) act("unread", selected.id);
    },
    i: () => {
      if (checkedIds.size) actChecked("read");
      else if (selected && !selected.read) act("read", selected.id);
    },
    Escape: () => {
      if (checkedIds.size) setCheckedIds(new Set());
      else setSelectedId(null);
    },
    "?": () => setHelpOpen(true),
  });

  // Native menu commands (File/Go/Message/Help). Reply and Reply All are
  // handled in MailDisplay, the palette toggle in CommandPalette.
  useMenuEvents({
    compose: () => noDialogOpen() && setComposeDraft({}),
    shortcuts: () => setHelpOpen(true),
    undo: () => document.execCommand("undo"),
    redo: () => document.execCommand("redo"),
    archive: () =>
      noDialogOpen() && selected && act("archive", selected.id),
    // "trash" is handled in MailDisplay (it owns the permanent-delete confirm).
    toggle_read: () =>
      noDialogOpen() &&
      selected &&
      act(selected.read ? "unread" : "read", selected.id),
    ...Object.fromEntries(
      folders.map((f) => [`go_${f.id}`, () => selectFolder(f.id)]),
    ),
  });

  return (
    <SidebarProvider>
      <MailSidebar activeFolder={activeFolder} onSelectFolder={selectFolder} />
      <SidebarInset className="h-screen overflow-hidden">
        <Tabs
          value={tab}
          onValueChange={(v) => {
            setTab(v as "all" | "unread");
            setKeptReadIds(new Set());
            setCheckedIds(new Set());
          }}
          className="flex h-full flex-col gap-0"
        >
          <header
            data-tauri-drag-region
            className="flex items-center gap-2 px-4 py-2"
          >
            <SidebarTrigger />
            <h1 className="text-xl font-bold capitalize">{title}</h1>
            <Button
              variant="outline"
              size="sm"
              className="ml-2"
              onClick={() => setComposeDraft({})}
            >
              <SquarePen className="size-4" />
              Compose
              <Kbd>C</Kbd>
            </Button>
            {inTrash && (
              <Button
                variant="outline"
                size="sm"
                disabled={emptyTrashMutation.isPending || !items.length}
                onClick={() => setConfirmEmptyTrash(true)}
              >
                <Trash2 className="size-4" />
                {emptyTrashMutation.isPending ? "Emptying…" : "Empty trash"}
              </Button>
            )}
            <TabsList className="ml-auto">
              <TabsTrigger value="all">All mail</TabsTrigger>
              <TabsTrigger value="unread">Unread</TabsTrigger>
            </TabsList>
          </header>
          <Separator />
          <div className="bg-background/95 p-4">
            <div className="relative">
              <Search className="text-muted-foreground absolute top-2.5 left-2 size-4" />
              <Input
                ref={searchRef}
                placeholder="Search"
                className="pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") e.currentTarget.blur();
                }}
              />
            </div>
          </div>
          <Separator />
          <ResizablePanelGroup orientation="horizontal" className="flex-1">
            <ResizablePanel defaultSize="40%" minSize="30%">
              <div className="flex h-full flex-col">
              {checkedIds.size > 0 && (
                <>
                  <div className="flex items-center gap-1 px-4 py-1">
                    <span className="text-sm font-medium">
                      {checkedIds.size} selected
                    </span>
                    <div className="ml-auto flex items-center">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => actChecked("archive")}
                          >
                            <Archive className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Archive</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() =>
                              inTrash
                                ? setConfirmDeleteChecked(true)
                                : actChecked("trash")
                            }
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          {inTrash ? "Delete permanently" : "Move to trash"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => actChecked("read")}
                          >
                            <MailOpen className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Mark as read <Kbd>i</Kbd>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => actChecked("unread")}
                          >
                            <MailX className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Mark as unread <Kbd>u</Kbd>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setCheckedIds(new Set())}
                          >
                            <X className="size-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Clear selection <Kbd>Esc</Kbd>
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                  <Separator />
                </>
              )}
              <div className="min-h-0 flex-1">
              {isPending ? (
                <MailListSkeleton />
              ) : isError ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-sm">
                  <p className="text-muted-foreground">
                    Failed to load mail: {error?.message}
                  </p>
                  <Button variant="outline" size="sm" onClick={() => refetch()}>
                    Retry
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
                  No messages
                </div>
              ) : (
                <MailList
                  items={items}
                  selectedId={selectedId}
                  onSelect={selectMail}
                  checkedIds={checkedIds}
                  onToggleCheck={toggleCheck}
                  inTrash={inTrash}
                />
              )}
              </div>
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="60%" minSize="30%">
              <MailDisplay
                mail={selected}
                inTrash={inTrash}
                onDismiss={() => setSelectedId(null)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </Tabs>
        <ComposeDialog
          draft={composeDraft}
          onClose={() => setComposeDraft(null)}
        />
        <AlertDialog
          open={confirmDeleteChecked}
          onOpenChange={setConfirmDeleteChecked}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                {checkedIds.size} message{checkedIds.size === 1 ? " is" : "s are"}{" "}
                deleted forever. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => actChecked("delete")}>
                Delete permanently
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog
          open={confirmEmptyTrash}
          onOpenChange={setConfirmEmptyTrash}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Empty trash?</AlertDialogTitle>
              <AlertDialogDescription>
                Every message in Trash is deleted forever. This cannot be
                undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => emptyTrashMutation.mutate()}>
                Empty trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
        <CommandPalette
          open={paletteOpen}
          onOpenChange={setPaletteOpen}
          selected={selected}
          onSelectFolder={selectFolder}
          onCompose={() => setComposeDraft({})}
          // Wait out the dialog's close (Radix restores focus on unmount).
          onFocusSearch={() => setTimeout(() => searchRef.current?.focus(), 250)}
          onShowShortcuts={() => setHelpOpen(true)}
          onSetTab={(t) => {
            setTab(t);
            setKeptReadIds(new Set());
            setCheckedIds(new Set());
          }}
          onAct={act}
          onEmptyTrash={() => setConfirmEmptyTrash(true)}
        />
      </SidebarInset>
    </SidebarProvider>
  );
}

function MailListSkeleton() {
  return (
    <div className="flex flex-col gap-2 p-4 pt-4">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-lg border p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-16" />
          </div>
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-full" />
        </div>
      ))}
    </div>
  );
}
