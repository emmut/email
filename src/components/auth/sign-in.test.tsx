import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SignIn } from "@/components/auth/sign-in";

const accountState = vi.hoisted(() => ({
  addGoogleAccount: vi.fn<() => Promise<void>>(),
  addICloudAccount: vi.fn<
    (email: string, password: string) => Promise<void>
  >(),
  refetch: vi.fn<() => Promise<void>>(),
  accountsError: null as Error | null,
}));

vi.mock("@/context/AccountContext", () => ({
  useAccount: () => accountState,
}));

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { mutations: { retry: false } },
        })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

beforeEach(() => {
  accountState.addGoogleAccount.mockReset().mockResolvedValue();
  accountState.addICloudAccount.mockReset().mockResolvedValue();
  accountState.refetch.mockReset().mockResolvedValue();
  accountState.accountsError = null;
});

describe("SignIn", () => {
  it("keeps the iCloud form open and explains rejected credentials", async () => {
    const user = userEvent.setup();
    accountState.addICloudAccount.mockRejectedValue(
      new Error("iCloud rejected that app-specific password"),
    );
    render(<SignIn />, { wrapper: Wrapper });

    await user.click(
      screen.getByRole("button", { name: "Continue with iCloud" }),
    );
    await user.type(screen.getByLabelText("iCloud email"), "me@icloud.com");
    await user.type(
      screen.getByLabelText("App-specific password"),
      "abcd-efgh-ijkl-mnop",
    );
    await user.click(
      screen.getByRole("button", { name: "Connect iCloud Mail" }),
    );

    await waitFor(() =>
      expect(
        screen.getByText("iCloud rejected that app-specific password"),
      ).toBeInTheDocument(),
    );
    expect(screen.getByLabelText("iCloud email")).toHaveValue(
      "me@icloud.com",
    );
  });

  it("offers recovery when the account database cannot be loaded", async () => {
    const user = userEvent.setup();
    accountState.accountsError = new Error("database unavailable");
    render(<SignIn />, { wrapper: Wrapper });

    expect(
      screen.getByText("We couldn't load your accounts"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(accountState.refetch).toHaveBeenCalledOnce();
  });
});
