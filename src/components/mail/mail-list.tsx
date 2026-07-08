import { useState } from "react";
import { Archive, MailOpen, MailX, Trash2 } from "lucide-react";

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
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Mail } from "@/components/mail/data";
import { useMailActions } from "@/hooks/use-mail-actions";

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
}: {
  items: Mail[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const [trashTarget, setTrashTarget] = useState<Mail | null>(null);
  const { act } = useMailActions();

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-2 p-4">
        {items.map((mail) => (
          <ContextMenu key={mail.id}>
            <ContextMenuTrigger asChild>
              <button
                onClick={() => onSelect(mail.id)}
                className={cn(
                  "flex flex-col items-start gap-2 rounded-lg border p-3 text-left text-sm transition-all hover:bg-accent",
                  selectedId === mail.id && "bg-muted",
                )}
              >
                <div className="flex w-full flex-col gap-1">
                  <div className="flex items-center">
                    <div className="flex items-center gap-2">
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
              </button>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onSelect={() => act("archive", mail.id)}>
                <Archive />
                Archive
              </ContextMenuItem>
              <ContextMenuItem
                variant="destructive"
                onSelect={() => setTrashTarget(mail)}
              >
                <Trash2 />
                Move to trash
              </ContextMenuItem>
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
        open={trashTarget !== null}
        onOpenChange={(open) => !open && setTrashTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Move to trash?</AlertDialogTitle>
            <AlertDialogDescription>
              “{trashTarget?.subject}” moves to Trash. Gmail deletes trashed
              mail permanently after 30 days.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => trashTarget && act("trash", trashTarget.id)}
            >
              Move to trash
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ScrollArea>
  );
}
