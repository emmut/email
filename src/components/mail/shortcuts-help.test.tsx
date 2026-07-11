import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { ShortcutsHelp } from "@/components/mail/shortcuts-help";

describe("ShortcutsHelp", () => {
  it("lists every shortcut when open", () => {
    render(<ShortcutsHelp open onOpenChange={vi.fn()} />);
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
    render(<ShortcutsHelp open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByText("Keyboard shortcuts")).not.toBeInTheDocument();
  });
});
