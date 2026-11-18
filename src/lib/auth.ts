import { invoke, isTauri } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import type { Account } from "@/types/account";

// `pnpm dev` in a plain browser has no Tauri backend — pretend we're signed in
// so the mock inbox stays reachable.
const inTauri = isTauri();
export const isDesktopApp = inTauri;

export const authStatusQuery = queryOptions({
  queryKey: ["auth", "status"],
  queryFn: () =>
    inTauri ? invoke<boolean>("auth_status") : Promise.resolve(true),
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
// multi-account support (no account row).
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

// A revoked/expired refresh token makes the token endpoint answer
// 400 invalid_grant — every Gmail call then fails before the API is reached.
// Translate that into something the user can act on; Tauri command errors
// arrive as plain strings, which also produce a blank "Action failed:".
function withTokenRenewHint(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes("invalid_grant")) {
    return new Error(
      "Gmail access expired or was revoked, so actions can't be sent. Re-grant access under Settings → Accounts.",
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

// Concurrent inbox/profile/count requests share one refresh. Do not retain
// resolved tokens here: the backend owns expiry and refresh-token storage.
const pendingTokens = new Map<string | null, Promise<string>>();

export function getAccessToken(
  accountId: string | null = localStorage.getItem("activeAccountId"),
): Promise<string> {
  let pending = pendingTokens.get(accountId);
  if (!pending) {
    pending = resolveAccessToken(accountId).finally(() =>
      pendingTokens.delete(accountId),
    );
    pendingTokens.set(accountId, pending);
  }
  return pending;
}

async function resolveAccessToken(accountId: string | null): Promise<string> {
  try {
    // An explicit account must never fall back to another user's token.
    if (accountId) {
      return await invoke("get_google_access_token", { account_id: accountId });
    }

    const legacyAccountId = await findGoogleAccountId();
    if (legacyAccountId) {
      try {
        return await invoke("get_google_access_token", {
          account_id: legacyAccountId,
        });
      } catch (err) {
        // Belt and braces: the cached id may point at a removed account row.
        // Re-resolve once; rethrow if the account genuinely can't refresh.
        resetGoogleAccountId();
        const freshId = await findGoogleAccountId();
        if (freshId && freshId !== legacyAccountId) {
          return await invoke("get_google_access_token", {
            account_id: freshId,
          });
        }
        throw err;
      }
    }
    return await invoke("get_access_token");
  } catch (err) {
    throw withTokenRenewHint(err);
  }
}
