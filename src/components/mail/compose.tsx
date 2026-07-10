import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { RecipientInput } from "@/components/mail/recipient-input";
import { useAccount } from "@/context/AccountContext";
import {
  contactsQuery,
  sendMessage,
  signatureQuery,
  tagsQuery,
  type OutgoingMail,
} from "@/lib/gmail";
import { icloudSendMessage } from "@/lib/icloud";
import {
  isNetworkError,
  queueGmailSend,
  queueIcloudSend,
} from "@/lib/offline";

export interface ComposeDraft {
  to?: string;
  cc?: string;
  subject?: string;
  bodyHtml?: string; // initial editor content below the signature (e.g. reply quote)
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}

// Gmail signatures are <div> blocks with trailing <br>s and <div><br></div>
// spacers. TipTap renders a trailing break as an extra blank line, and drops
// empty <div>s entirely — so strip the breaks, and turn each spacer run into
// a single <p></p> (which TipTap keeps as one blank line).
function tidySignature(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const isEmpty = (el: Element) =>
    !el.textContent?.trim() && !el.querySelector("img");
  const blocks = [...doc.body.querySelectorAll("div, p")];
  for (const block of blocks) {
    while (block.lastChild?.nodeName === "BR") block.lastChild.remove();
  }
  for (const block of blocks) {
    if (!isEmpty(block)) continue;
    const prev = block.previousElementSibling;
    if (prev && /^(DIV|P)$/.test(prev.tagName) && isEmpty(prev)) block.remove();
    else block.replaceWith(doc.createElement("p"));
  }
  return doc.body.innerHTML;
}

function htmlToPlain(html: string): string {
  return (
    new DOMParser().parseFromString(html, "text/html").body.textContent ?? ""
  );
}

export function ComposeDialog({
  draft,
  onClose,
}: {
  draft: ComposeDraft | null; // null = closed
  onClose: () => void;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(open) => !open && onClose()}>
      {draft !== null && <ComposeForm draft={draft} onClose={onClose} />}
    </Dialog>
  );
}

function ComposeForm({
  draft,
  onClose,
}: {
  draft: ComposeDraft;
  onClose: () => void;
}) {
  // The editor takes its content at mount, so wait for the signature first.
  // Signatures come from Gmail settings — skip for iCloud accounts.
  const { activeAccount } = useAccount();
  const isIcloud = activeAccount?.kind === "icloud";
  const signature = useQuery({ ...signatureQuery, enabled: !isIcloud });

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{draft.inReplyTo ? "Reply" : "New message"}</DialogTitle>
      </DialogHeader>
      {!isIcloud && signature.isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <ComposeFields
          draft={draft}
          signature={signature.data ?? ""}
          onClose={onClose}
        />
      )}
    </DialogContent>
  );
}

