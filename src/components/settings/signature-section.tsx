import { useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, SquarePen } from 'lucide-react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { HtmlEditor } from '@/components/ui/html-editor';
import { Input } from '@/components/ui/input';
import { SignaturePreview } from '@/components/ui/signature-preview';
import { SignatureSelect } from '@/components/ui/signature-select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAccount } from '@/context/account-context';
import {
  ACCOUNT_SIGNATURE,
  clearLocalSignature,
  removeSignature,
  setDefaultSignature,
  upsertSignature,
  useSignature,
  useSignatureLibrary,
} from '@/lib/signature';
import { cn } from '@/lib/utils';

// Master–detail editor for the shared signature library: the list on the left
// picks what the form on the right edits. The form tracks unsaved changes
// against what is stored — Save is enabled exactly when there is something to
// save, Cancel reverts, and leaving a form with unsaved changes asks first.
//
// The account's own signature (Gmail-hosted, or one saved by an older
// version) isn't part of the library, so it's shown read-only; copying it
// into the library is an explicit action rather than a side effect of saving.

const NEW = 'new';

interface Draft {
  name: string;
  html: string;
}

export function SignatureSection() {
  const { activeAccount } = useAccount();
  if (!activeAccount) {
    return null;
  }
  return <SignatureManager key={activeAccount.id} />;
}

