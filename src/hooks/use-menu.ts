import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";

// Native menu items the Rust side doesn't handle itself arrive as a single
// "menu" event whose payload is the menu item id (see on_menu_event in
// src-tauri/src/lib.rs). Handlers are keyed by that id.
export function useMenuEvents(handlers: Record<string, () => void>) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    const unlisten = listen<string>("menu", (event) => {
      handlersRef.current[event.payload]?.();
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);
}

// Mirrors the guard in use-shortcuts: menu commands that mutate mail or open
// compose shouldn't fire behind an open modal (e.g. Cmd+N replacing a
// half-written draft).
export function noDialogOpen(): boolean {
  return !document.querySelector(
    '[data-slot="dialog-content"], [data-slot="alert-dialog-content"]',
  );
}
