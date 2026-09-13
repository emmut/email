import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Home } from "@/components/auth/home";

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: null,
    isLoading: false,
  }),
}));

vi.mock("@/components/mail/mail", () => ({
  Mail: () => <div>Mail client</div>,
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
