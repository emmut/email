import { describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

import { noDialogOpen, useMenuEvents } from "@/hooks/use-menu";

const state = vi.hoisted(() => ({
  handler: undefined as ((event: { payload: string }) => void) | undefined,
  unlisten: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_event: string, cb: (event: { payload: string }) => void) => {
    state.handler = cb;
    return Promise.resolve(state.unlisten);
  },
}));

describe("useMenuEvents", () => {
  it("dispatches menu events to the matching handler", async () => {
    const reply = vi.fn();
    renderHook(() => useMenuEvents({ reply }));
    await waitFor(() => expect(state.handler).toBeDefined());

    state.handler!({ payload: "reply" });
    expect(reply).toHaveBeenCalledTimes(1);

    // Unknown ids are ignored without throwing.
    state.handler!({ payload: "does-not-exist" });
    expect(reply).toHaveBeenCalledTimes(1);
  });

  it("uses the latest handlers after a re-render", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(
      ({ fn }: { fn: () => void }) => useMenuEvents({ trash: fn }),
      { initialProps: { fn: first } },
    );
    await waitFor(() => expect(state.handler).toBeDefined());

    rerender({ fn: second });
    state.handler!({ payload: "trash" });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("noDialogOpen", () => {
  it("is true with no dialog in the DOM", () => {
    expect(noDialogOpen()).toBe(true);
  });

  it("is false while a dialog or alert dialog is open", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("data-slot", "alert-dialog-content");
    document.body.appendChild(dialog);
    expect(noDialogOpen()).toBe(false);
    dialog.remove();
  });
});
