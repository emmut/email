import DOMPurify from "dompurify";

// Keep email layout and inline styles, but never allow executable content.
export function sanitizeSignature(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
    FORBID_ATTR: ["srcset"],
  });
}

export function signatureBlock(html: string, compose = false): string {
  const safe = sanitizeSignature(html);
  return safe || compose ? `<div data-email-signature="true"${compose ? ' data-compose-signature="true"' : ""}>${safe}</div>` : "";
}
