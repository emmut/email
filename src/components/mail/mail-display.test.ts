import { describe, expect, it } from "vitest";

import { forwardDraft, replyDraft } from "@/components/mail/mail-display";
import { mailBody } from "@/test/fixtures";

describe("replyDraft", () => {
  it("replies to the Reply-To address only", () => {
    const draft = replyDraft(mailBody(), false, "bob@example.com");
    expect(draft.to).toBe("Alice <alice@example.com>");
    expect(draft.cc).toBeUndefined();
  });

  it("prefixes Re: once", () => {
    expect(replyDraft(mailBody(), false, "").subject).toBe("Re: Lunch plans");
    expect(
      replyDraft(mailBody({ subject: "RE: Lunch plans" }), false, "").subject,
    ).toBe("RE: Lunch plans");
  });

  it("reply-all keeps other recipients but drops self and the sender", () => {
    const draft = replyDraft(mailBody(), true, "bob@example.com");
    expect(draft.to).toBe("Alice <alice@example.com>, Carol <carol@example.com>");
    expect(draft.cc).toBe("Dave <dave@example.com>");
  });

  it("threads via In-Reply-To and appended References", () => {
    const draft = replyDraft(mailBody(), false, "");
    expect(draft.threadId).toBe("t1");
    expect(draft.inReplyTo).toBe("<msg-1@example.com>");
    expect(draft.references).toBe("<msg-0@example.com> <msg-1@example.com>");
  });

  it("quotes the original as escaped html", () => {
    const draft = replyDraft(
      mailBody({ text: "a < b\nsecond" }),
      false,
      "",
    );
    expect(draft.bodyHtml).toContain("a &lt; b<br>second");
    expect(draft.bodyHtml).toContain("wrote:");
    expect(draft.bodyHtml).toContain("<blockquote>");
  });
});

describe("forwardDraft", () => {
  it("prefixes Fwd: once and leaves recipients empty", () => {
    const draft = forwardDraft(mailBody());
    expect(draft.subject).toBe("Fwd: Lunch plans");
    expect(draft.to).toBeUndefined();
    expect(draft.forward).toBe(true);
    expect(
      forwardDraft(mailBody({ subject: "FWD: Lunch plans" })).subject,
    ).toBe("FWD: Lunch plans");
  });

  it("is not a reply (no In-Reply-To) but keeps thread references", () => {
    const draft = forwardDraft(mailBody());
    expect(draft.inReplyTo).toBeUndefined();
    expect(draft.threadId).toBe("t1");
    expect(draft.references).toBe("<msg-0@example.com> <msg-1@example.com>");
  });

  it("includes an escaped forwarded-message header block and the body", () => {
    const draft = forwardDraft(mailBody());
    expect(draft.bodyHtml).toContain("Forwarded message");
    expect(draft.bodyHtml).toContain("From: Alice &lt;alice@example.com&gt;");
    expect(draft.bodyHtml).toContain("Subject: Lunch plans");
    expect(draft.bodyHtml).toContain("Cc: Dave &lt;dave@example.com&gt;");
    expect(draft.bodyHtml).toContain("Hello there<br>Second line");
  });

  it("omits the Cc header when the original had none", () => {
    expect(forwardDraft(mailBody({ cc: "" })).bodyHtml).not.toContain("Cc:");
  });
});
