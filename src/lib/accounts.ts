import { queryOptions } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import type { Account, AccountConfig, IcloudAccountConfig } from "@/types/account";

export const accountsQuery = queryOptions({
  queryKey: ["accounts"],
  queryFn: () => invoke<Account[]>("list_accounts"),
  staleTime: 30_000,
});

export function accountConfigQuery(accountId: string) {
  return queryOptions({
    queryKey: ["accounts", accountId, "config"],
    queryFn: () => invoke<AccountConfig>("get_account_config", { account_id: accountId }),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}

export function googleAccessTokenQuery(accountId: string) {
  return queryOptions({
    queryKey: ["accounts", accountId, "google_access_token"],
    queryFn: () => invoke<string>("get_google_access_token", { account_id: accountId }),
    enabled: !!accountId,
    staleTime: 50_000, // tokens last ~55 min
  });
}

export function icloudCredentialsQuery(accountId: string) {
  return queryOptions({
    queryKey: ["accounts", accountId, "icloud_credentials"],
    queryFn: () => invoke<IcloudAccountConfig>("get_icloud_credentials", { account_id: accountId }),
    enabled: !!accountId,
    staleTime: 30_000,
  });
}