import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { ShortcutsHelp } from "@/components/mail/shortcuts-help";

// useKeys reads settings through react-query.
function renderHelp(open: boolean) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ShortcutsHelp open={open} onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}

describe("ShortcutsHelp", () => {
  it("lists every shortcut when open", () => {
    renderHelp(true);
    for (const label of [
      "Compose",
      "Reply",
      "Reply all",
      "Forward",
      "Archive",
      "Move to trash",
      "Mark as unread",
      "Mark as read",
      "Select multiple",
      "Select range",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("renders nothing while closed", () => {
    renderHelp(false);
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });
});
