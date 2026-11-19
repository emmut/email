import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { HtmlEditor } from "@/components/ui/html-editor";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SignaturePreview } from "@/components/ui/signature-preview";
import { SignatureSelect } from "@/components/ui/signature-select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAccount } from "@/context/AccountContext";
import {
  ACCOUNT_SIGNATURE, NO_SIGNATURE, clearLocalSignature, removeSignature, setDefaultSignature,
  upsertSignature, useSignature, useSignatureLibrary, type SavedSignature,
} from "@/lib/signature";

export function SignatureSection() {
  const { activeAccount } = useAccount();
  if (!activeAccount) return null;
  return <SignatureManager key={activeAccount.id} />;
}

function SignatureManager() {
  const { activeAccount } = useAccount();
  const library = useSignatureLibrary();
  const queryClient = useQueryClient();
  const resolved = useSignature(activeAccount, true);
  const [selection, setSelection] = useState<string | null>(null);
  const [seed, setSeed] = useState({ name: "New signature", html: "" });
  const [revision, setRevision] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saved, setSaved] = useState(false);

  const resetAccount = useMutation({
    mutationFn: async () => {
      if (!activeAccount) return;
      await clearLocalSignature(activeAccount.id);
      queryClient.setQueryData(["signature", activeAccount.id], null);
      setRevision((value) => value + 1);
      setSaved(false);
    },
  });

  if (!activeAccount) return null;
  if (library.isPending) return <Skeleton className="h-64 w-full" />;
  if (library.isError || !library.data) return (
    <div role="alert" className="space-y-2 text-sm">
      <p>Could not load signatures: {library.error?.message}</p>
      <Button variant="outline" onClick={() => library.refetch()}>Try again</Button>
    </div>
  );

  const account = activeAccount;
  const signatures = library.data.signatures;
  const selectedId = selection ?? (resolved.choice === NO_SIGNATURE ? ACCOUNT_SIGNATURE : resolved.choice);
  const selected = signatures.find((item) => item.id === selectedId);
  const accountLabel = resolved.hasLocal ? "Original account signature" : account.kind === "google" ? "Gmail signature" : "Empty account signature";
  const initial = selected ?? (selectedId === "new" ? seed : {
    name: `${account.email} signature`, html: resolved.accountSignature,
  });
  const items = [
    { value: ACCOUNT_SIGNATURE, label: accountLabel },
    ...signatures.map((item) => ({ value: item.id, label: item.name })),
    ...(selectedId === "new" ? [{ value: "new", label: seed.name }] : []),
  ];
  const busy = library.isSaving || resetAccount.isPending;
  const changeSelection = (id: string) => { setSelection(id); setSaved(false); };
  const fresh = (duplicate = false) => {
    setSeed(duplicate ? { name: `${initial.name} copy`, html: initial.html } : { name: "New signature", html: "" });
    setSelection("new");
    setRevision((value) => value + 1);
    setSaved(false);
  };

  return (
    <div className="flex flex-col gap-4" aria-busy={busy}>
      <p className="text-sm text-muted-foreground">
        Signatures are shared across accounts on this computer. Each account has its own default, and you can choose another signature when composing.
      </p>
      <div className="space-y-1.5">
        <p id="signature-default-label" className="text-sm font-medium">Default for {account.email}</p>
        <SignatureSelect
          label={`Default signature for ${account.email}`}
          value={resolved.choice}
          signatures={signatures}
          accountLabel={accountLabel}
          disabled={busy || dirty}
          onChange={(choice) => {
            setSaved(false);
            void library.update((current) => setDefaultSignature(current, account.id, choice)).catch(() => {});
          }}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-40 flex-1">
          <Select items={items} value={selectedId} disabled={dirty || busy} onValueChange={(id) => { if (id) changeSelection(id); }}>
            <SelectTrigger aria-label="Signature to edit" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>{items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" disabled={dirty || busy} onClick={() => fresh()}>New</Button>
        <Button type="button" variant="outline" disabled={dirty || busy || (selectedId === ACCOUNT_SIGNATURE && resolved.accountIsPending)} onClick={() => fresh(true)}>Duplicate</Button>
        {selected && <Button type="button" variant="outline" disabled={dirty || busy} onClick={() => setConfirmDelete(true)}>Delete</Button>}
      </div>
      {selectedId === ACCOUNT_SIGNATURE && resolved.hasLocal && account.kind === "google" && (
        <Button type="button" variant="outline" className="self-start" disabled={dirty || busy} onClick={() => resetAccount.mutate()}>Reset original to Gmail signature</Button>
      )}
      {resetAccount.error && <p role="alert" className="text-sm text-destructive">Could not reset signature: {resetAccount.error.message}</p>}
      {dirty && <p className="text-xs text-muted-foreground">Save or discard your changes before switching signatures.</p>}
      {selectedId === ACCOUNT_SIGNATURE && resolved.accountIsPending ? <Skeleton className="h-44 w-full" /> : (
        <div inert={busy}>
          <SignatureDraft
            key={`${selectedId}:${revision}`}
            initial={initial}
            isNew={!selected}
            email={account.email}
            onDirty={() => { setDirty(true); setSaved(false); }}
            onDiscard={() => { setRevision((value) => value + 1); setDirty(false); }}
            onSave={async (name, html, makeDefault) => {
              const id = selected?.id ?? crypto.randomUUID();
              try {
                await library.update((current) => {
                  const next = upsertSignature(current, { id, name, html });
                  return makeDefault ? setDefaultSignature(next, account.id, id) : next;
                });
                setSelection(id);
                setRevision((value) => value + 1);
                setDirty(false);
                setSaved(true);
              } catch {
                // Keep the draft available; the mutation error is shown below.
              }
            }}
          />
        </div>
      )}
      {saved && <p role="status" className="text-xs text-muted-foreground">Saved.</p>}
      {library.saveError && <p role="alert" className="text-sm text-destructive">Could not save signatures: {library.saveError.message}</p>}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{selected?.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the shared signature from every account. Accounts using it as their default will use no signature.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              if (!selected) return;
              try {
                await library.update((current) => removeSignature(current, selected.id));
                setSelection(ACCOUNT_SIGNATURE);
                setSaved(false);
              } catch { /* Display the storage error without discarding the signature. */ }
            }}>Delete signature</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SignatureDraft({ initial, isNew, email, onDirty, onDiscard, onSave }: {
  initial: Pick<SavedSignature, "name" | "html">;
  isNew: boolean;
  email: string;
  onDirty: () => void;
  onDiscard: () => void;
  onSave: (name: string, html: string, makeDefault: boolean) => Promise<void>;
}) {
  const [name, setName] = useState(initial.name);
  const [html, setHtml] = useState(initial.html);
  const [changed, setChanged] = useState(false);
  const [makeDefault, setMakeDefault] = useState(isNew);
  const editHtml = (value: string) => { setHtml(value); setChanged(true); onDirty(); };

  return (
    <div className="flex flex-col gap-3">
      <label className="space-y-1.5 text-sm font-medium">
        Signature name
        <Input value={name} onChange={(event) => { setName(event.target.value); setChanged(true); onDirty(); }} />
      </label>
      {!isNew && <p className="text-xs text-muted-foreground">Editing this signature updates it for every account that uses it.</p>}
      <Tabs defaultValue="visual">
        <TabsList aria-label="Signature editor mode">
          <TabsTrigger value="visual">Visual</TabsTrigger>
          <TabsTrigger value="html">HTML</TabsTrigger>
          <TabsTrigger value="preview">Preview</TabsTrigger>
        </TabsList>
        <TabsContent value="visual">
          <div className="overflow-hidden rounded-lg border bg-white p-2"><SignaturePreview html={html} editable onChange={editHtml} /></div>
          <p className="mt-2 text-xs text-muted-foreground">Edit text directly. Use HTML for layout and formatting.</p>
        </TabsContent>
        <TabsContent value="html"><HtmlEditor value={html} onChange={editHtml} /></TabsContent>
        <TabsContent value="preview">
          <div className="min-h-44 overflow-auto rounded-lg border bg-white p-2">
            {html.trim() ? <SignaturePreview html={html} /> : <p className="p-3 text-sm text-gray-500">No signature content yet.</p>}
          </div>
        </TabsContent>
      </Tabs>
      {isNew && <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={makeDefault} onChange={(event) => setMakeDefault(event.target.checked)} />
        Use as default for {email}
      </label>}
      <div className="flex justify-end gap-2">
        {changed && <Button type="button" variant="outline" onClick={onDiscard}>Discard changes</Button>}
        <Button type="button" disabled={!name.trim() || (!isNew && !changed)} onClick={() => void onSave(name, html, isNew && makeDefault)}>
          {isNew ? "Save to library" : "Save"}
        </Button>
      </div>
    </div>
  );
}
