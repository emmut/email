import {
  Archive,
  ArchiveX,
  ChevronsUpDown,
  File,
  Inbox,
  LogOut,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { folders } from "@/components/mail/data";
import { signOut } from "@/lib/auth";

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
  const signOutMutation = useMutation({
    mutationFn: signOut,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip="Account">
                  <div className="bg-primary text-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                    EJ
                  </div>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">Emil Jansson</span>
                    <span className="text-muted-foreground truncate text-xs">
                      emil.jansson@compileit.com
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
                  {folder.count ? (
                    <SidebarMenuBadge>{folder.count}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
