import { useEffect, useMemo, useRef, useState } from "react";
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
  tagsQuery,
  type Contact,
  type OutgoingMail,
} from "@/lib/gmail";
import { useSignature } from "@/lib/signature";
import { icloudContactsQuery, icloudSendMessage } from "@/lib/icloud";
import {
  isNetworkError,
  queueGmailSend,
  queueIcloudSend,
  useOnline,
} from "@/lib/offline";

export interface ComposeDraft {
  to?: string;
  cc?: string;
  subject?: string;
  bodyHtml?: string; // initial editor content below the signature (e.g. reply quote)
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  forward?: boolean;
}

// Gmail signatures are <div> blocks with trailing <br>s and <div><br></div>
// spacers. TipTap renders a trailing break as an extra blank line, and drops
// empty <div>s entirely — so strip the breaks, and turn each spacer run into
// a single <p></p> (which TipTap keeps as one blank line).
export function tidySignature(html: string): string {
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

export function htmlToPlain(html: string): string {
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
  // Resolved per account: local signature, Gmail-hosted fallback (Google).
  const { activeAccount } = useAccount();
  const { signature, isPending } = useSignature(activeAccount);

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>
          {draft.inReplyTo
            ? "Reply"
            : draft.forward
              ? "Forward"
              : "New message"}
        </DialogTitle>
      </DialogHeader>
      {isPending ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-44 w-full" />
        </div>
      ) : (
        <ComposeFields draft={draft} signature={signature} onClose={onClose} />
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

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);
  const selectedIsIcloud = selectedAccount?.kind === "icloud";

  // Tags and contact autocomplete are Gmail features.
  const { data: tags } = useQuery({ ...tagsQuery, enabled: !selectedIsIcloud });

  const toggleTag = (id: string) =>
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id],
    );

  const buildHtml = (sig: string) =>
    "<p></p>" +
    (sig ? `<p></p><p>--</p>${tidySignature(sig)}` : "") +
    (draft.bodyHtml ?? "");
  const [body, setBody] = useState(() => ({
    html: buildHtml(signature),
    text: "",
  }));

  // The signature follows the From account. When it changes and the user
  // hasn't typed yet, rebuild the editor content with the new account's
  // signature (a bumped key remounts the editor). Once the user has typed we
  // leave the content alone rather than clobber it.
  const edited = useRef(false);
  const [editorKey, setEditorKey] = useState(0);
  const [currentSig, setCurrentSig] = useState(signature);
  const selectedSig = useSignature(selectedAccount);
  useEffect(() => {
    if (selectedSig.isPending || edited.current) return;
    if (selectedSig.signature === currentSig) return;
    setCurrentSig(selectedSig.signature);
    setBody({ html: buildHtml(selectedSig.signature), text: "" });
    setEditorKey((k) => k + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSig.signature, selectedSig.isPending]);

  // Contacts from every connected source, deduped by address (a contact in
  // both keeps the named/Google entry). The list itself shows the origin.
  const hasGoogle = accounts.length === 0 || accounts.some((a) => a.kind === "google");
  const hasIcloud = accounts.some((a) => a.kind === "icloud");
  const googleContacts = useQuery({ ...contactsQuery, enabled: hasGoogle });
  const icloudContacts = useQuery({ ...icloudContactsQuery, enabled: hasIcloud });
  const contactsFailed = hasGoogle && googleContacts.isError;
  const contactsError = googleContacts.error;
  const contacts = useMemo(() => {
    const byEmail = new Map<string, Contact>();
    for (const c of [
      ...(googleContacts.data ?? []),
      ...(icloudContacts.data ?? []),
    ]) {
      const key = c.email.toLowerCase();
      const existing = byEmail.get(key);
      if (!existing || (!existing.name && c.name)) byEmail.set(key, c);
    }
    return [...byEmail.values()];
  }, [googleContacts.data, icloudContacts.data]);

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
      queryClient.invalidateQueries({ queryKey: ["ops"] });
      onClose();
    },
  });

  const online = useOnline();
  const isReply = Boolean(draft.inReplyTo);

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
          Contact autocomplete unavailable: {contactsError?.message}
        </p>
      )}
      <Input
        placeholder="Subject"
        type="text"
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
      />
      <RichTextEditor
        key={editorKey}
        initialHtml={body.html}
        autoFocus={isReply}
        onChange={(html, text) => {
          edited.current = true;
          setBody({ html, text });
        }}
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
        {sendMutation.isError ? (
          <span className="text-destructive mr-auto text-xs">
            Send failed: {sendMutation.error.message}
          </span>
        ) : !online ? (
          <span className="text-muted-foreground mr-auto text-xs">
            You’re offline — the message will be queued and sent when the
            connection returns.
          </span>
        ) : null}
        <Button type="submit" disabled={sendMutation.isPending}>
          {sendMutation.isPending ? "Sending…" : online ? "Send" : "Queue"}
        </Button>
      </DialogFooter>
    </form>
  );
}
