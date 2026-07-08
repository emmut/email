import { useState } from "react";
import {
  Archive,
  ArchiveX,
  ChevronsUpDown,
  File,
  Inbox,
  LogOut,
  Plus,
  Send,
  Tag as TagIcon,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
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
import { signOut } from "@/lib/auth";
import { cn, isMac } from "@/lib/utils";
import {
  avatarQuery,
  createTag,
  deleteTag,
  folderCountsQuery,
  profileQuery,
  tagFolderId,
  tagsQuery,
  type Tag,
} from "@/lib/gmail";

const ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  file: File,
  send: Send,
  "archive-x": ArchiveX,
  trash2: Trash2,
  archive: Archive,
};

// "emil.jansson@x" → "EJ"
function initialsFromEmail(email: string) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function MailSidebar({
  activeFolder,
  onSelectFolder,
}: {
  activeFolder: string;
  onSelectFolder: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const { data: profile } = useQuery(profileQuery);
  const { data: counts } = useQuery(folderCountsQuery);
  const { data: tags } = useQuery(tagsQuery);
  const { data: avatar } = useQuery(avatarQuery);
  const [newTagOpen, setNewTagOpen] = useState(false);
  const [newTagName, setNewTagName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null);

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
      // Gmail stripped the label from every message; refetch badges.
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      if (activeFolder === tagFolderId(tag.id)) onSelectFolder("inbox");
    },
  });

  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ["gmail"] });
      queryClient.invalidateQueries({ queryKey: ["auth"] });
    },
  });

  const email = profile?.emailAddress;

  return (
    <Sidebar collapsible="icon">
      {/* Clear the macOS traffic lights (transparent title bar overlay) */}
      <SidebarHeader data-tauri-drag-region className={cn(isMac && "pt-8")}>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
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
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuItem
                  disabled={signOutMutation.isPending}
                  onSelect={() => signOutMutation.mutate()}
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
                    <ContextMenuTrigger asChild>
                      <SidebarMenuButton
                        tooltip={tag.name}
                        isActive={folderId === activeFolder}
                        onClick={() => onSelectFolder(folderId)}
                      >
                        <TagIcon />
                        <span>{tag.name}</span>
                      </SidebarMenuButton>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem
                        variant="destructive"
                        onSelect={() => setDeleteTarget(tag)}
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
      </SidebarContent>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete tag “{deleteTarget?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              The tag is removed from every mail. Mails themselves are kept.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteTagMutation.mutate(deleteTarget)}
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
    </Sidebar>
  );
}
