/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import { readFileSync } from "fs";

import {
  forwardDraft,
  replyDraft,
} from "@/components/mail/mail-display";
import {
  emailBridgeMessage,
  emailIframeSandbox,
  emailLinkBridgeScriptHash,
  emailSrcDoc,
  externalEmailLink,
} from "@/components/mail/email-link-bridge";
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

describe("email body iframe", () => {
  it("runs the trusted link-click bridge without giving the email its origin", () => {
    expect(emailIframeSandbox).toContain("allow-scripts");
    expect(emailIframeSandbox).not.toContain("allow-same-origin");
    expect(emailSrcDoc('<a href="https://example.com">Example</a>')).toContain(
      "parent.postMessage",
    );
  });

  it("passes browser-safe email links to the external opener", () => {
    expect(externalEmailLink("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(externalEmailLink("mailto:hello@example.com")).toBe(
      "mailto:hello@example.com",
    );
  });

  it("parses bridge messages from the iframe's opaque origin", () => {
    const ready = new MessageEvent("message", {
      data: { type: "email:bridge-ready" },
      origin: "null",
    });
    const openLink = new MessageEvent("message", {
      data: {
        type: "email:open-external-link",
        href: "https://example.com/path",
      },
      origin: "null",
    });

    expect(emailBridgeMessage(ready, null)).toEqual({ type: "ready" });
    expect(emailBridgeMessage(openLink, null)).toEqual({
      type: "open-link",
      href: "https://example.com/path",
    });
  });

  it("rejects untrusted bridge messages", () => {
    const wrongSource = new MessageEvent("message", {
      data: { type: "email:bridge-ready" },
      origin: "https://example.com",
    });
    const unsafeLink = new MessageEvent("message", {
      data: {
        type: "email:open-external-link",
        href: "javascript:alert(1)",
      },
      origin: "null",
    });

    expect(emailBridgeMessage(wrongSource, window)).toBeNull();
    expect(emailBridgeMessage(unsafeLink, null)).toBeNull();
  });

  it("allow-lists the inline bridge script in the release CSP", () => {
    const doc = emailSrcDoc("");
    const script = doc.match(/<script>([\s\S]*?)<\/script>/)?.[1];
    expect(script).toBeTruthy();
    const hash = `sha256-${createHash("sha256").update(script!).digest("base64")}`;

    const config = JSON.parse(
      readFileSync("src-tauri/tauri.conf.json", "utf8"),
    ) as { app: { security: { csp: Record<string, string> } } };
    const scriptSrc = config.app.security.csp["script-src"];

    expect(hash).toBe(emailLinkBridgeScriptHash);
    expect(scriptSrc).toContain(emailLinkBridgeScriptHash);
  });

  it("rejects unsafe or malformed email links", () => {
    expect(externalEmailLink("javascript:alert(1)")).toBeNull();
    expect(externalEmailLink("not a url")).toBeNull();
  });
});
