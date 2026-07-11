import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { CommandPalette } from "@/components/mail/command-palette";
import { mail } from "@/test/fixtures";

vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: { id: "a1", kind: "icloud", email: "e@icloud.com" },
    activeAccountId: "a1",
    switchAccount: vi.fn(),
  }),
}));

const handlers = () => ({
  onOpenChange: vi.fn(),
  onSelectFolder: vi.fn(),
  onCompose: vi.fn(),
  onFocusSearch: vi.fn(),
  onShowShortcuts: vi.fn(),
  onSetTab: vi.fn(),
  onAct: vi.fn(),
  onEmptyTrash: vi.fn(),
});

function renderPalette(selected = mail({ read: true })) {
  const h = handlers();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CommandPalette open selected={selected} {...h} />
    </QueryClientProvider>,
  );
  return h;
}

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("CommandPalette", () => {
  it("lists global actions", () => {
    renderPalette();
    for (const label of [
      "Compose",
      "Search mail",
      "Refresh",
      "Empty trash",
      "Keyboard shortcuts",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("shows Mark as unread for a read message and runs it", () => {
    const h = renderPalette(mail({ id: "m9", read: true }));
    const item = screen.getByText("Mark as unread");
    expect(screen.queryByText("Mark as read")).not.toBeInTheDocument();
    fireEvent.click(item);
    expect(h.onAct).toHaveBeenCalledWith("unread", "m9");
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows Mark as read for an unread message", () => {
    const h = renderPalette(mail({ id: "m9", read: false }));
    fireEvent.click(screen.getByText("Mark as read"));
    expect(h.onAct).toHaveBeenCalledWith("read", "m9");
  });

  it("hides message actions with nothing selected", () => {
    const h = handlers();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CommandPalette open selected={null} {...h} />
      </QueryClientProvider>,
    );
    expect(screen.queryByText("Mark as unread")).not.toBeInTheDocument();
    expect(screen.queryByText("Move to trash")).not.toBeInTheDocument();
  });

  it("empty trash asks the host for confirmation flow", () => {
    const h = renderPalette();
    fireEvent.click(screen.getByText("Empty trash"));
    expect(h.onEmptyTrash).toHaveBeenCalled();
  });

  it("navigates to folders", () => {
    const h = renderPalette();
    fireEvent.click(screen.getByText("Trash"));
    expect(h.onSelectFolder).toHaveBeenCalledWith("trash");
  });
});
