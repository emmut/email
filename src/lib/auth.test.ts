import { describe, expect, it, vi, beforeEach } from "vitest";

import { getAccessToken, resetGoogleAccountId } from "@/lib/auth";
import { invoke } from "@tauri-apps/api/core";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));

const mockInvoke = vi.mocked(invoke);

function account(id: string, kind = "google") {
  return { id, kind, email: "me@gmail.com" };
}

beforeEach(() => {
  mockInvoke.mockReset();
  resetGoogleAccountId();
});

describe("getAccessToken", () => {
  it("uses the per-account token for the Google account row", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_accounts") return [account("A")];
      if (cmd === "get_google_access_token") return "token-A";
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(getAccessToken()).resolves.toBe("token-A");
    expect(mockInvoke).toHaveBeenCalledWith("get_google_access_token", {
      account_id: "A",
    });
  });

  it("falls back to the legacy token store without a Google account", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_accounts") return [account("I", "icloud")];
      if (cmd === "get_access_token") return "legacy-token";
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(getAccessToken()).resolves.toBe("legacy-token");
  });

  it("re-resolves a stale cached account id after sign-out/sign-in", async () => {
    // First run caches account A.
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_accounts") return [account("A")];
      if (cmd === "get_google_access_token") return "token-A";
      throw new Error(`unexpected ${cmd}`);
    });
    await getAccessToken();

    // Sign-out + sign-in replaced the row: A's keychain entry is gone, the
    // new row is B. The cached id must not wedge every Gmail call.
    mockInvoke.mockImplementation(async (cmd, args) => {
      if (cmd === "list_accounts") return [account("B")];
      if (cmd === "get_google_access_token") {
        const { account_id } = args as { account_id: string };
        if (account_id === "A") throw new Error("no refresh token in keychain");
        return "token-B";
      }
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(getAccessToken()).resolves.toBe("token-B");
  });

  it("rethrows when retrying finds the same account", async () => {
    mockInvoke.mockImplementation(async (cmd) => {
      if (cmd === "list_accounts") return [account("A")];
      if (cmd === "get_google_access_token")
        throw new Error("token endpoint returned 400: invalid_grant");
      throw new Error(`unexpected ${cmd}`);
    });
    await expect(getAccessToken()).rejects.toThrow("invalid_grant");
  });
});
