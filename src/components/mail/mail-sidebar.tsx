import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Archive,
  ArchiveX,
  ChevronsUpDown,
  File,
  Folder,
  Inbox,
  LogOut,
  Plus,
  Send,
  Settings,
  Tag as TagIcon,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { folders } from "@/components/mail/data";
import { useAccount } from "@/context/AccountContext";
import { cn, initialsFromEmail, isMac } from "@/lib/utils";
import {
  avatarQuery,
  clearGmailCache,
  createTag,
  deleteTag,
  folderCountsQuery,
  profileQuery,
  tagFolderId,
  tagsQuery,
  type Tag,
} from "@/lib/gmail";
import {
  icloudAvatarQuery,
  icloudCreateFolder,
  icloudCustomFolderId,
  icloudDeleteFolder,
  icloudFolderCountsQuery,
  icloudFoldersQuery,
} from "@/lib/icloud";
import { pendingOpsQuery, useOnline } from "@/lib/offline";
import { invoke } from "@tauri-apps/api/core";
import { CloudOff } from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  file: File,
  send: Send,
  "archive-x": ArchiveX,
  trash2: Trash2,
  archive: Archive,
};

export function MailSidebar({
  activeFolder,
  onSelectFolder,
}: {
  activeFolder: string;
  onSelectFolder: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const {
    accounts,
    activeAccount,
    activeAccountId,
    switchAccount,
    removeAccount,
    isLoading,
  } = useAccount();
  const isIcloud = activeAccount?.kind === "icloud";
  const { data: profile } = useQuery({ ...profileQuery, enabled: !isIcloud });
  const { data: gmailCounts } = useQuery({
    ...folderCountsQuery,
    enabled: !isIcloud,
  });
  const { data: icloudCounts } = useQuery({
    ...icloudFolderCountsQuery(activeAccount?.id ?? ""),
    enabled: isIcloud,
  });
  const counts = isIcloud ? icloudCounts : gmailCounts;
  const { data: tags } = useQuery({ ...tagsQuery, enabled: !isIcloud });
  const { data: icloudFolders } = useQuery({
    ...icloudFoldersQuery(activeAccount?.id ?? ""),
    enabled: isIcloud,
  });
  const { data: gmailAvatar } = useQuery({
    ...avatarQuery,
    enabled: !isIcloud,
  });
  const { data: icloudAvatar } = useQuery({
    ...icloudAvatarQuery(activeAccount?.email ?? ""),
    enabled: isIcloud,
  });
  const avatar = isIcloud ? icloudAvatar : gmailAvatar;
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [deleteFolderTarget, setDeleteFolderTarget] = useState<string | null>(
    null,
  );
  const online = useOnline();
  const { data: pendingOps } = useQuery(pendingOpsQuery);
  const pendingCount = pendingOps?.length ?? 0;
  const navigate = useNavigate();

  const createTagMutation = useMutation({
    mutationFn: createTag,
    onSuccess: (tag) => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "tags"] });
      setNewTagOpen(false);
      setNewTagName("");
      onSelectFolder(tagFolderId(tag.id));
    },
  });

  const deleteTagMutation = useMutation({
    mutationFn: (tag: Tag) => deleteTag(tag.id),
    onSuccess: (_data, tag) => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "tags"] });
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      if (activeFolder === tagFolderId(tag.id)) onSelectFolder("inbox");
    },
  });

  const createFolderMutation = useMutation({
    mutationFn: (name: string) =>
      icloudCreateFolder(activeAccount?.id ?? "", name),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({
        queryKey: ["icloud", activeAccount?.id, "folders"],
      });
      setNewFolderOpen(false);
      setNewFolderName("");
      onSelectFolder(icloudCustomFolderId(name));
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: (name: string) =>
      icloudDeleteFolder(activeAccount?.id ?? "", name),
    onSuccess: (_data, name) => {
      queryClient.invalidateQueries({
        queryKey: ["icloud", activeAccount?.id, "folders"],
      });
      if (activeFolder === icloudCustomFolderId(name)) onSelectFolder("inbox");
    },
  });

  const signOutMutation = useMutation({
    mutationFn: async () => {
      if (activeAccount) {
        const lastGoogle =
          activeAccount.kind === "google" &&
          accounts.filter((a) => a.kind === "google").length === 1;
        await removeAccount(activeAccount.id);
        // The legacy keychain token belongs to the first Google account —
        // clear it (and the local Gmail cache) when the last one goes away.
        if (lastGoogle) {
          await invoke("sign_out");
          await clearGmailCache();
        }
      } else {
        // Legacy Google sign-in with no account row.
        await invoke("sign_out");
        await clearGmailCache();
      }
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["gmail"] });
      queryClient.removeQueries({ queryKey: ["icloud"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const email = activeAccount?.email ?? profile?.emailAddress;

  if (isLoading) {
    return (
      <Sidebar collapsible="icon">
        <SidebarHeader data-tauri-drag-region className={cn(isMac && "pt-8")}>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-muted animate-pulse" />
                  <div className="h-4 w-24 bg-muted animate-pulse rounded" />
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader data-tauri-drag-region className={cn(isMac && "pt-8")}>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton size="lg" tooltip="Account">
                    <Avatar className="size-8 rounded-lg">
                      {avatar && <AvatarImage src={avatar} alt="" />}
                      <AvatarFallback className="bg-primary text-primary-foreground rounded-lg">
                        {email ? initialsFromEmail(email) : "…"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">
                        {email ? email.split("@")[0] : "Loading…"}
                      </span>
                      <span className="text-muted-foreground truncate text-xs">
                        {email ?? ""}
                      </span>
                    </div>
                    <ChevronsUpDown className="ml-auto size-4" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent align="start" className="w-64">
                {/* Account switcher */}
                <div className="p-2 border-b">
                  <div className="px-2 py-1 text-xs text-muted-foreground uppercase">
                    Accounts
                  </div>
                  {accounts.map((acc) => (
                    <DropdownMenuItem
                      key={acc.id}
                      onClick={() => switchAccount(acc.id)}
                      className={
                        acc.id === activeAccountId
                          ? "bg-accent font-medium"
                          : ""
                      }
                    >
                      <span className="flex items-center gap-2 w-full">
                        <span className="text-xs uppercase text-muted-foreground">
                          {acc.kind === "google" ? "Google" : "iCloud"}
                        </span>
                        <span className="truncate">{acc.email}</span>
                        {acc.is_default && (
                          <Badge
                            variant="outline"
                            className="ml-auto shrink-0 font-normal"
                            title="Opens at launch"
                          >
                            Default
                          </Badge>
                        )}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </div>
                <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                  <Settings className="size-4" />
                  Settings…
                  <DropdownMenuShortcut>
                    {isMac ? "⌘," : "Ctrl+,"}
                  </DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={signOutMutation.isPending}
                  onClick={() => signOutMutation.mutate()}
                >
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {folders.map((folder) => {
              const Icon = ICONS[folder.icon] ?? Inbox;
              const count = counts?.[folder.id];
              return (
                <SidebarMenuItem key={folder.id}>
                  <SidebarMenuButton
                    tooltip={folder.label}
                    isActive={folder.id === activeFolder}
                    onClick={() => onSelectFolder(folder.id)}
                  >
                    <Icon />
                    <span>{folder.label}</span>
                  </SidebarMenuButton>
                  {count ? <SidebarMenuBadge>{count}</SidebarMenuBadge> : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        {!isIcloud && (
          <SidebarGroup>
            <SidebarGroupLabel>Tags</SidebarGroupLabel>
            <SidebarGroupAction
              title="New tag"
              onClick={() => setNewTagOpen(true)}
            >
              <Plus />
            </SidebarGroupAction>
            <SidebarMenu>
              {(tags ?? []).map((tag) => {
                const folderId = tagFolderId(tag.id);
                return (
                  <SidebarMenuItem key={tag.id}>
                    <ContextMenu>
                      <ContextMenuTrigger
                        render={
                          <SidebarMenuButton
                            tooltip={tag.name}
                            isActive={folderId === activeFolder}
                            onClick={() => onSelectFolder(folderId)}
                          >
                            <TagIcon />
                            <span>{tag.name}</span>
                          </SidebarMenuButton>
                        }
                      />
                      <ContextMenuContent>
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => setDeleteTarget(tag)}
                        >
                          <Trash2 />
                          Delete tag
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {isIcloud && (
          <SidebarGroup>
            <SidebarGroupLabel>Folders</SidebarGroupLabel>
            <SidebarGroupAction
              title="New folder"
              onClick={() => setNewFolderOpen(true)}
            >
              <Plus />
            </SidebarGroupAction>
            <SidebarMenu>
              {(icloudFolders ?? []).map((name) => {
                const folderId = icloudCustomFolderId(name);
                return (
                  <SidebarMenuItem key={name}>
                    <ContextMenu>
                      <ContextMenuTrigger
                        render={
                          <SidebarMenuButton
                            tooltip={name}
                            isActive={folderId === activeFolder}
                            onClick={() => onSelectFolder(folderId)}
                          >
                            <Folder />
                            <span>{name}</span>
                          </SidebarMenuButton>
                        }
                      />
                      <ContextMenuContent>
                        <ContextMenuItem
                          variant="destructive"
                          onClick={() => setDeleteFolderTarget(name)}
                        >
                          <Trash2 />
                          Delete folder
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        )}
        {(!online || pendingCount > 0) && (
          <SidebarGroup className="mt-auto">
            <div className="text-muted-foreground flex items-center gap-2 px-2 py-1 text-xs">
              {!online && <CloudOff className="size-3.5 shrink-0" />}
              <span>
                {!online && pendingCount === 0 && "Offline"}
                {!online &&
                  pendingCount > 0 &&
                  `Offline — ${pendingCount} pending ${pendingCount === 1 ? "change" : "changes"}`}
                {online &&
                  pendingCount > 0 &&
                  `Syncing ${pendingCount} pending ${pendingCount === 1 ? "change" : "changes"}…`}
              </span>
            </div>
          </SidebarGroup>
        )}
      </SidebarContent>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete tag “{deleteTarget?.name}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The tag is removed from every mail. Mails themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteTarget && deleteTagMutation.mutate(deleteTarget)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={newTagOpen} onOpenChange={setNewTagOpen}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newTagName.trim();
              if (name) createTagMutation.mutate(name);
            }}
          >
            <DialogHeader>
              <DialogTitle>New tag</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              placeholder="Tag name"
              value={newTagName}
              onChange={(e) => setNewTagName(e.target.value)}
            />
            {createTagMutation.isError && (
              <p className="text-destructive text-xs">
                Could not create tag: {createTagMutation.error.message}
              </p>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={!newTagName.trim() || createTagMutation.isPending}
              >
                {createTagMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={deleteFolderTarget !== null}
        onOpenChange={(open) => !open && setDeleteFolderTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete folder “{deleteFolderTarget}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The folder and every mail in it are deleted on the server.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                deleteFolderTarget &&
                deleteFolderMutation.mutate(deleteFolderTarget)
              }
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent className="sm:max-w-sm">
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              const name = newFolderName.trim();
              if (name) createFolderMutation.mutate(name);
            }}
          >
            <DialogHeader>
              <DialogTitle>New folder</DialogTitle>
            </DialogHeader>
            <Input
              autoFocus
              placeholder="Folder name"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
            />
            {createFolderMutation.isError && (
              <p className="text-destructive text-xs">
                {/* invoke() rejects with a plain string, not an Error */}
                Could not create folder: {String(createFolderMutation.error)}
              </p>
            )}
            <DialogFooter>
              <Button
                type="submit"
                disabled={
                  !newFolderName.trim() || createFolderMutation.isPending
                }
              >
                {createFolderMutation.isPending ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
