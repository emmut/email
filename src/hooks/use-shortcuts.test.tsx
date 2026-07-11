import { describe, expect, it, vi } from "vitest";
import { fireEvent, renderHook } from "@testing-library/react";

import { useKeyboardShortcuts } from "@/hooks/use-shortcuts";

describe("useKeyboardShortcuts", () => {
  it("fires the handler for its key", () => {
    const onE = vi.fn();
    renderHook(() => useKeyboardShortcuts({ e: onE }));
    fireEvent.keyDown(window, { key: "e" });
    expect(onE).toHaveBeenCalledTimes(1);
  });

  it("ignores keys with modifiers held", () => {
    const onE = vi.fn();
    renderHook(() => useKeyboardShortcuts({ e: onE }));
    fireEvent.keyDown(window, { key: "e", ctrlKey: true });
    fireEvent.keyDown(window, { key: "e", metaKey: true });
    expect(onE).not.toHaveBeenCalled();
  });

  it("is suppressed while typing in an input", () => {
    const onE = vi.fn();
    renderHook(() => useKeyboardShortcuts({ e: onE }));
    const input = document.createElement("input");
    document.body.appendChild(input);
    fireEvent.keyDown(input, { key: "e" });
    expect(onE).not.toHaveBeenCalled();
    input.remove();
  });

  it("is suppressed while a dialog is open", () => {
    const onE = vi.fn();
    renderHook(() => useKeyboardShortcuts({ e: onE }));
    const dialog = document.createElement("div");
    dialog.setAttribute("data-slot", "dialog-content");
    document.body.appendChild(dialog);
    fireEvent.keyDown(window, { key: "e" });
    expect(onE).not.toHaveBeenCalled();
    dialog.remove();
  });

  it("stops listening after unmount", () => {
    const onE = vi.fn();
    const { unmount } = renderHook(() => useKeyboardShortcuts({ e: onE }));
    unmount();
    fireEvent.keyDown(window, { key: "e" });
    expect(onE).not.toHaveBeenCalled();
  });
});
