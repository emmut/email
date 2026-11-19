import { sanitizeEmailHtml } from '@/lib/email-html';

const openLinkMessageType = 'email:open-external-link';
const bridgeReadyMessageType = 'email:bridge-ready';

type EmailBridgeMessage = { type: 'ready' } | { type: 'open-link'; href: string };

// This source stays inline at runtime because the sandboxed srcdoc iframe has
// an opaque origin. Production CSP allow-lists these exact bytes by hash.
const bridgeScript = `(function () {
  var token = document.currentScript.dataset.bridgeToken;
  var announceReady = function () {
    parent.postMessage({ token: token, type: "${bridgeReadyMessageType}" }, "*");
  };
  announceReady();
  document.addEventListener("DOMContentLoaded", announceReady);
  document.addEventListener("click", function (event) {
    var target = event.target;
    var link = target instanceof Element ? target.closest("a[href]") : null;
    if (!link) {
      return;
    }
    event.preventDefault();
    parent.postMessage({ token: token, type: "${openLinkMessageType}", href: link.href }, "*");
  });
})();`;

// Keep tauri.conf.json > app > security > csp > script-src in sync.
export const emailLinkBridgeScriptHash = 'sha256-3T2tXkZL3vsENcgO13ylPHaM3fuYPjrTsGSAUD6YV2E=';

export const emailIframeSandbox = 'allow-scripts';

export function emailSrcDoc(html: string, token: string) {
  if (!/^[a-zA-Z0-9-]+$/.test(token)) {
    throw new Error('Invalid email bridge token');
  }
  return `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>
    :root { color-scheme: light }
    body { margin: 16px; font-family: system-ui, sans-serif; font-size: 14px; line-height: 1.5; overflow-wrap: break-word }
    img { max-width: 100%; height: auto }
    pre { white-space: pre-wrap }
    blockquote { margin: 0 0 0 8px; padding-left: 8px; border-left: 2px solid #ccc; color: #555 }
  </style><script data-bridge-token="${token}">${bridgeScript}</script></head><body>${sanitizeEmailHtml(html)}</body></html>`;
}

export function externalEmailLink(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return ['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function emailBridgeMessage(
  event: MessageEvent<unknown>,
  expectedSource: Window | null | undefined,
  expectedToken: string,
): EmailBridgeMessage | null {
  // WebKitGTK may not preserve WindowProxy identity for a sandboxed srcdoc
  // iframe, whose origin is always "null". Other origins must match the frame.
  if (event.origin !== 'null' && event.source !== expectedSource) {
    return null;
  }

  if (typeof event.data !== 'object' || event.data === null) {
    return null;
  }

  const data = event.data as { token?: unknown; type?: unknown; href?: unknown };
  if (!expectedToken || data.token !== expectedToken) {
    return null;
  }
  if (data.type === bridgeReadyMessageType) {
    return { type: 'ready' };
  }
  if (data.type !== openLinkMessageType) {
    return null;
  }

  const href = externalEmailLink(data.href);
  return href ? { type: 'open-link', href } : null;
}
