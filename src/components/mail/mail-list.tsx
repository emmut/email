import { useState } from "react";
import { Archive, MailOpen, MailX, Tag as TagIcon, Trash2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

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
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Mail } from "@/components/mail/data";
import { tagsQuery } from "@/lib/gmail";
import { useMailActions, useTagActions } from "@/hooks/use-mail-actions";
import { useAccount } from "@/context/AccountContext";

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function labelVariant(label: string): "default" | "outline" | "secondary" {
  if (["work", "important"].includes(label)) return "default";
  if (["personal", "budget"].includes(label)) return "outline";
  return "secondary";
}

export function MailList({
  items,
  selectedId,
  onSelect,
  checkedIds,
  onToggleCheck,
  inTrash,
}: {
  items: Mail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  checkedIds: Set<string>;
  onToggleCheck: (id: string, range: boolean) => void;
  inTrash: boolean;
}) {
  const anyChecked = checkedIds.size > 0;
  // Permanent deletion (from within Trash) is the only destructive path that
  // asks first; moving to Trash is instant and recoverable.
  const [deleteTarget, setDeleteTarget] = useState<Mail | null>(null);
  const { act, error: actError } = useMailActions();
  const { toggle: toggleTag } = useTagActions();
  const { activeAccount } = useAccount();
  const isIcloud = activeAccount?.kind === "icloud";
  // Tags are a Gmail feature.
  const { data: tags } = useQuery({ ...tagsQuery, enabled: !isIcloud });

  return (
    <ScrollArea className="h-full">
      {actError && (
        <p className="text-destructive px-4 pt-3 text-xs">
          Action failed: {actError.message}
        </p>
      )}
      <div className="flex flex-col gap-2 p-4">
        {items.map((mail) => (
          <ContextMenu key={mail.id}>
            <ContextMenuTrigger asChild>
              {/* div, not button: the row holds a nested checkbox button */}
              <div
                role="button"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey) onToggleCheck(mail.id, false);
                  else if (e.shiftKey && anyChecked)
                    onToggleCheck(mail.id, true);
                  else onSelect(mail.id);
                }}
                className={cn(
                  "group flex cursor-pointer flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent select-none",
                  selectedId === mail.id && "bg-muted",
                  checkedIds.has(mail.id) && "border-primary/50 bg-accent/50",
                )}
              >
                <div className="flex w-full flex-col gap-1">
                  <div className="flex items-center">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        aria-label="Select message"
                        checked={checkedIds.has(mail.id)}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onToggleCheck(mail.id, e.shiftKey);
                        }}
                        className={cn(
                          "opacity-0 transition-opacity group-hover:opacity-100",
                          anyChecked && "opacity-100",
                        )}
                      />
                      <span className="font-semibold">{mail.name}</span>
                      {!mail.read && (
                        <span className="flex size-2 rounded-full bg-blue-600" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "ml-auto text-xs",
                        selectedId === mail.id
                          ? "text-foreground"
                          : "text-muted-foreground",
                      )}
                    >
                      {formatDate(mail.date)}
                    </span>
                  </div>
                  <span className="line-clamp-1 wrap-anywhere text-xs font-medium">
                    {mail.subject}
                  </span>
                </div>
                <span className="line-clamp-2 wrap-anywhere text-xs text-muted-foreground">
                  {mail.text.substring(0, 300)}
                </span>
                {mail.labels.length ? (
                  <div className="flex items-center gap-2">
                    {mail.labels.map((label) => (
                      <Badge key={label} variant={labelVariant(label)}>
                        {label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => act("archive", mail.id)}>
                <Archive />
                Archive
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={() =>
                  inTrash ? setDeleteTarget(mail) : act("trash", mail.id)
                }
              >
                <Trash2 />
                {inTrash ? "Delete permanently" : "Move to trash"}
              </ContextMenuItem>
              {/* Guard on the account too: a disabled query still surfaces
                  cached Gmail tags after switching to an iCloud account. */}
              {!isIcloud && tags?.length ? (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>
                      <TagIcon />
                      Tags
                    </ContextMenuSubTrigger>
                    <ContextMenuSubContent>
                      {tags.map((tag) => (
                        <ContextMenuCheckboxItem
                          key={tag.id}
                          checked={mail.labelIds.includes(tag.id)}
                          onCheckedChange={(on) =>
                            toggleTag(mail.id, tag, on === true)
                          }
                        >
                          {tag.name}
                        </ContextMenuCheckboxItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                </>
              ) : null}
              <ContextMenuSeparator />
              {mail.read ? (
                <ContextMenuItem onSelect={() => act("unread", mail.id)}>
                  <MailX />
                  Mark as unread
                </ContextMenuItem>
              ) : (
                <ContextMenuItem onSelect={() => act("read", mail.id)}>
                  <MailOpen />
                  Mark as read
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
      </div>
      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              “{deleteTarget?.subject}” is deleted forever. This cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && act("delete", deleteTarget.id)}
            >
              Delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}
