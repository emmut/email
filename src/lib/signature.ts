import { queryOptions, useQuery } from "@tanstack/react-query";

import { cacheDeletePrefix, cacheGet, cachePut } from "@/lib/cache";
import { signatureQuery } from "@/lib/gmail";
import type { Account } from "@/types/account";

// Per-account signatures stored locally. iCloud has no server-side signature
// concept (Apple keeps them per device), and Gmail's hosted signature only
// makes sense for the Gmail identity — so a local signature is the primary
// source, with the Gmail-hosted one as fallback for Google accounts.
//
// Semantics: no KV row = no override (Google accounts fall back to the
// hosted signature); "" = explicitly no signature.

const localKey = (accountId: string) => `signature:${accountId}`;

export function localSignatureQuery(accountId: string) {
  return queryOptions({
    queryKey: ["signature", accountId],
    queryFn: () => cacheGet<string>(localKey(accountId)),
    staleTime: Infinity,
  });
}

export function saveLocalSignature(accountId: string, html: string) {
  cachePut(localKey(accountId), html);
}

export function clearLocalSignature(accountId: string) {
  return cacheDeletePrefix(localKey(accountId));
}

// Resolved signature for an account: local override, else Gmail-hosted for
// Google accounts (and for the legacy no-account-row Google sign-in).
export function useSignature(account: Account | null | undefined) {
  const usesHosted = !account || account.kind === "google";
  const local = useQuery({
    ...localSignatureQuery(account?.id ?? ""),
    enabled: !!account,
  });
  const hosted = useQuery({ ...signatureQuery, enabled: usesHosted });

  const isPending =
    (!!account && local.isPending) ||
    (usesHosted && local.data == null && hosted.isPending);
  const signature =
    local.data ?? (usesHosted ? (hosted.data ?? "") : "");
  return { signature, isPending, hasLocal: local.data != null };
}
