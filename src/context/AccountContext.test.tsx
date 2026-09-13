import type { ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";

import { AccountProvider, useAccount } from "@/context/AccountContext";
import type { Account } from "@/types/account";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@/lib/auth", () => ({ resetGoogleAccountId: vi.fn() }));

const mockInvoke = vi.mocked(invoke);

const googleAccount: Account = {
  id: "google-1",
  kind: "google",
  email: "me@example.com",
  display_name: null,
  avatar_url: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_synced_at: null,
  is_default: true,
};

beforeEach(() => {
  mockInvoke.mockReset();
  localStorage.clear();
});

describe("AccountProvider onboarding", () => {
  it("selects a newly connected account before onboarding completes", async () => {
    let accounts: Account[] = [];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "list_accounts") return accounts;
      if (command === "add_google_account") {
        accounts = [googleAccount];
        return googleAccount;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AccountProvider queryClient={client}>{children}</AccountProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(useAccount, { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.activeAccount).toBeNull();

    await act(() => result.current.addGoogleAccount());

    expect(result.current.activeAccount).toEqual(googleAccount);
    expect(localStorage.getItem("activeAccountId")).toBe(googleAccount.id);
  });

  it("returns to the no-account state after removing the final account", async () => {
    let accounts: Account[] = [googleAccount];
    mockInvoke.mockImplementation(async (command) => {
      if (command === "list_accounts") return accounts;
      if (command === "remove_account") {
        accounts = [];
        return;
      }
      throw new Error(`unexpected command: ${command}`);
    });

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>
        <AccountProvider queryClient={client}>{children}</AccountProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(useAccount, { wrapper });

    await waitFor(() =>
      expect(result.current.activeAccount?.id).toBe(googleAccount.id),
    );
    await act(() => result.current.removeAccount(googleAccount.id));

    expect(result.current.accounts).toEqual([]);
    expect(result.current.activeAccount).toBeNull();
    expect(localStorage.getItem("activeAccountId")).toBeNull();
  });
});
