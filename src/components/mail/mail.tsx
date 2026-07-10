import { useEffect, useRef, useState } from "react";
import { Search, SquarePen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
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
import { useMailActions } from "@/hooks/use-mail-actions";
import {
  gmailCachedListQuery,
  mailListQuery,
  tagIdFromFolder,
  tagsQuery,
  useGmailSync,
} from "@/lib/gmail";
import {
  icloudFolderName,
  icloudLocalMessagesQuery,
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
  const searchRef = useRef<HTMLInputElement>(null);

  const { activeAccount } = useAccount();
  const isIcloud = activeAccount?.kind === "icloud";

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

  const selectFolder = (folder: string) => {
    setActiveFolder(folder);
    setSelectedId(null);
    setKeptReadIds(new Set());
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

  const { data: tags } = useQuery({ ...tagsQuery, enabled: !isIcloud });
  const activeTagId = tagIdFromFolder(activeFolder);
  const title = activeTagId
    ? (tags?.find((t) => t.id === activeTagId)?.name ?? "Tag")
    : activeFolder;

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
    u: () => setSelectedId(null),
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
    trash: () => noDialogOpen() && selected && act("trash", selected.id),
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
                />
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize="60%" minSize="30%">
              <MailDisplay
                mail={selected}
                onDismiss={() => setSelectedId(null)}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </Tabs>
        <ComposeDialog
          draft={composeDraft}
          onClose={() => setComposeDraft(null)}
        />
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
          }}
          onAct={act}
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
