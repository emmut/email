import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Account } from "@/types/account";

export const accountsQuery = queryOptions({
  queryKey: ["accounts"],
  queryFn: () => invoke<Account[]>("list_accounts"),
  staleTime: 30_000,
});

export function googleAccessTokenQuery(accountId: string) {
  return queryOptions({
    queryKey: ["accounts", accountId, "google_access_token"],
    queryFn: () => invoke<string>("get_google_access_token", { account_id: accountId }),
    enabled: !!accountId,
    staleTime: 50_000, // tokens last ~55 min
  });
}