function SignatureManager() {
  const { activeAccount } = useAccount();
  const library = useSignatureLibrary();
  const queryClient = useQueryClient();
  const resolved = useSignature(activeAccount, true);
  // null = follow the default pick (see `selectedId` below).
  const [selection, setSelection] = useState<string | null>(null);
  // Seed for an unsaved new signature (blank, or a copy).
  const [seed, setSeed] = useState<Draft>({ name: '', html: '' });
  // Unsaved edits; null = form shows what is stored.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [makeDefault, setMakeDefault] = useState(true);
  // Bumped to remount the editors after save/cancel so they show the stored
  // content (the visual editor keeps its own document while typing).
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(false);
  // Where to go once the user confirms discarding unsaved changes.
  const [pending, setPending] = useState<{ id: string; seed?: Draft } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const resetAccount = useMutation({
    mutationFn: async () => {
      if (!activeAccount) {
        return;
      }
      await clearLocalSignature(activeAccount.id);
      queryClient.setQueryData(['signature', activeAccount.id], null);
    },
  });

  if (!activeAccount) {
    return null;
  }
  if (library.isPending) {
    return <Skeleton className="h-64 w-full" />;
  }
  if (library.isError || !library.data) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p>Could not load signatures: {library.error?.message}</p>
        <Button variant="outline" onClick={() => library.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const account = activeAccount;
  const signatures = library.data.signatures;
  const hasAccountSignature = account.kind === 'google' || resolved.hasLocal;
  const accountLabel = resolved.hasLocal
    ? 'Previous signature'
    : account.kind === 'google'
      ? 'Gmail signature'
      : 'Empty account signature';

  const fallbackId =
    signatures.find((item) => item.id === resolved.choice)?.id ??
    signatures[0]?.id ??
    (hasAccountSignature ? ACCOUNT_SIGNATURE : null);
  const selectedId =
    selection === NEW ||
    selection === ACCOUNT_SIGNATURE ||
    signatures.some((item) => item.id === selection)
      ? selection
      : fallbackId;
  const selected = signatures.find((item) => item.id === selectedId);
  const isNew = selectedId === NEW;

  const stored: Draft = selected ?? seed;
  const form = draft ?? stored;
  const dirty = draft !== null && (draft.name !== stored.name || draft.html !== stored.html);
  const canSave = (isNew || dirty) && form.name.trim() !== '';
  const busy = library.isSaving || resetAccount.isPending;

  function go(id: string | null, nextSeed?: Draft) {
    if (nextSeed) {
      setSeed(nextSeed);
      setMakeDefault(signatures.length === 0);
    }
    setSelection(id);
    setDraft(null);
    setSaved(false);
    setRevision((value) => value + 1);
  }
  // Leaving a form with unsaved changes asks first.
  function navigate(id: string, nextSeed?: Draft) {
    if (dirty) {
      setPending({ id, seed: nextSeed });
    } else {
      go(id, nextSeed);
    }
  }
  function edit(patch: Partial<Draft>) {
    setDraft({ ...form, ...patch });
    setSaved(false);
  }
  // Revert to what is stored; an unsaved new signature is dropped.
  function cancel() {
    go(isNew ? null : selectedId);
  }
  async function save() {
    const id = selected?.id ?? crypto.randomUUID();
    try {
      await library.update((current) => {
        const next = upsertSignature(current, { id, name: form.name, html: form.html });
        return isNew && makeDefault ? setDefaultSignature(next, account.id, id) : next;
      });
      go(id);
      setSaved(true);
    } catch {
      // Keep the draft; the mutation error is shown below the form.
    }
  }

  const listItem = (id: string, label: string, extra?: ReactNode) => (
    <li key={id}>
      <button
        type="button"
        aria-current={selectedId === id ? 'true' : undefined}
        disabled={busy}
        onClick={() => selectedId !== id && navigate(id)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted',
          selectedId === id && 'bg-secondary font-medium',
        )}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {extra}
      </button>
    </li>
  );

  return (
    <div className="flex flex-col gap-6" aria-busy={busy}>
      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-medium">Default for new messages from {account.email}</p>
        <SignatureSelect
          label={`Default signature for ${account.email}`}
          value={resolved.choice}
          signatures={signatures}
          accountLabel={accountLabel}
          disabled={busy}
          onChange={(choice) => {
            void library
              .update((current) => setDefaultSignature(current, account.id, choice))
              .catch(() => {});
          }}
        />
        <p className="text-xs text-muted-foreground">
          You can pick a different signature while composing.
        </p>
      </div>

      {selectedId === null ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SquarePen />
            </EmptyMedia>
            <EmptyTitle>No signatures yet</EmptyTitle>
            <EmptyDescription>
              Signatures are shared by all your accounts. Each account picks its own default.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => go(NEW, { name: '', html: '' })}>
              <Plus data-icon="inline-start" />
              New signature
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="flex min-h-80 overflow-hidden rounded-lg border">
          <nav aria-label="Signatures" className="flex w-48 shrink-0 flex-col border-r bg-muted/30">
            <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto p-2">
              {signatures.map((item) =>
                listItem(
                  item.id,
                  item.name,
                  resolved.choice === item.id && <Badge variant="secondary">Default</Badge>,
                ),
              )}
              {isNew && (
                <li>
                  <div
                    aria-current="true"
                    className="flex items-center gap-2 rounded-md bg-secondary px-2 py-1.5 text-sm font-medium"
                  >
                    <span className="min-w-0 flex-1 truncate italic">
                      {form.name.trim() || 'New signature'}
                    </span>
                    <Badge variant="outline">Unsaved</Badge>
                  </div>
                </li>
              )}
              {hasAccountSignature && (
                <>
                  <li role="separator" className="my-1 border-t" />
                  {listItem(
                    ACCOUNT_SIGNATURE,
                    accountLabel,
                    resolved.choice === ACCOUNT_SIGNATURE && (
                      <Badge variant="secondary">Default</Badge>
                    ),
                  )}
                </>
              )}
            </ul>
            <div className="border-t p-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
                disabled={busy || isNew}
                onClick={() => navigate(NEW, { name: '', html: '' })}
              >
                <Plus data-icon="inline-start" />
                New signature
              </Button>
            </div>
          </nav>

          <div className="flex min-w-0 flex-1 flex-col gap-3 p-4" inert={busy}>
            {selectedId === ACCOUNT_SIGNATURE ? (
              <AccountSignature
                label={accountLabel}
                html={resolved.accountSignature}
                pending={resolved.accountIsPending}
                isGoogle={account.kind === 'google'}
                isLocal={resolved.hasLocal}
                onCopy={() =>
                  navigate(NEW, { name: accountLabel, html: resolved.accountSignature })
                }
                onReset={() => resetAccount.mutate()}
                resetError={resetAccount.error?.message}
              />
            ) : (
              <form
                className="flex flex-col gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canSave) {
                    void save();
                  }
                }}
              >
                <label className="flex flex-col gap-1.5 text-sm font-medium">
                  Name
                  <Input
                    value={form.name}
                    placeholder="e.g. Work"
                    autoFocus={isNew}
                    onChange={(event) => edit({ name: event.target.value })}
                  />
                </label>
                <SignatureContentEditor
                  key={`${selectedId}:${revision}`}
                  html={form.html}
                  onChange={(html) => edit({ html })}
                />
                {isNew && (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={makeDefault}
                      onChange={(event) => setMakeDefault(event.target.checked)}
                    />
                    Use as default for {account.email}
                  </label>
                )}
                {!isNew && (
                  <p className="text-xs text-muted-foreground">
                    Changes apply to every account that uses this signature.
                  </p>
                )}
                <div className="flex items-center gap-2">
                  {selected && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        className="text-destructive"
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          navigate(NEW, { name: `${stored.name} copy`, html: stored.html })
                        }
                      >
                        Duplicate
                      </Button>
                    </>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground" role="status">
                    {dirty ? 'Unsaved changes' : saved ? 'Saved' : ''}
                  </span>
                  {(dirty || isNew) && (
                    <Button type="button" variant="outline" onClick={cancel}>
                      Cancel
                    </Button>
                  )}
                  <Button type="submit" disabled={!canSave}>
                    Save
                  </Button>
                </div>
                {library.saveError && (
                  <p role="alert" className="text-sm text-destructive">
                    Could not save signatures: {library.saveError.message}
                  </p>
                )}
              </form>
            )}
          </div>
        </div>
      )}

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Your changes to “{form.name.trim() || 'New signature'}” haven’t been saved.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pending) {
                  go(pending.id, pending.seed);
                }
                setPending(null);
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selected?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the signature from every account. Accounts using it as their default will
              use no signature.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!selected) {
                  return;
                }
                try {
                  await library.update((current) => removeSignature(current, selected.id));
                  setSelection(null);
                  setDraft(null);
                  setSaved(false);
                } catch {
                  /* Display the storage error without discarding the signature. */
                }
              }}
            >
              Delete signature
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SignatureContentEditor({
  html,
  onChange,
}: {
  html: string;
  onChange: (html: string) => void;
}) {
  return (
    <Tabs defaultValue="visual">
      <TabsList aria-label="Signature editor mode">
        <TabsTrigger value="visual">Visual</TabsTrigger>
        <TabsTrigger value="html">HTML</TabsTrigger>
        <TabsTrigger value="preview">Preview</TabsTrigger>
      </TabsList>
      <TabsContent value="visual">
        <div className="overflow-hidden rounded-lg border bg-white p-2">
          <SignaturePreview html={html} editable onChange={onChange} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Edit text directly. Use HTML for layout and formatting.
        </p>
      </TabsContent>
      <TabsContent value="html">
        <HtmlEditor value={html} onChange={onChange} />
      </TabsContent>
      <TabsContent value="preview">
        <div className="min-h-44 overflow-auto rounded-lg border bg-white p-2">
          {html.trim() ? (
            <SignaturePreview html={html} />
          ) : (
            <p className="p-3 text-sm text-gray-500">No signature content yet.</p>
          )}
        </div>
      </TabsContent>
    </Tabs>
  );
}

