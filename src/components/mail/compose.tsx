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
import { Input } from "@/components/ui/input";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { RecipientInput } from "@/components/mail/recipient-input";
import {
  contactsQuery,
  sendMessage,
  signatureQuery,
  tagsQuery,
  type OutgoingMail,
} from "@/lib/gmail";

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
  const signature = useQuery(signatureQuery);

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{draft.inReplyTo ? "Reply" : "New message"}</DialogTitle>
      </DialogHeader>
      {signature.isPending ? (
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
  const [to, setTo] = useState(draft.to ?? "");
  const [cc, setCc] = useState(draft.cc ?? "");
  const [bcc, setBcc] = useState("");
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [tagIds, setTagIds] = useState<string[]>([]);

  const { data: tags } = useQuery(tagsQuery);

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
    useQuery(contactsQuery);

  const queryClient = useQueryClient();
  const sendMutation = useMutation({
    mutationFn: (msg: OutgoingMail) => sendMessage(msg),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      onClose();
    },
  });

  const isReply = Boolean(draft.inReplyTo);

  return (
    <form
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        // Cmd+Enter (macOS) / Ctrl+Enter (Windows, Linux) sends
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
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
      {tags?.length ? (
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
