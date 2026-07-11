import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MailList } from "@/components/mail/mail-list";
import { mail } from "@/test/fixtures";

const spies = vi.hoisted(() => ({
  act: vi.fn(),
  toggleTag: vi.fn(),
  moveTo: vi.fn(),
}));

vi.mock("@/hooks/use-mail-actions", () => ({
  useMailActions: () => ({ act: spies.act, isPending: false, error: null }),
  useTagActions: () => ({ toggle: spies.toggleTag }),
  useMoveToFolder: () => ({ moveTo: spies.moveTo, error: null }),
}));

// iCloud account → the Gmail tags query stays disabled.
vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: { id: "a1", kind: "icloud", email: "e@icloud.com" },
    activeAccountId: "a1",
  }),
}));

const items = [
  mail({ id: "m1", name: "Alice", subject: "First" }),
  mail({ id: "m2", name: "Bob", subject: "Second" }),
  mail({ id: "m3", name: "Carol", subject: "Third" }),
];

function renderList(
  props: Partial<Parameters<typeof MailList>[0]> = {},
  client = new QueryClient(),
) {
  const onSelect = vi.fn();
  const onToggleCheck = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MailList
        items={items}
        selectedId={null}
        onSelect={onSelect}
        checkedIds={new Set()}
        onToggleCheck={onToggleCheck}
        inTrash={false}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onSelect, onToggleCheck };
}

// Rows are role="button"; the per-row checkbox is role="checkbox".
const row = (name: string) =>
  screen.getByText(name).closest('[role="button"]')!;

beforeEach(() => {
  spies.act.mockClear();
  spies.toggleTag.mockClear();
});

describe("MailList", () => {
  it("renders sender, subject and snippet", () => {
    renderList();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getAllByText("Are you free tomorrow?")).toHaveLength(3);
  });

  it("plain click opens the mail", () => {
    const { onSelect, onToggleCheck } = renderList();
    fireEvent.click(row("Alice"));
    expect(onSelect).toHaveBeenCalledWith("m1");
    expect(onToggleCheck).not.toHaveBeenCalled();
  });

  it("ctrl/cmd+click toggles selection instead of opening", () => {
    const { onSelect, onToggleCheck } = renderList();
    fireEvent.click(row("Bob"), { ctrlKey: true });
    expect(onToggleCheck).toHaveBeenCalledWith("m2", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("shift+click extends the selection once one exists", () => {
    const { onToggleCheck } = renderList({ checkedIds: new Set(["m1"]) });
    fireEvent.click(row("Carol"), { shiftKey: true });
    expect(onToggleCheck).toHaveBeenCalledWith("m3", true);
  });

  it("shift+click without a selection opens the mail", () => {
    const { onSelect, onToggleCheck } = renderList();
    fireEvent.click(row("Carol"), { shiftKey: true });
    expect(onSelect).toHaveBeenCalledWith("m3");
    expect(onToggleCheck).not.toHaveBeenCalled();
  });

  it("checkbox click toggles without opening the mail", () => {
    const { onSelect, onToggleCheck } = renderList();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(onToggleCheck).toHaveBeenCalledWith("m1", false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("offers Move to folder with custom mailboxes on iCloud", () => {
    const client = new QueryClient();
    client.setQueryData(["icloud", "a1", "folders"], ["Kvitton", "Resor"]);
    renderList({}, client);

    fireEvent.contextMenu(row("Alice"));
    expect(screen.getByText("Move to folder")).toBeInTheDocument();
  });

  it("hides Gmail tags in the context menu on an iCloud account", () => {
    // A disabled query still returns cached data: seed the cache as if a
    // Gmail account had been active before the switch to iCloud.
    const client = new QueryClient();
    client.setQueryData(["gmail", "tags"], [{ id: "Label_1", name: "Work" }]);
    renderList({}, client);

    fireEvent.contextMenu(row("Alice"));
    expect(screen.getByText("Archive")).toBeInTheDocument(); // menu is open
    expect(screen.queryByText("Tags")).not.toBeInTheDocument();
  });

  it("reflects checked state on the checkboxes", () => {
    renderList({ checkedIds: new Set(["m2"]) });
    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).toHaveAttribute("data-state", "unchecked");
    expect(boxes[1]).toHaveAttribute("data-state", "checked");
  });
});
