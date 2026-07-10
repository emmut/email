"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useQuery, useMutation, QueryClient } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { accountsQuery, googleAccessTokenQuery } from "@/lib/accounts";
import type { Account } from "@/types/account";

interface AccountContextValue {
  accounts: Account[];
  activeAccountId: string | null;
  activeAccount: Account | null;
  isLoading: boolean;
  switchAccount: (id: string) => Promise<void>;
  addGoogleAccount: () => Promise<void>;
  addICloudAccount: (email: string, appPassword: string) => Promise<void>;
  removeAccount: (id: string) => Promise<void>;
  setDefaultAccount: (id: string) => Promise<void>;
  getGoogleAccessToken: (accountId: string) => Promise<string>;
  refetch: () => Promise<void>;
}

const AccountContext = createContext<AccountContextValue | null>(null);

export function AccountProvider({ children, queryClient }: { children: React.ReactNode; queryClient: QueryClient }) {
  const [activeAccountId, setActiveAccountId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const { data: accounts = [], isLoading, refetch } = useQuery(accountsQuery);

  // Load active account from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem("activeAccountId");
    if (stored && accounts.some((a) => a.id === stored)) {
      setActiveAccountId(stored);
    } else if (accounts.length > 0) {
      // Default to first (default) account
      const defaultAcc = accounts.find((a) => a.is_default) ?? accounts[0];
      setActiveAccountId(defaultAcc.id);
      localStorage.setItem("activeAccountId", defaultAcc.id);
    }
    setHydrated(true);
  }, [accounts]);

  const activeAccount = accounts.find((a) => a.id === activeAccountId) ?? null;

  const switchAccount = useMutation({
    mutationFn: async (id: string) => {
      localStorage.setItem("activeAccountId", id);
      setActiveAccountId(id);
      // Invalidate all mail queries
      queryClient.invalidateQueries({ queryKey: ["mail"] });
      queryClient.invalidateQueries({ queryKey: ["gmail"] });
      queryClient.invalidateQueries({ queryKey: ["icloud"] });
    },
  });

  const addGoogleAccount = useMutation({
    mutationFn: () => invoke<Account>("add_google_account", { display_name: undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const addICloudAccount = useMutation({
    mutationFn: (params: { email: string; appPassword: string }) =>
      invoke<Account>("add_icloud_account", {
        email: params.email,
        app_password: params.appPassword,
        display_name: undefined,
        imap_server: undefined,
        imap_port: undefined,
        smtp_server: undefined,
        smtp_port: undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const removeAccount = useMutation({
    mutationFn: (id: string) => invoke("remove_account", { account_id: id }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      if (activeAccountId === id) {
        // Switch to another account if available
        const remaining = accounts.filter((a) => a.id !== id);
        if (remaining.length > 0) {
          switchAccount.mutate(remaining[0].id);
        } else {
          setActiveAccountId(null);
          localStorage.removeItem("activeAccountId");
        }
      }
    },
  });

  const setDefaultAccount = useMutation({
    mutationFn: (id: string) => invoke("set_default_account", { account_id: id }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    },
  });

  const getGoogleAccessToken = (accountId: string) =>
    // fetchQuery honours staleTime (50s) — getQueryData would keep returning
    // a token past its ~55-minute expiry. The backend caches in memory, so a
    // refetch is a hashmap lookup, not an OAuth round trip.
    queryClient.fetchQuery(googleAccessTokenQuery(accountId));

  return (
    <AccountContext.Provider
      value={{
        accounts,
        activeAccountId,
        activeAccount,
        isLoading: isLoading || !hydrated,
        switchAccount: (id) => switchAccount.mutateAsync(id).then(() => {}),
        addGoogleAccount: () => addGoogleAccount.mutateAsync().then(() => {}),
        addICloudAccount: (email, appPassword) => addICloudAccount.mutateAsync({ email, appPassword }).then(() => {}),
        removeAccount: (id) => removeAccount.mutateAsync(id).then(() => {}),
        setDefaultAccount: (id) => setDefaultAccount.mutateAsync(id).then(() => {}),
        getGoogleAccessToken,
        refetch: () => refetch().then(() => {}),
      }}
    >
      {children}
    </AccountContext.Provider>
  );
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used within AccountProvider");
  return ctx;
}