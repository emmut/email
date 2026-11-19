import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import type { Account } from '@/types/account';
import {
  ACCOUNT_SIGNATURE,
  NO_SIGNATURE,
  defaultSignatureChoice,
  removeSignature,
  resolveSignature,
  setDefaultSignature,
  upsertSignature,
  useSignature,
  useSignatureLibrary,
  type SignatureLibrary,
} from '@/lib/signature';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/lib/gmail', () => ({
  signatureQuery: (id?: string) => ({
    queryKey: ['gmail', id, 'signature'],
    queryFn: async () => `<p>Gmail ${id ?? 'legacy'}</p>`,
    staleTime: Infinity,
  }),
}));

const account = { id: 'a', kind: 'google', email: 'a@example.com' } as Account;
const work = {
  id: 'work',
  name: 'Work',
  html: '<img src="https://example.com/logo.png" width="96">',
};
const personal = { id: 'personal', name: 'Personal', html: '<p>Jane</p>' };
const sample = (): SignatureLibrary => ({ signatures: [work, personal], defaults: {} });
let storage: Map<string, string>;

function clientWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  storage = new Map();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const data = args as { key: string; json?: string };
    if (command === 'cache_get_json') return storage.get(data.key) ?? null;
    if (command === 'cache_put_json') {
      storage.set(data.key, data.json!);
      return;
    }
    throw new Error(`Unexpected command: ${command}`);
  });
});

describe('shared signatures and account defaults', () => {
  it('reuses a signature across accounts with independent defaults', () => {
    let library = setDefaultSignature(sample(), 'a', 'work');
    library = setDefaultSignature(library, 'b', 'personal');
    expect(defaultSignatureChoice(library, 'a')).toBe('work');
    expect(defaultSignatureChoice(library, 'b')).toBe('personal');
    library = setDefaultSignature(library, 'b', 'work');
    expect(library.signatures).toHaveLength(2);
    expect(resolveSignature(library, defaultSignatureChoice(library, 'b'), 'fallback')).toBe(
      work.html,
    );
    library = setDefaultSignature(library, 'a', NO_SIGNATURE);
    expect(defaultSignatureChoice(library, 'b')).toBe('work');
  });

  it('distinguishes no signature, original account fallback, and empty named signatures', () => {
    let library = setDefaultSignature(sample(), 'a', NO_SIGNATURE);
    expect(resolveSignature(library, defaultSignatureChoice(library, 'a'), 'Gmail')).toBe('');
    library = setDefaultSignature(library, 'a', ACCOUNT_SIGNATURE);
    expect(library.defaults).not.toHaveProperty('a');
    expect(resolveSignature(library, defaultSignatureChoice(library, 'a'), 'Gmail')).toBe('Gmail');
    library = upsertSignature(library, { id: 'blank', name: 'Blank', html: '' });
    expect(resolveSignature(library, 'blank', 'Gmail')).toBe('');
  });

  it('cleans defaults for every affected account when deleting a shared signature', () => {
    const library = removeSignature(
      { ...sample(), defaults: { a: 'work', b: 'work', c: 'personal', d: null } },
      'work',
    );
    expect(library.defaults).toEqual({ a: null, b: null, c: 'personal', d: null });
    expect(library.signatures).toEqual([personal]);
  });

  it('updates in place, sanitizes HTML and preserves image-only signatures', () => {
    const library = upsertSignature(sample(), {
      ...work,
      name: '  Updated  ',
      html: `${work.html}<script>alert(1)</script>`,
    });
    expect(library.signatures.map((item) => item.id)).toEqual(['work', 'personal']);
    expect(library.signatures[0]).toEqual({ ...work, name: 'Updated' });
    expect(() => upsertSignature(library, { ...work, name: ' ' })).toThrow('name');
  });
});

describe('signature persistence and legacy compatibility', () => {
  it('keeps original local signatures and explicitly blank overrides', async () => {
    storage.set('signature:a', JSON.stringify('<p>Original</p>'));
    const first = clientWrapper();
    const { result, unmount } = renderHook(() => useSignature(account), first);
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.signature).toBe('<p>Original</p>');
    expect(storage.has('signature-library:v1')).toBe(false);
    unmount();
    storage.set('signature:a', JSON.stringify(''));
    const second = renderHook(() => useSignature(account), clientWrapper());
    await waitFor(() => expect(second.result.current.isPending).toBe(false));
    expect(second.result.current.signature).toBe('');
  });

  it('falls back to Gmail, but iCloud never inherits a Gmail signature', async () => {
    const { result, rerender } = renderHook(({ acc }) => useSignature(acc), {
      ...clientWrapper(),
      initialProps: { acc: account },
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.signature).toBe('<p>Gmail a</p>');
    rerender({ acc: { ...account, id: 'icloud', kind: 'icloud' } });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.signature).toBe('');
  });

  it('keeps hosted signatures isolated when switching Google accounts', async () => {
    const { result, rerender } = renderHook(({ acc }) => useSignature(acc), {
      ...clientWrapper(),
      initialProps: { acc: account },
    });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.signature).toBe('<p>Gmail a</p>');
    rerender({ acc: { ...account, id: 'b', email: 'b@example.com' } });
    await waitFor(() => expect(result.current.isPending).toBe(false));
    expect(result.current.signature).toBe('<p>Gmail b</p>');
  });

  it('persists a shared signature and default across a fresh query client', async () => {
    const { result } = renderHook(() => useSignatureLibrary(), clientWrapper());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    await act(async () => {
      await result.current.update((library) =>
        setDefaultSignature(upsertSignature(library, work), 'a', 'work'),
      );
    });
    const { result: reopened } = renderHook(() => useSignature(account), clientWrapper());
    await waitFor(() => expect(reopened.current.isPending).toBe(false));
    expect(reopened.current.signature).toBe(work.html);
    expect(reopened.current.choice).toBe('work');
  });

  it('leaves the saved library unchanged when storage fails', async () => {
    const { result } = renderHook(() => useSignatureLibrary(), clientWrapper());
    await waitFor(() => expect(result.current.isPending).toBe(false));
    vi.mocked(invoke).mockImplementationOnce(async () => {
      throw new Error('Disk full');
    });
    await act(async () => {
      await expect(
        result.current.update((library) => upsertSignature(library, work)),
      ).rejects.toThrow('Disk full');
    });
    expect(result.current.data?.signatures).toEqual([]);
    await waitFor(() => expect(result.current.saveError?.message).toBe('Disk full'));
    expect(storage.has('signature-library:v1')).toBe(false);
  });

  it('does not replace an unreadable library with empty data', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('Storage unavailable'));
    const { result } = renderHook(() => useSignatureLibrary(), clientWrapper());
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(vi.mocked(invoke).mock.calls.every(([command]) => command === 'cache_get_json')).toBe(
      true,
    );
  });
});
