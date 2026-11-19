import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';

import { CommandPalette } from '@/components/mail/command-palette';
import { mail } from '@/test/fixtures';

vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));

vi.mock('@/context/account-context', () => ({
  useAccount: () => ({
    accounts: [],
    activeAccount: { id: 'a1', kind: 'icloud', email: 'e@icloud.com' },
    activeAccountId: 'a1',
    switchAccount: vi.fn(),
  }),
}));

const handlers = () => ({
  onOpenChange: vi.fn(),
  onSelectFolder: vi.fn(),
  onCompose: vi.fn(),
  onFocusSearch: vi.fn(),
  onShowShortcuts: vi.fn(),
  onSetTab: vi.fn(),
  onAct: vi.fn(),
  onEmptyTrash: vi.fn(),
});

async function renderPalette(
  selected: ReturnType<typeof mail> | null = mail({ read: true }),
  junkAction: 'junk' | 'notJunk' | null = 'junk',
) {
  const h = handlers();
  const rootRoute = createRootRoute();
  const mailRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <CommandPalette open selected={selected} junkAction={junkAction} {...h} />,
  });
  const settingsRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/settings',
    component: () => <h1>Settings</h1>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([mailRoute, settingsRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return h;
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('CommandPalette', () => {
  it('lists global actions', async () => {
    await renderPalette();
    for (const label of [
      'Compose',
      'Search mail',
      'Refresh',
      'Empty trash',
      'Keyboard shortcuts',
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('shows Mark as unread for a read message and runs it', async () => {
    const h = await renderPalette(mail({ id: 'm9', read: true }));
    const item = screen.getByText('Mark as unread');
    expect(screen.queryByText('Mark as read')).not.toBeInTheDocument();
    fireEvent.click(item);
    expect(h.onAct).toHaveBeenCalledWith('unread', 'm9');
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('shows Mark as read for an unread message', async () => {
    const h = await renderPalette(mail({ id: 'm9', read: false }));
    fireEvent.click(screen.getByText('Mark as read'));
    expect(h.onAct).toHaveBeenCalledWith('read', 'm9');
  });

  it('hides message actions with nothing selected', async () => {
    await renderPalette(null);
    expect(screen.queryByText('Mark as unread')).not.toBeInTheDocument();
    expect(screen.queryByText('Move to trash')).not.toBeInTheDocument();
  });

  it('shows Mark as junk and runs it', async () => {
    const h = await renderPalette(mail({ id: 'm9', read: true }));
    expect(screen.queryByText('Mark as not junk')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Mark as junk'));
    expect(h.onAct).toHaveBeenCalledWith('junk', 'm9');
  });

  it('shows Mark as not junk inside the junk folder', async () => {
    const h = await renderPalette(mail({ id: 'm9', read: true }), 'notJunk');
    fireEvent.click(screen.getByText('Mark as not junk'));
    expect(h.onAct).toHaveBeenCalledWith('notJunk', 'm9');
  });

  it('hides the junk action where none applies (drafts)', async () => {
    await renderPalette(mail({ id: 'm9', read: true }), null);
    expect(screen.queryByText(/mark as (not )?junk/i)).not.toBeInTheDocument();
  });

  it('empty trash asks the host for confirmation flow', async () => {
    const h = await renderPalette();
    fireEvent.click(screen.getByText('Empty trash'));
    expect(h.onEmptyTrash).toHaveBeenCalled();
  });

  it('navigates to folders', async () => {
    const h = await renderPalette();
    fireEvent.click(screen.getByText('Trash'));
    expect(h.onSelectFolder).toHaveBeenCalledWith('trash');
  });

  it('opens settings through the router', async () => {
    const h = await renderPalette();
    fireEvent.click(screen.getByText('Open settings'));
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(h.onOpenChange).toHaveBeenCalledWith(false);
  });
});
