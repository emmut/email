import { useEffect, useRef } from 'react';

import { sanitizeSignature } from '@/lib/signature-html';

export function SignaturePreview({
  html,
  editable = false,
  onChange,
}: {
  html: string;
  editable?: boolean;
  onChange?: (html: string) => void;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const initialHtml = useRef(html);
  const changeHandler = useRef(onChange);
  changeHandler.current = onChange;
  // Keep the editing document mounted while typing so its selection survives.
  const source = editable ? initialHtml.current : html;

  useEffect(() => {
    const element = frame.current;
    if (!element) {
      return;
    }
    const currentFrame = element;
    let resizeObserver: ResizeObserver | undefined;
    let mutationObserver: MutationObserver | undefined;
    function resize() {
      const body = currentFrame.contentDocument?.body;
      if (body) {
        currentFrame.style.height = `${Math.max(60, body.scrollHeight + 16)}px`;
      }
    }
    function loaded() {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      resize();
      const body = currentFrame.contentDocument?.body;
      if (!body) {
        return;
      }
      body.contentEditable = String(editable);
      if (editable) {
        body.setAttribute('role', 'textbox');
        body.setAttribute('aria-label', 'Signature visual editor');
        body.setAttribute('aria-multiline', 'true');
        // Not an `input` listener: the frame is sandboxed without
        // allow-scripts, and WebKit (Tauri's engine) never runs event
        // listeners registered on such a document — edits went unnoticed.
        // Observer callbacks run in this (parent) context, so they fire.
        mutationObserver = new MutationObserver(() =>
          changeHandler.current?.(sanitizeSignature(body.innerHTML)),
        );
        mutationObserver.observe(body, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
        });
      }
      if (typeof ResizeObserver !== 'undefined') {
        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(body);
      }
    }
    element.addEventListener('load', loaded);
    loaded();
    return () => {
      element.removeEventListener('load', loaded);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [source, editable]);

  // Links open in a new window (base target), which the sandbox blocks
  // (no allow-popups) — so clicking one never navigates the frame. A click
  // listener can't do this: it wouldn't run in WebKit (see above).
  return (
    <iframe
      ref={frame}
      title={editable ? 'Signature visual editor' : 'Signature preview'}
      className="min-h-16 w-full border-0 bg-white"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline';"><base target="_blank"><style>body{margin:8px;color:#111;background:white;font:14px Arial,sans-serif;overflow-wrap:break-word;min-height:${editable ? 140 : 0}px;outline:none}img{max-width:100%}</style></head><body>${sanitizeSignature(source)}</body></html>`}
    />
  );
}
