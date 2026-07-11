import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

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
  buildRfc822,
  contactsQuery,
  saveDraft,
  sendMessage,
  tagsQuery,
  type Contact,
  type OutgoingMail,
} from "@/lib/gmail";
import { useSignature } from "@/lib/signature";
import {
  icloudContactsQuery,
  icloudSaveDraft,
  icloudSendMessage,
} from "@/lib/icloud";
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

export interface HeaderFields {
  to: string;
  cc: string;
  bcc: string;
  subject: string;
}

// What the header fields look like when the dialog opens; the reference
// point for unsaved-changes detection.
export function initialHeaderFields(draft: ComposeDraft): HeaderFields {
  return {
    to: draft.to ?? "",
    cc: draft.cc ?? "",
    bcc: "",
    subject: draft.subject ?? "",
  };
}

// A compose form has unsaved changes when the user touched the editor body
// or any header field differs from what the dialog opened with.
export function hasUnsavedChanges(
  draft: ComposeDraft,
  fields: HeaderFields,
  bodyEdited: boolean,
): boolean {
  if (bodyEdited) return true;
  const initial = initialHeaderFields(draft);
  return (Object.keys(initial) as (keyof HeaderFields)[]).some(
    (key) => fields[key] !== initial[key],
  );
}

// The form registers a close guard here so Esc/X/outside-click can offer to
// save unsent edits as a draft instead of silently discarding them.
type CloseGuard = MutableRefObject<(() => void) | null>;

export function ComposeDialog({
  draft,
  onClose,
}: {
  draft: ComposeDraft | null; // null = closed
  onClose: () => void;
}) {
  const closeGuard: CloseGuard = useRef(null);
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => {
        if (open) return;
        if (closeGuard.current) closeGuard.current();
        else onClose();
      }}
    >
      {draft !== null && (
        <ComposeForm draft={draft} onClose={onClose} closeGuard={closeGuard} />
      )}
    </Dialog>
  );
}

function ComposeForm({
  draft,
  onClose,
  closeGuard,
}: {
  draft: ComposeDraft;
  onClose: () => void;
  closeGuard: CloseGuard;
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
        <ComposeFields
          draft={draft}
          signature={signature}
          onClose={onClose}
          closeGuard={closeGuard}
        />
      )}
    </DialogContent>
  );
}

function ComposeFields({
  draft,
  signature,
  onClose,
  closeGuard,
}: {
  draft: ComposeDraft;
  signature: string;
  onClose: () => void;
  closeGuard: CloseGuard;
}) {
  const { accounts, activeAccountId } = useAccount();
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(activeAccountId);
  const [initialFields] = useState(() => initialHeaderFields(draft));
  const [to, setTo] = useState(initialFields.to);
  const [cc, setCc] = useState(initialFields.cc);
  const [bcc, setBcc] = useState(initialFields.bcc);
  const [subject, setSubject] = useState(initialFields.subject);
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

  const buildOutgoing = (): OutgoingMail => ({
    to,
    cc: cc.trim() || undefined,
    bcc: bcc.trim() || undefined,
    subject,
    body: body.text || htmlToPlain(body.html),
    html: body.html,
    threadId: draft.threadId,
    inReplyTo: draft.inReplyTo,
    references: draft.references,
  });

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

  const saveDraftMutation = useMutation({
    mutationFn: async () => {
      const account = accounts.find((a) => a.id === selectedAccountId);
      const msg = buildOutgoing();
      if (account?.kind === "icloud") {
        // IMAP has no draft API beyond the mailbox itself: APPEND the built
        // message to Drafts. From/Date must be in the MIME (nothing fills
        // them in server-side like Gmail does).
        await icloudSaveDraft(account.id, buildRfc822(msg, account.email));
      } else {
        await saveDraft(msg);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      queryClient.invalidateQueries({ queryKey: ["gmail", "counts"] });
      queryClient.invalidateQueries({ queryKey: ["icloud"] });
      onClose();
    },
  });

  const online = useOnline();
  const isReply = Boolean(draft.inReplyTo);

  // Closing with unsent edits (Esc, X, click outside) offers to save them.
  // A pristine form — or one whose send is already in flight — just closes.
  const [confirmSave, setConfirmSave] = useState(false);
  const dirty = hasUnsavedChanges(draft, { to, cc, bcc, subject }, edited.current);
  useEffect(() => {
    closeGuard.current = () => {
      if (dirty && !sendMutation.isPending) setConfirmSave(true);
      else onClose();
    };
    return () => {
      closeGuard.current = null;
    };
  });

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
          ...buildOutgoing(),
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
        ) : saveDraftMutation.isError ? (
          <span className="text-destructive mr-auto text-xs">
            Saving draft failed: {saveDraftMutation.error.message}
          </span>
        ) : !online ? (
          <span className="text-muted-foreground mr-auto text-xs">
            You’re offline — the message will be queued and sent when the
            connection returns.
          </span>
        ) : null}
        <Button
          type="button"
          variant="outline"
          disabled={saveDraftMutation.isPending || sendMutation.isPending}
          onClick={() => saveDraftMutation.mutate()}
        >
          {saveDraftMutation.isPending ? "Saving…" : "Save draft"}
        </Button>
        <Button type="submit" disabled={sendMutation.isPending}>
          {sendMutation.isPending ? "Sending…" : online ? "Send" : "Queue"}
        </Button>
      </DialogFooter>
      <AlertDialog open={confirmSave} onOpenChange={setConfirmSave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save as draft?</AlertDialogTitle>
            <AlertDialogDescription>
              This message hasn’t been sent. Keep it in Drafts, or discard it?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <Button variant="outline" onClick={onClose}>
              Discard
            </Button>
            <AlertDialogAction onClick={() => saveDraftMutation.mutate()}>
              Save draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}
