import { useState } from "react";
import {
  Archive,
  Forward,
  MailOpen,
  MailX,
  Reply,
  ReplyAll,
  Trash2,
} from "lucide-react";
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
import { noDialogOpen, useMenuEvents } from "@/hooks/use-menu";
import { useMailActions } from "@/hooks/use-mail-actions";
import { mailBodyQuery, profileQuery, type MailBody } from "@/lib/gmail";
import { icloudMessageBodyQuery, parseIcloudMailId } from "@/lib/icloud";
import { useAccount } from "@/context/AccountContext";

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

export function replyDraft(
  body: MailBody,
  all: boolean,
  self: string,
): ComposeDraft {
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

export function forwardDraft(body: MailBody): ComposeDraft {
  const headers = [
    `From: ${body.from}`,
    `Date: ${body.date}`,
    `Subject: ${body.subject}`,
    `To: ${body.to}`,
    ...(body.cc ? [`Cc: ${body.cc}`] : []),
  ]
    .map(escapeHtml)
    .join("<br>");
  const quoted = body.text.trim().split("\n").map(escapeHtml).join("<br>");
  return {
    forward: true,
    subject: /^fwd:/i.test(body.subject)
      ? body.subject
      : `Fwd: ${body.subject}`,
    bodyHtml:
      `<p></p><p>---------- Forwarded message ----------<br>${headers}</p>` +
      (quoted ? `<blockquote><p>${quoted}</p></blockquote>` : ""),
    threadId: body.threadId,
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
  inTrash,
  onDismiss,
}: {
  mail: Mail | null;
  inTrash: boolean;
  onDismiss: () => void;
}) {
  const [draft, setDraft] = useState<ComposeDraft | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const { activeAccount } = useAccount();
  const icloudRef = mail ? parseIcloudMailId(mail.id) : null;
  const isIcloud = icloudRef !== null;

  const { data: profile } = useQuery({ ...profileQuery, enabled: !isIcloud });

  const gmailBody = useQuery({
    ...mailBodyQuery(mail?.id ?? ""),
    enabled: mail !== null && !isIcloud,
  });
  const icloudBody = useQuery({
    ...icloudMessageBodyQuery(
      activeAccount?.id ?? "",
      icloudRef?.folder ?? "",
      icloudRef?.uid ?? 0,
    ),
    enabled: isIcloud && !!activeAccount,
  });
  const bodyQuery = isIcloud ? icloudBody : gmailBody;

  const openReply = (all: boolean) => {
    if (!bodyQuery.data) return;
    const self = (activeAccount?.email ?? profile?.emailAddress ?? "").toLowerCase();
    setDraft(replyDraft(bodyQuery.data, all, self));
  };

  const openForward = () => {
    if (!bodyQuery.data) return;
    setDraft(forwardDraft(bodyQuery.data));
  };

  const { act, isPending } = useMailActions(() => onDismiss());

  // Trash is instant (recoverable for 30 days); deleting from within Trash
  // is forever, so that one asks first.
  const trashSelected = () => {
    if (!mail) return;
    if (inTrash) setConfirmDelete(true);
    else act("trash", mail.id);
  };

  useKeyboardShortcuts({
    r: () => mail && openReply(false),
    a: () => mail && openReply(true),
    f: () => mail && openForward(),
    e: () => mail && act("archive", mail.id),
    "#": () => trashSelected(),
  });

  useMenuEvents({
    reply: () => noDialogOpen() && mail && openReply(false),
    reply_all: () => noDialogOpen() && mail && openReply(true),
    forward: () => noDialogOpen() && mail && openForward(),
    trash: () => noDialogOpen() && trashSelected(),
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
              onClick={trashSelected}
            >
              <Trash2 className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {inTrash ? "Delete permanently" : "Move to trash"} <Kbd>#</Kbd>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              disabled={isPending}
              onClick={() => act(mail.read ? "unread" : "read", mail.id)}
            >
              {mail.read ? (
                <MailX className="size-4" />
              ) : (
                <MailOpen className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {mail.read ? (
              <>
                Mark as unread <Kbd>u</Kbd>
              </>
            ) : (
              <>
                Mark as read <Kbd>i</Kbd>
              </>
            )}
          </TooltipContent>
        </Tooltip>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete permanently?</AlertDialogTitle>
              <AlertDialogDescription>
                “{mail.subject}” is deleted forever. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => act("delete", mail.id)}>
                Delete permanently
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                disabled={!bodyQuery.data}
                onClick={openForward}
              >
                <Forward className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Forward <Kbd>f</Kbd>
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
