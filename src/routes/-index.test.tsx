import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useState } from "react";
import type { Account } from "@/types/account";

import { Home } from "@/components/auth/home";

const accountState = vi.hoisted(() => ({
  activeAccount: null as Account | null,
}));

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: accountState.activeAccount,
    isLoading: false,
  }),
}));

vi.mock("@/components/mail/mail", () => ({
  Mail: () => {
    const [selected, setSelected] = useState(false);
    return (
      <button onClick={() => setSelected(true)}>
        {selected ? "Selected message" : "Mail client"}
      </button>
    );
  },
}));

vi.mock("@/components/auth/sign-in", () => ({
  SignIn: () => <div>Connect an account</div>,
}));

vi.mock("@/lib/auth", () => ({ isDesktopApp: true }));

describe("home account gate", () => {
  it("does not mount mail without an active desktop account", () => {
    render(<Home />);

    expect(screen.getByText("Connect an account")).toBeInTheDocument();
    expect(screen.queryByText("Mail client")).not.toBeInTheDocument();
  });
});

it.each(["google", "icloud"] as const)(
  "resets mail view state when switching %s accounts",
  (kind) => {
    accountState.activeAccount = { id: "A", kind } as Account;
    const { rerender } = render(<Home />);
    fireEvent.click(screen.getByText("Mail client"));
    expect(screen.getByText("Selected message")).toBeInTheDocument();
    accountState.activeAccount = { id: "B", kind } as Account;
    rerender(<Home />);
    expect(screen.getByText("Mail client")).toBeInTheDocument();
    expect(screen.queryByText("Selected message")).not.toBeInTheDocument();
    accountState.activeAccount = null;
  },
);
