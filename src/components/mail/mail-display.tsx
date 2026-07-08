import { useState } from "react";
import { Archive, Reply, ReplyAll, Trash2 } from "lucide-react";
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
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Mail } from "@/components/mail/data";
import { Kbd } from "@/components/ui/kbd";
import {
  ComposeDialog,
  type ComposeDraft,
} from "@/components/mail/compose";
import { useKeyboardShortcuts } from "@/hooks/use-shortcuts";
import { useMailActions } from "@/hooks/use-mail-actions";
import { mailBodyQuery, profileQuery, type MailBody } from "@/lib/gmail";

function splitAddresses(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

// "Name <a@b>" → "a@b"
function bareAddress(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function quoteOriginal(body: MailBody): string {
  const source = body.text.trim();
  if (!source) return "";
  const quoted = source.split("\n").map(escapeHtml).join("<br>");
  return (
    `<p></p><p>On ${escapeHtml(body.date)}, ${escapeHtml(body.from)} wrote:</p>` +
    `<blockquote><p>${quoted}</p></blockquote>`
  );
}

function replyDraft(body: MailBody, all: boolean, self: string): ComposeDraft {
  const notSelf = (addr: string) =>
    bareAddress(addr) !== self && bareAddress(addr) !== bareAddress(body.replyTo);
  const to = all
    ? [body.replyTo, ...splitAddresses(body.to).filter(notSelf)]
    : [body.replyTo];
  const cc = all ? splitAddresses(body.cc).filter(notSelf) : [];
  return {
    to: to.join(", "),
    cc: cc.join(", ") || undefined,
    subject: /^re:/i.test(body.subject) ? body.subject : `Re: ${body.subject}`,
    bodyHtml: quoteOriginal(body),
    threadId: body.threadId,
    inReplyTo: body.messageId,
    references: `${body.references} ${body.messageId}`.trim(),
  };
}

// Wrap sanitized email HTML in a minimal document: light color-scheme (email
// HTML assumes a white background), responsive images, links open outside.
function emailSrcDoc(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    :root { color-scheme: light }
    body { margin: 16px; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; overflow-wrap: break-word }
    img { max-width: 100%; height: auto }
    pre { white-space: pre-wrap }
    blockquote { margin: 0 0 0 8px; padding-left: 8px; border-left: 2px solid #ccc; color: #555 }
  </style></head><body>${html}</body></html>`;
}

function initials(name: string) {
  return name
    .split(/[\s.@]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function MailDisplay({
  mail,
  onDismiss,
}: {
  mail: Mail | null;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [confirmTrash, setConfirmTrash] = useState(false);

  const { data: profile } = useQuery(profileQuery);

  const bodyQuery = useQuery({
    ...mailBodyQuery(mail?.id ?? ""),
    enabled: mail !== null,
  });

  const openReply = (all: boolean) => {
    if (!bodyQuery.data) return;
    setDraft(
      replyDraft(bodyQuery.data, all, profile?.emailAddress.toLowerCase() ?? ""),
    );
  };

  const { act, isPending } = useMailActions(() => onDismiss());

  useKeyboardShortcuts({
    r: () => mail && openReply(false),
    a: () => mail && openReply(true),
    e: () => mail && act("archive", mail.id),
    "#": () => mail && setConfirmTrash(true),
  });

  if (!mail) {
    return (
      <div className="text-muted-foreground flex h-full items-center justify-center p-8 text-sm">
        No message selected
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isPending}
              onClick={() => act("archive", mail.id)}
            >
              <Archive className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Archive <Kbd>e</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isPending}
              onClick={() => setConfirmTrash(true)}
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Move to trash <Kbd>#</Kbd>
          </TooltipContent>
        </Tooltip>
        <AlertDialog open={confirmTrash} onOpenChange={setConfirmTrash}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move to trash?</AlertDialogTitle>
              <AlertDialogDescription>
                “{mail.subject}” moves to Trash. Gmail deletes trashed mail
                permanently after 30 days.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => act("trash", mail.id)}>
                Move to trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <div className="ml-auto flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!bodyQuery.data}
                onClick={() => openReply(false)}
              >
                <Reply className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Reply <Kbd>r</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!bodyQuery.data}
                onClick={() => openReply(true)}
              >
                <ReplyAll className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Reply all <Kbd>a</Kbd>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
      <ComposeDialog draft={draft} onClose={() => setDraft(null)} />
      <Separator />
      <div className="flex items-start gap-4 p-4">
        <Avatar>
          <AvatarFallback>{initials(mail.name)}</AvatarFallback>
        </Avatar>
        <div className="grid gap-1">
          <div className="font-semibold">{mail.name}</div>
          <div className="text-xs line-clamp-1">{mail.subject}</div>
          <div className="text-muted-foreground text-xs">{mail.email}</div>
        </div>
        <div className="text-muted-foreground ml-auto text-xs">
          {new Date(mail.date).toLocaleString()}
        </div>
      </div>
      <Separator />
      <div className="flex-1 overflow-hidden">
        {bodyQuery.isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
        ) : bodyQuery.isError ? (
          <p className="text-muted-foreground p-4 text-sm">
            Failed to load message: {bodyQuery.error.message}
          </p>
        ) : bodyQuery.data.html ? (
          <iframe
            title="Message body"
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            srcDoc={emailSrcDoc(bodyQuery.data.html)}
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="h-full overflow-auto p-4 text-sm whitespace-pre-wrap">
            {bodyQuery.data.text || mail.text}
          </div>
        )}
      </div>
    </div>
  );
}
