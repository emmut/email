import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignatureSection } from '@/components/settings/signature-section';

let account: { id: string; kind: 'icloud' | 'google'; email: string };
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@/context/account-context', () => ({
  useAccount: () => ({ activeAccount: account }),
}));
vi.mock('@/lib/gmail', () => ({
  signatureQuery: () => ({
    queryKey: ['gmail', 'signature'],
    queryFn: async () => '<p>Gmail sig</p>',
  }),
}));
vi.mock('@/components/ui/html-editor', () => ({
  HtmlEditor: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <textarea
      aria-label="Signature HTML"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const KEY = 'signature-library:v1';
let storage: Map<string, string>;
const stored = () => JSON.parse(storage.get(KEY)!);

beforeEach(() => {
  account = { id: 'a', kind: 'icloud', email: 'a@example.com' };
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

function seedLibrary() {
  storage.set(
    KEY,
    JSON.stringify({
      signatures: [
        { id: 'work', name: 'Work', html: '<p>Work</p>' },
        { id: 'home', name: 'Home', html: '<p>Home</p>' },
      ],
      defaults: { a: 'work' },
    }),
  );
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <SignatureSection />
    </QueryClientProvider>,
  );
  return userEvent.setup();
}

const nameInput = () => screen.findByRole('textbox', { name: 'Name' });
const htmlInput = () => screen.getByRole('textbox', { name: 'Signature HTML' });
const saveButton = () => screen.getByRole('button', { name: 'Save' });

describe('signature settings', () => {
  it('creates the first signature from the empty state and makes it the default', async () => {
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'New signature' }));
    await user.type(await nameInput(), 'Work');
    await user.click(screen.getByRole('tab', { name: 'HTML' }));
    fireEvent.change(htmlInput(), {
      target: { value: '<img src="https://example.com/logo.png" width="96">' },
    });
    await user.click(saveButton());
    await waitFor(() => expect(storage.has(KEY)).toBe(true));
    const library = stored();
    expect(library.signatures).toHaveLength(1);
    expect(library.signatures[0].name).toBe('Work');
    expect(library.signatures[0].html).toContain('width="96"');
    expect(library.defaults.a).toBe(library.signatures[0].id);
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
  });

  it('saves content-only edits in place without creating a new entry', async () => {
    seedLibrary();
    const user = setup();
    await nameInput();
    expect(saveButton()).toBeDisabled();
    await user.click(screen.getByRole('tab', { name: 'HTML' }));
    fireEvent.change(htmlInput(), { target: { value: '<p>Work, edited</p>' } });
    expect(saveButton()).toBeEnabled();
    await user.click(saveButton());
    await waitFor(() => expect(stored().signatures[0].html).toBe('<p>Work, edited</p>'));
    expect(stored().signatures.map((item: { id: string }) => item.id)).toEqual(['work', 'home']);
    expect(saveButton()).toBeDisabled();
  });

  it('saves name-only edits and disables Save when edits are reverted', async () => {
    seedLibrary();
    const user = setup();
    const name = await nameInput();
    await user.type(name, 'X');
    expect(saveButton()).toBeEnabled();
    await user.type(name, '{Backspace}');
    expect(saveButton()).toBeDisabled();
    await user.type(name, ' 2');
    await user.click(saveButton());
    await waitFor(() => expect(stored().signatures[0].name).toBe('Work 2'));
    expect(stored().signatures).toHaveLength(2);
  });

  it('cancel reverts unsaved edits', async () => {
    seedLibrary();
    const user = setup();
    const name = await nameInput();
    await user.type(name, ' draft');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await nameInput()).toHaveValue('Work');
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('asks before discarding unsaved changes when switching signatures', async () => {
    seedLibrary();
    const user = setup();
    await user.type(await nameInput(), ' draft');
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Discard unsaved changes?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(await nameInput()).toHaveValue('Work draft');
    await user.click(screen.getByRole('button', { name: 'Home' }));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await nameInput()).toHaveValue('Home');
    expect(storage.get(KEY)).not.toContain('draft');
  });

  it('duplicates a signature as a new entry without changing the default', async () => {
    seedLibrary();
    const user = setup();
    await nameInput();
    await user.click(screen.getByRole('button', { name: 'Duplicate' }));
    expect(await nameInput()).toHaveValue('Work copy');
    expect(
      screen.getByRole('checkbox', { name: 'Use as default for a@example.com' }),
    ).not.toBeChecked();
    await user.click(saveButton());
    await waitFor(() => expect(stored().signatures).toHaveLength(3));
    const copy = stored().signatures[2];
    expect(copy).toMatchObject({ name: 'Work copy', html: '<p>Work</p>' });
    expect(stored().defaults.a).toBe('work');
  });

  it('shows the Gmail signature read-only and copies it only on request', async () => {
    account = { id: 'a', kind: 'google', email: 'a@gmail.com' };
    const user = setup();
    expect(await screen.findByText('Managed in Gmail', { exact: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy to my signatures' }));
    expect(await nameInput()).toHaveValue('Gmail signature');
    await user.click(saveButton());
    await waitFor(() => expect(stored().signatures).toHaveLength(1));
    expect(stored().signatures[0].html).toBe('<p>Gmail sig</p>');
  });

  it('confirms shared deletion and clears all affected defaults', async () => {
    storage.set(
      KEY,
      JSON.stringify({
        signatures: [{ id: 'work', name: 'Work', html: '<p>Work</p>' }],
        defaults: { a: 'work', b: 'work' },
      }),
    );
    const user = setup();
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('every account');
    await user.click(screen.getByRole('button', { name: 'Delete signature' }));
    await waitFor(() => expect(stored().signatures).toHaveLength(0));
    expect(stored().defaults).toEqual({ a: null, b: null });
  });

  it('keeps an unsaved draft when persistence fails', async () => {
    seedLibrary();
    const user = setup();
    const name = await nameInput();
    await user.type(name, ' unsaved');
    vi.mocked(invoke).mockImplementationOnce(async () => {
      throw new Error('Disk full');
    });
    await user.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk full');
    expect(name).toHaveValue('Work unsaved');
    expect(stored().signatures[0].name).toBe('Work');
  });
});
