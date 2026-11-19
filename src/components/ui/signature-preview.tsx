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
    let observer: ResizeObserver | undefined;
    function resize() {
      const body = currentFrame.contentDocument?.body;
      if (body) {
        currentFrame.style.height = `${Math.max(60, body.scrollHeight + 16)}px`;
      }
    }
    function input() {
      const body = currentFrame.contentDocument?.body;
      if (body) {
        changeHandler.current?.(sanitizeSignature(body.innerHTML));
      }
    }
    function preventNavigation(event: Event) {
      if ((event.target as Element | null)?.closest?.('a')) {
        event.preventDefault();
      }
    }
    function loaded() {
      observer?.disconnect();
      resize();
      const body = currentFrame.contentDocument?.body;
      if (body) {
        body.contentEditable = String(editable);
        if (editable) {
          body.setAttribute('role', 'textbox');
          body.setAttribute('aria-label', 'Signature visual editor');
          body.setAttribute('aria-multiline', 'true');
          body.addEventListener('input', input);
        }
        body.addEventListener('click', preventNavigation);
      }
      if (body && typeof ResizeObserver !== 'undefined') {
        observer = new ResizeObserver(resize);
        observer.observe(body);
      }
    }
    element.addEventListener('load', loaded);
    loaded();
    return () => {
      element.removeEventListener('load', loaded);
      observer?.disconnect();
      currentFrame.contentDocument?.body?.removeEventListener('input', input);
      currentFrame.contentDocument?.body?.removeEventListener('click', preventNavigation);
    };
  }, [source, editable]);

  return (
    <iframe
      ref={frame}
      title={editable ? 'Signature visual editor' : 'Signature preview'}
      className="min-h-16 w-full border-0 bg-white"
      sandbox="allow-same-origin"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline';"><style>body{margin:8px;color:#111;background:white;font:14px Arial,sans-serif;overflow-wrap:break-word;min-height:${editable ? 140 : 0}px;outline:none}img{max-width:100%}</style></head><body>${sanitizeSignature(source)}</body></html>`}
    />
  );
}
