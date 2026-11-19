import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { MailSidebar } from "@/components/mail/mail-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

const account = vi.hoisted(() => ({ kind: "google", isMobile: false }));

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: { id: "a1", kind: account.kind, email: "e@example.com" },
    activeAccountId: "a1",
    isLoading: false,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({
  useIsMobile: () => account.isMobile,
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

function renderSidebar({ expanded = false, tags = true } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(["gmail", "a1", "profile"], {});
  client.setQueryData(["gmail", "a1", "counts"], {});
  client.setQueryData(["gmail", "a1", "avatar"], "");
  client.setQueryData(
    ["gmail", "a1", "tags"],
    tags
      ? [
          { id: "Label_1", name: "Work" },
          { id: "Label_2", name: "Travel" },
        ]
      : [],
  );
  client.setQueryData(["icloud", "a1", "folders"], ["Receipts"]);
  client.setQueryData(["icloud", "a1", "counts"], {});
  client.setQueryData(["icloud", "avatar", "e@example.com"], "");
  client.setQueryData(["ops"], []);
  const onSelectFolder = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <SidebarProvider defaultOpen={expanded}>
        <MailSidebar
          activeFolder="tag:Label_1"
          onSelectFolder={onSelectFolder}
        />
        <SidebarTrigger />
      </SidebarProvider>
    </QueryClientProvider>,
  );
  return { onSelectFolder };
}

beforeEach(() => {
  account.kind = "google";
  account.isMobile = false;
});

describe("collapsed sidebar collections", () => {
  it("replaces individual tags with one flyout and navigates to a named tag", async () => {
    const user = userEvent.setup();
    const { onSelectFolder } = renderSidebar();
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    const trigger = screen.getByRole("button", { name: "Tags" });
    expect(trigger).toHaveAttribute("data-active");
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "Work" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await user.click(screen.getByRole("menuitem", { name: "Travel" }));
    expect(onSelectFolder).toHaveBeenCalledWith("tag:Label_2");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
  });

  it("supports keyboard opening, typeahead, Escape and focus return", async () => {
    const user = userEvent.setup();
    const { onSelectFolder } = renderSidebar();
    const trigger = screen.getByRole("button", { name: "Tags" });
    trigger.focus();
    await user.keyboard("{Enter}");
    await user.keyboard("t{Enter}");
    expect(onSelectFolder).toHaveBeenCalledWith("tag:Label_2");
    await waitFor(() => expect(trigger).toHaveFocus());
    await user.keyboard("{Enter}{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("offers creation even when there are no tags", async () => {
    const user = userEvent.setup();
    renderSidebar({ tags: false });
    await user.click(screen.getByRole("button", { name: "Tags" }));
    expect(screen.getByText("No tags yet")).toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "New tag" }));
    expect(screen.getByRole("dialog", { name: "New tag" })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByPlaceholderText("Tag name")).toHaveFocus(),
    );
  });

  it("preserves the expanded tag list and its delete context menu", () => {
    renderSidebar({ expanded: true });
    expect(
      screen.queryByRole("button", { name: "Tags" }),
    ).not.toBeInTheDocument();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Work" }));
    expect(
      screen.getByRole("menuitem", { name: "Delete tag" }),
    ).toBeInTheDocument();
  });

  it("returns to individual tags when the rail is expanded", async () => {
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tags" }),
    ).not.toBeInTheDocument();
  });

  it("uses the same flyout for iCloud folders and excludes cached Gmail tags", async () => {
    account.kind = "icloud";
    const user = userEvent.setup();
    const { onSelectFolder } = renderSidebar();
    expect(
      screen.queryByRole("button", { name: "Tags" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Folders" }));
    expect(screen.queryByText("Work")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Receipts" }));
    expect(onSelectFolder).toHaveBeenCalledWith("icloud-mbx:Receipts");
  });

  it("keeps the full tag list in the mobile drawer even when desktop is collapsed", async () => {
    account.isMobile = true;
    const user = userEvent.setup();
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    expect(screen.getByRole("button", { name: "Work" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Tags" }),
    ).not.toBeInTheDocument();
  });
});