function ComposeFields({
  draft,
  signature,
  onClose,
}: {
  draft: ComposeDraft;
  signature: string;
  onClose: () => void;
}) {
  const { accounts, activeAccountId } = useAccount();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(activeAccountId);
  const [to, setTo] = useState(draft.to ?? "");
  const [cc, setCc] = useState(draft.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);

  const selectedIsIcloud =
    accounts.find((a) => a.id === selectedAccountId)?.kind === "icloud";

  // Tags and contact autocomplete are Gmail features.
  const { data: tags } = useQuery({ ...tagsQuery, enabled: !selectedIsIcloud });

  const toggleTag = (id: string) =>
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );

  const initialHtml =
    "<p></p>" +
    (signature ? `<p></p><p>--</p>${tidySignature(signature)}` : "") +
    (draft.bodyHtml ?? "");
  const [body, setBody] = useState(() => ({ html: initialHtml, text: "" }));

  const { data: contacts, isError: contactsFailed, error: contactsError } =
    useQuery({ ...contactsQuery, enabled: !selectedIsIcloud });

  const queryClient = useQueryClient();
  const sendMutation = useMutation({
    mutationFn: async (msg: OutgoingMail) => {
      const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
      if (selectedAccount?.kind === "icloud") {
        // Send via iCloud SMTP
        const params = {
          accountId: selectedAccount.id,
          fromEmail: selectedAccount.email,
          to: msg.to,
          cc: msg.cc,
          bcc: msg.bcc,
          subject: msg.subject,
          bodyText: msg.body,
          bodyHtml: msg.html,
          inReplyTo: msg.inReplyTo,
          references: msg.references,
        };
        try {
          await icloudSendMessage(params);
        } catch (err) {
          // Offline: park it in the outbox; it sends when connectivity returns.
          if (!isNetworkError(err)) throw err;
          await queueIcloudSend(params);
        }
      } else {
        // Send via Gmail API (default)
        try {
          await sendMessage(msg);
        } catch (err) {
          if (!isNetworkError(err)) throw err;
          await queueGmailSend(msg);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      queryClient.invalidateQueries({ queryKey: ["icloud"] });
      onClose();
    },
  });

  const isReply = Boolean(draft.inReplyTo);

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const fromLabel = selectedAccount
    ? `${selectedAccount.kind === "google" ? "Google" : "iCloud"}: ${selectedAccount.email}`
    : "Select account";

  return (
    <form
      className="flex min-w-0 flex-col gap-3"
      onKeyDown={(e) => {
        // Cmd+Enter (macOS) / Ctrl+Enter (Windows, Linux) sends
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (!selectedAccountId) return;
        sendMutation.mutate({
          to,
          cc: cc.trim() || undefined,
          bcc: bcc.trim() || undefined,
          subject,
          body: body.text || htmlToPlain(body.html),
          html: body.html,
          threadId: draft.threadId,
          inReplyTo: draft.inReplyTo,
          references: draft.references,
          labelIds: tagIds.length ? tagIds : undefined,
        });
      }}
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" type="button" className="justify-start">
            <span className="text-muted-foreground">From:</span>
            <span className="truncate">{fromLabel}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-80">
          {accounts.map((acc) => (
            <DropdownMenuItem
              key={acc.id}
              onSelect={() => setSelectedAccountId(acc.id)}
              className={acc.id === selectedAccountId ? "bg-accent font-medium" : ""}
            >
              <span className="flex items-center gap-2 w-full">
                <span className="text-xs uppercase text-muted-foreground">
                  {acc.kind === "google" ? "Google" : "iCloud"}
                </span>
                <span className="truncate">{acc.email}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <RecipientInput
        placeholder="To"
        required
        autoFocus={!isReply}
        value={to}
        onChange={setTo}
        contacts={contacts ?? []}
      />
      <RecipientInput
        placeholder="Cc"
        value={cc}
        onChange={setCc}
        contacts={contacts ?? []}
      />
      <RecipientInput
        placeholder="Bcc"
        value={bcc}
        onChange={setBcc}
        contacts={contacts ?? []}
      />
      {contactsFailed && (
        <p className="text-muted-foreground text-xs">
          Contact autocomplete unavailable: {contactsError.message}
        </p>
      )}
      <Input
        placeholder="Subject"
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <RichTextEditor
        initialHtml={initialHtml}
        autoFocus={isReply}
        onChange={(html, text) => setBody({ html, text })}
      />
      {!selectedIsIcloud && tags?.length ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground text-xs">Tags:</span>
          {tags.map((tag) => (
            <Badge
              key={tag.id}
              asChild
              variant={tagIds.includes(tag.id) ? "default" : "outline"}
            >
              <button type="button" onClick={() => toggleTag(tag.id)}>
                {tag.name}
              </button>
            </Badge>
          ))}
        </div>
      ) : null}
      <DialogFooter className="items-center gap-3">
        {sendMutation.isError && (
          <span className="text-destructive mr-auto text-xs">
            Send failed: {sendMutation.error.message}
          </span>
        )}
        <Button type="submit" disabled={sendMutation.isPending}>
          {sendMutation.isPending ? "Sending…" : "Send"}
        </Button>
      </DialogFooter>
    </form>
  );
}
