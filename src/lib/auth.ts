import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import type { Account } from "@/types/account";

// `pnpm dev` in a plain browser has no Tauri backend — pretend we're signed in
// so the mock inbox stays reachable.
const inTauri = "__TAURI_INTERNALS__" in window;

export const authStatusQuery = queryOptions({
  queryKey: ["auth", "status"],
  queryFn: () => (inTauri ? invoke<boolean>("auth_status") : Promise.resolve(true)),
  staleTime: Infinity,
});

export function signIn(): Promise<void> {
  return invoke("sign_in");
}

export function signOut(): Promise<void> {
  return invoke("sign_out");
}

// The per-account keychain entry is the canonical token store; the legacy
// single "gmail-refresh-token" entry only exists for sign-ins that predate
// multi-account support (no account row). Gmail is still single-account, so
// the first Google account row wins.
let googleAccountIdPromise: Promise<string | null> | null = null;

function findGoogleAccountId(): Promise<string | null> {
  googleAccountIdPromise ??= invoke<Account[]>("list_accounts")
    .then((accounts) => accounts.find((a) => a.kind === "google")?.id ?? null)
    .catch(() => null)
    .then((id) => {
      // Only a found id is worth caching — a Google account can be added later.
      if (!id) googleAccountIdPromise = null;
      return id;
    });
  return googleAccountIdPromise;
}

// Sign-out + sign-in creates a NEW account row (new id, new keychain entry);
// call this whenever accounts change so the next token fetch re-resolves.
export function resetGoogleAccountId() {
  googleAccountIdPromise = null;
}

export async function getAccessToken(): Promise<string> {
  const accountId = await findGoogleAccountId();
  if (accountId) {
    try {
      return await invoke("get_google_access_token", { account_id: accountId });
    } catch (err) {
      // Belt and braces: the cached id may point at a removed account row.
      // Re-resolve once; rethrow if the account genuinely can't refresh.
      resetGoogleAccountId();
      const freshId = await findGoogleAccountId();
      if (freshId && freshId !== accountId) {
        return invoke("get_google_access_token", { account_id: freshId });
      }
      throw err;
    }
  }
  return invoke("get_access_token");
}
