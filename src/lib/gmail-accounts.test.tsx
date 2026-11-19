import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { fetch } from '@tauri-apps/plugin-http';
import { getAccessToken } from '@/lib/auth';
import { cacheGet, cachePut } from '@/lib/cache';
import {
  avatarQuery,
  contactsQuery,
  folderCountsQuery,
  gmailCachedListQuery,
  mailBodyQuery,
  mailListQuery,
  profileQuery,
  signatureQuery,
  tagsQuery,
  useGmailSync,
} from '@/lib/gmail';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ getAccessToken: vi.fn() }));
vi.mock('@/lib/cache', () => ({
  cacheGet: vi.fn(async () => null),
  cachePut: vi.fn(),
  cacheDeletePrefix: vi.fn(),
}));

function response(value: unknown) {
  return { ok: true, text: async () => JSON.stringify(value) } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.mocked(invoke).mockResolvedValue([]);
  vi.mocked(getAccessToken).mockImplementation(async (id) => `token-${id}`);
});

describe('Gmail account isolation', () => {
  it('keeps all account data separate, including immutable queries', async () => {
    const queries = [
      profileQuery,
      avatarQuery,
      tagsQuery,
      folderCountsQuery,
      signatureQuery,
      contactsQuery,
      (id: string) => mailBodyQuery('same-id', id),
      (id: string) => mailListQuery('inbox', '', id),
      (id: string) => gmailCachedListQuery('inbox', id),
    ];
    const queryClient = client();
    for (const query of queries) {
      const a = query('A');
      const b = query('B');
      queryClient.setQueryData(a.queryKey, 'account A data');
      expect(queryClient.getQueryData(b.queryKey)).toBeUndefined();
    }
  });

  it('pins a delayed folder sync and metadata requests to the starting account', async () => {
    const queryClient = client();
    const listing = deferred<Response>();
    const requests: string[] = [];
    vi.mocked(fetch).mockImplementation(async (url, init) => {
      const path = String(url);
      requests.push((init?.headers as Record<string, string>).Authorization);
      if (path.includes('/messages?')) return listing.promise;
      if (path.endsWith('/labels')) {
        return response({ labels: [{ id: 'Label_1', name: 'A label' }] });
      }
      return response({
        id: 'same-id',
        threadId: 't',
        labelIds: ['INBOX', 'Label_1'],
        internalDate: '1',
        payload: { headers: [{ name: 'Subject', value: 'A mail' }] },
      });
    });
    localStorage.setItem('activeAccountId', 'A');
    const pending = queryClient.fetchQuery(mailListQuery('inbox', ''));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    localStorage.setItem('activeAccountId', 'B');
    listing.resolve(response({ messages: [{ id: 'same-id' }] }));
    await pending;

    expect(invoke).toHaveBeenCalledWith(
      'gmail_cache_replace_folder',
      expect.objectContaining({
        account_id: 'A',
        messages: [expect.objectContaining({ subject: 'A mail' })],
      }),
    );
    expect(requests.every((header) => header === 'Bearer token-A')).toBe(true);
    expect(queryClient.getQueryData(mailListQuery('inbox', '', 'B').queryKey)).toBeUndefined();

    // A just synced; B still needs its own full sync and label map.
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (String(url).includes('/messages?')) return response({ messages: [] });
      return response({});
    });
    await queryClient.fetchQuery(mailListQuery('inbox', '', 'B'));
    expect(invoke).toHaveBeenCalledWith(
      'gmail_cache_replace_folder',
      expect.objectContaining({
        account_id: 'B',
        messages: [],
      }),
    );
  });

  it('does not share message bodies or offline badge counts between accounts', async () => {
    const queryClient = client();
    vi.mocked(fetch).mockImplementation(async (_url, init) =>
      response({
        id: 'same-id',
        threadId: 't',
        payload: {
          headers: [
            {
              name: 'Subject',
              value: (init?.headers as Record<string, string>).Authorization,
            },
          ],
        },
      }),
    );
    const a = await queryClient.fetchQuery(mailBodyQuery('same-id', 'A'));
    const b = await queryClient.fetchQuery(mailBodyQuery('same-id', 'B'));
    expect(a.subject).toBe('Bearer token-A');
    expect(b.subject).toBe('Bearer token-B');
    expect(cachePut).toHaveBeenCalledWith('gmail:A:body:same-id', a);
    expect(cachePut).toHaveBeenCalledWith('gmail:B:body:same-id', b);

    vi.mocked(fetch).mockRejectedValue(new Error('offline'));
    await expect(queryClient.fetchQuery(folderCountsQuery('B'))).rejects.toThrow('offline');
    expect(cacheGet).toHaveBeenCalledWith('gmail:B:counts');
    expect(cacheGet).not.toHaveBeenCalledWith('gmail:A:counts');
  });

  it('paints cached mail with user labels without waiting for Google', async () => {
    vi.mocked(invoke).mockResolvedValue([
      {
        id: 'cached',
        name: 'Sender',
        email: 'a@example.com',
        subject: 'Offline mail',
        snippet: 'Saved',
        date: '2026-01-01',
        read: false,
        label_ids: ['INBOX', 'Label_1'],
      },
    ]);
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    const mails = await client().fetchQuery(gmailCachedListQuery('inbox', 'offline'));
    expect(mails[0].subject).toBe('Offline mail');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('starts a new history cursor on account switches and ignores a late old response', async () => {
    const queryClient = client();
    const oldProfile = deferred<Response>();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const token = (init?.headers as Record<string, string>).Authorization;
      return token === 'Bearer token-A' ? oldProfile.promise : response({ historyId: 'B-history' });
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(({ id }) => useGmailSync(true, 20, id), {
      wrapper,
      initialProps: { id: 'A' },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ id: 'B' });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('startHistoryId=B-history'),
        expect.anything(),
      ),
    );
    await act(async () => oldProfile.resolve(response({ historyId: 'A-history' })));
    expect(
      vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('startHistoryId=A-history')),
    ).toBe(false);
    unmount();
  });

  it("resumes the original account's delta cursor when switching back", async () => {
    const queryClient = client();
    vi.mocked(fetch).mockImplementation(async (_url, init) => {
      const token = (init?.headers as Record<string, string>).Authorization;
      return response({
        historyId: token === 'Bearer token-resume-A' ? 'saved-A' : 'saved-B',
      });
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { rerender, unmount } = renderHook(({ id }) => useGmailSync(true, 60_000, id), {
      wrapper,
      initialProps: { id: 'resume-A' },
    });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    rerender({ id: 'resume-B' });
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    rerender({ id: 'resume-A' });
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('startHistoryId=saved-A'),
        expect.objectContaining({
          headers: { Authorization: 'Bearer token-resume-A' },
        }),
      ),
    );
    expect(
      vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/profile')),
    ).toHaveLength(2);
    unmount();
  });
});
