import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

import { cacheGet } from '@/lib/cache';
import { signatureQuery } from '@/lib/gmail';
import { sanitizeSignature } from '@/lib/signature-html';
import type { Account } from '@/types/account';

export interface SavedSignature {
  id: string;
  name: string;
  html: string;
}

export interface SignatureLibrary {
  signatures: SavedSignature[];
  // Missing = original account/Gmail signature; null = explicitly none.
  defaults: Record<string, string | null>;
}

export const ACCOUNT_SIGNATURE = 'account';
export const NO_SIGNATURE = 'none';
const libraryKey = 'signature-library:v1';

export const signatureLibraryQuery = queryOptions({
  queryKey: ['signature-library'],
  queryFn: async (): Promise<SignatureLibrary> => {
    // Signatures are user data. Surface storage errors instead of overwriting
    // a library we couldn't read with an empty one.
    const json = await invoke<string | null>('cache_get_json', { key: libraryKey });
    return json ? JSON.parse(json) : { signatures: [], defaults: {} };
  },
  staleTime: Infinity,
});

export function useSignatureLibrary() {
  const queryClient = useQueryClient();
  const query = useQuery(signatureLibraryQuery);
  const mutation = useMutation({
    scope: { id: 'signature-library' },
    mutationFn: async (update: (current: SignatureLibrary) => SignatureLibrary) => {
      const current = await queryClient.ensureQueryData(signatureLibraryQuery);
      const next = update(current);
      await invoke('cache_put_json', { key: libraryKey, json: JSON.stringify(next) });
      queryClient.setQueryData(signatureLibraryQuery.queryKey, next);
      return next;
    },
  });
  return {
    ...query,
    update: mutation.mutateAsync,
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}

export function upsertSignature(
  library: SignatureLibrary,
  signature: SavedSignature,
): SignatureLibrary {
  const name = signature.name.trim();
  if (!name) {
    throw new Error('Give the signature a name.');
  }
  const saved = { ...signature, name, html: sanitizeSignature(signature.html) };
  return {
    ...library,
    signatures: library.signatures.some((item) => item.id === saved.id)
      ? library.signatures.map((item) => (item.id === saved.id ? saved : item))
      : [...library.signatures, saved],
  };
}

export function removeSignature(library: SignatureLibrary, id: string): SignatureLibrary {
  return {
    signatures: library.signatures.filter((signature) => signature.id !== id),
    // Deleting an assigned signature disables it for those accounts. Falling
    // back to a different identity's signature would be surprising.
    defaults: Object.fromEntries(
      Object.entries(library.defaults).map(([account, value]) => [
        account,
        value === id ? null : value,
      ]),
    ),
  };
}

export function defaultSignatureChoice(library: SignatureLibrary, accountId: string): string {
  const id = library.defaults[accountId];
  if (id === null) {
    return NO_SIGNATURE;
  }
  return id && library.signatures.some((signature) => signature.id === id) ? id : ACCOUNT_SIGNATURE;
}

export function resolveSignature(
  library: SignatureLibrary,
  choice: string,
  accountSignature: string,
): string {
  if (choice === NO_SIGNATURE) {
    return '';
  }
  if (choice === ACCOUNT_SIGNATURE) {
    return accountSignature;
  }
  return library.signatures.find((signature) => signature.id === choice)?.html ?? '';
}

export function setDefaultSignature(
  library: SignatureLibrary,
  accountId: string,
  choice: string,
): SignatureLibrary {
  const defaults = { ...library.defaults };
  if (choice === ACCOUNT_SIGNATURE) {
    delete defaults[accountId];
  } else {
    defaults[accountId] = choice === NO_SIGNATURE ? null : choice;
  }
  return { ...library, defaults };
}

// Keep legacy signatures in place. They remain available as "Account signature"
// and can be saved to the shared library without a destructive migration.
export function localSignatureQuery(accountId: string) {
  return queryOptions({
    queryKey: ['signature', accountId],
    queryFn: () => cacheGet<string>(`signature:${accountId}`),
    staleTime: Infinity,
  });
}

export function clearLocalSignature(accountId: string) {
  return invoke('cache_put_json', { key: `signature:${accountId}`, json: 'null' });
}

export function useSignature(account: Account | null | undefined, includeAccountSignature = false) {
  const library = useQuery(signatureLibraryQuery);
  const local = useQuery({ ...localSignatureQuery(account?.id ?? ''), enabled: !!account });
  const data = library.data ?? { signatures: [], defaults: {} };
  const choice = defaultSignatureChoice(data, account?.id ?? '');
  const usesHosted = (!account || account.kind === 'google') && local.data == null;
  const hosted = useQuery({
    ...signatureQuery(account?.id),
    enabled:
      usesHosted &&
      (!account || local.isSuccess) &&
      (includeAccountSignature || choice === ACCOUNT_SIGNATURE),
  });
  const hostedSignature = usesHosted ? (hosted.data ?? '') : '';
  const accountSignature = local.data ?? hostedSignature;
  const accountIsPending = (!!account && local.isPending) || (usesHosted && hosted.isPending);
  const isPending = library.isPending || (choice === ACCOUNT_SIGNATURE && accountIsPending);
  return {
    signature: resolveSignature(data, choice, accountSignature),
    accountSignature,
    accountIsPending,
    choice,
    isPending,
    error: library.error,
    hasLocal: local.data != null,
  };
}
