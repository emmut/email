import DOMPurify from 'dompurify';

// Keep email layout and inline styles, but never allow executable content.
export function sanitizeSignature(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select'],
    FORBID_ATTR: ['srcset'],
  });
}

export function signatureBlock(html: string, compose = false): string {
  const safe = sanitizeSignature(html);
  if (!safe && !compose) {
    return '';
  }
  const composeAttribute = compose ? ' data-compose-signature="true"' : '';
  return `<div data-email-signature="true"${composeAttribute}>${safe}</div>`;
}