function AccountSignature({
  label,
  html,
  pending,
  isGoogle,
  isLocal,
  onCopy,
  onReset,
  resetError,
}: {
  label: string;
  html: string;
  pending: boolean;
  isGoogle: boolean;
  isLocal: boolean;
  onCopy: () => void;
  onReset: () => void;
  resetError?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">{label}</h3>
        <p className="text-xs text-muted-foreground">
          {isLocal
            ? 'Saved by an earlier version of this app. Read-only — copy it to edit.'
            : 'Managed in Gmail. Read-only here — copy it to edit, or change it in Gmail.'}
        </p>
      </div>
      {pending ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <div className="min-h-44 overflow-auto rounded-lg border bg-white p-2">
          {html.trim() ? (
            <SignaturePreview html={html} />
          ) : (
            <p className="p-3 text-sm text-gray-500">This signature is empty.</p>
          )}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {isGoogle && isLocal && (
          <Button type="button" variant="outline" onClick={onReset}>
            Use Gmail signature instead
          </Button>
        )}
        <Button type="button" disabled={pending} onClick={onCopy}>
          Copy to my signatures
        </Button>
      </div>
      {resetError && (
        <p role="alert" className="text-sm text-destructive">
          Could not reset signature: {resetError}
        </p>
      )}
    </div>
  );
}
