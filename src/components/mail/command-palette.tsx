import { useEffect, useRef } from "react";

import { useMenuEvents } from "@/hooks/use-menu";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveX,
  File,
  Inbox,
  Keyboard,
  Mail as MailIcon,
  MailOpen,
  RefreshCw,
  Search,
  Send,
  SquarePen,
  Tag as TagIcon,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { folders, type Mail } from "@/components/mail/data";
import type { MailAction } from "@/hooks/use-mail-actions";
import { tagFolderId, tagsQuery } from "@/lib/gmail";
import { useAccount } from "@/context/AccountContext";

const FOLDER_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  file: File,
  send: Send,
  "archive-x": ArchiveX,
  trash2: Trash2,
  archive: Archive,
};

export function CommandPalette({
  open,
  onOpenChange,
  selected,
  onSelectFolder,
  onCompose,
  onFocusSearch,
  onShowShortcuts,
  onSetTab,
  onAct,
  onEmptyTrash,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selected: Mail | null;
  onSelectFolder: (id: string) => void;
  onCompose: () => void;
  onFocusSearch: () => void;
  onShowShortcuts: () => void;
  onSetTab: (tab: "all" | "unread") => void;
  onAct: (action: MailAction, id: string) => void;
  onEmptyTrash: () => void;
}) {
  const queryClient = useQueryClient();
  const { accounts, activeAccount, activeAccountId, switchAccount } =
    useAccount();
  const isIcloud = activeAccount?.kind === "icloud";
  const { data: tags } = useQuery({ ...tagsQuery, enabled: open && !isIcloud });

  // Cmd/Ctrl+P arrives twice when the native menu accelerator fires AND the
  // key event still reaches the webview (platform-dependent) — debounce so
  // the palette doesn't toggle twice and end up where it started.
  const lastToggle = useRef(0);
  const toggle = () => {
    const now = Date.now();
    if (now - lastToggle.current < 300) return;
    lastToggle.current = now;
    onOpenChange(!open);
  };
  const toggleRef = useRef(toggle);
  toggleRef.current = toggle;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "p" && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        toggleRef.current();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Native "View → Command Palette…" menu item.
  useMenuEvents({ command_palette: () => toggle() });

  const run = (fn: () => void) => () => {
    onOpenChange(false);
    fn();
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["gmail"] });
    queryClient.invalidateQueries({ queryKey: ["icloud"] });
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      {/* This registry's CommandDialog doesn't include the cmdk root itself. */}
      <Command>
        <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={run(onCompose)}>
            <SquarePen />
            Compose
            <CommandShortcut>C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(onFocusSearch)}>
            <Search />
            Search mail
            <CommandShortcut>/</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={run(refresh)}>
            <RefreshCw />
            Refresh
          </CommandItem>
          <CommandItem value="empty trash" onSelect={run(onEmptyTrash)}>
            <Trash2 />
            Empty trash
          </CommandItem>
          <CommandItem onSelect={run(onShowShortcuts)}>
            <Keyboard />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        {selected && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Message">
              <CommandItem onSelect={run(() => onAct("archive", selected.id))}>
                <Archive />
                Archive
                <CommandShortcut>E</CommandShortcut>
              </CommandItem>
              <CommandItem onSelect={run(() => onAct("trash", selected.id))}>
                <Trash2 />
                Move to trash
                <CommandShortcut>#</CommandShortcut>
              </CommandItem>
              {selected.read ? (
                <CommandItem onSelect={run(() => onAct("unread", selected.id))}>
                  <MailIcon />
                  Mark as unread
                  <CommandShortcut>U</CommandShortcut>
                </CommandItem>
              ) : (
                <CommandItem onSelect={run(() => onAct("read", selected.id))}>
                  <MailOpen />
                  Mark as read
                  <CommandShortcut>I</CommandShortcut>
                </CommandItem>
              )}
            </CommandGroup>
          </>
        )}
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {folders.map((folder) => {
            const Icon = FOLDER_ICONS[folder.icon] ?? Inbox;
            return (
              <CommandItem
                key={folder.id}
                value={`go to ${folder.label}`}
                onSelect={run(() => onSelectFolder(folder.id))}
              >
                <Icon />
                {folder.label}
              </CommandItem>
            );
          })}
          {/* Same guard as the list: disabled queries still return cached
              Gmail tags after switching to an iCloud account. */}
          {(isIcloud ? [] : (tags ?? [])).map((tag) => (
            <CommandItem
              key={tag.id}
              value={`go to tag ${tag.name}`}
              onSelect={run(() => onSelectFolder(tagFolderId(tag.id)))}
            >
              <TagIcon />
              {tag.name}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="View">
          <CommandItem
            value="show all mail"
            onSelect={run(() => onSetTab("all"))}
          >
            <MailIcon />
            Show all mail
          </CommandItem>
          <CommandItem
            value="show unread only"
            onSelect={run(() => onSetTab("unread"))}
          >
            <MailOpen />
            Show unread only
          </CommandItem>
        </CommandGroup>
        {accounts.length > 1 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Accounts">
              {accounts.map((acc) => (
                <CommandItem
                  key={acc.id}
                  value={`switch account ${acc.email}`}
                  disabled={acc.id === activeAccountId}
                  onSelect={run(() => switchAccount(acc.id))}
                >
                  <UserRound />
                  {acc.email}
                  <CommandShortcut className="tracking-normal">
                    {acc.kind === "google" ? "Google" : "iCloud"}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
