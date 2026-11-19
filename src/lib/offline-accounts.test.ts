import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { archiveMessage, sendMessage } from '@/lib/gmail';
import { flushPendingOps, queueGmailAction, queueGmailSend } from '@/lib/offline';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: () => false,
}));
vi.mock('@/lib/gmail', async (original) => ({
  ...(await original<object>()),
  archiveMessage: vi.fn(),
  sendMessage: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

it('replays Gmail actions and sends using their original account', async () => {
  const queued: {
    id: number;
    kind: string;
    payload: string;
    attempts: number;
  }[] = [];
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    if (command === 'ops_enqueue') {
      const { kind, payload } = args as { kind: string; payload: string };
      queued.push({ id: queued.length + 1, kind, payload, attempts: 0 });
      return queued.length;
    }
    if (command === 'ops_list') return queued;
    if (command === 'ops_delete') return;
    throw new Error(`Unexpected command: ${command}`);
  });
  localStorage.setItem('activeAccountId', 'A');
  const message = { to: 'a@example.com', subject: 'Offline', body: 'Saved' };
  await queueGmailAction('same-id', 'archive');
  await queueGmailSend(message);
  localStorage.setItem('activeAccountId', 'B');
  expect(await flushPendingOps()).toBe(2);
  expect(archiveMessage).toHaveBeenCalledWith('same-id', 'A');
  expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining(message), 'A');
});
