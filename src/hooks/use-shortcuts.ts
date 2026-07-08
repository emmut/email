import { useEffect, useRef } from "react";

// Gmail-style single-key shortcuts. Handlers are keyed by KeyboardEvent.key
// ("#" and "?" arrive as their shifted character on every layout/OS).
// Suppressed while typing (inputs, the rich-text editor) or when a modal is up.
export function useKeyboardShortcuts(
  handlers: Record<string, (e: KeyboardEvent) => void>,
) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }
      if (
        document.querySelector(
          '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]',
        )
      ) {
        return;
      }
      const handler = handlersRef.current[e.key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
