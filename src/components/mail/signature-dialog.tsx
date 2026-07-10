import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RichTextEditor } from "@/components/ui/rich-text-editor";
import { Skeleton } from "@/components/ui/skeleton";
import { useAccount } from "@/context/AccountContext";
import {
  clearLocalSignature,
  saveLocalSignature,
  useSignature,
} from "@/lib/signature";

// Edit the active account's signature. Stored locally per account — iCloud
// has nowhere to host one, and for Google accounts a local signature
// overrides the Gmail-hosted one ("Reset" returns to it).
export function SignatureDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { activeAccount } = useAccount();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && activeAccount && (
        <SignatureForm
          key={activeAccount.id}
          accountId={activeAccount.id}
          email={activeAccount.email}
          isGoogle={activeAccount.kind === "google"}
          onClose={() => onOpenChange(false)}
        />
      )}
    </Dialog>
  );
}

function SignatureForm({
  accountId,
  email,
  isGoogle,
  onClose,
}: {
  accountId: string;
  email: string;
  isGoogle: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const { activeAccount } = useAccount();
  const { signature, isPending, hasLocal } = useSignature(activeAccount);
  // null until the user edits; empty text saves as "" (explicitly none).
  const [draft, setDraft] = useState<string | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["signature", accountId] });

  return (
    <DialogContent className="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>Signature — {email}</DialogTitle>
      </DialogHeader>
      {isPending ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <RichTextEditor
          initialHtml={signature}
          autoFocus
          onChange={(html, text) => setDraft(text.trim() ? html : "")}
        />
      )}
      <p className="text-muted-foreground text-xs">
        Saved on this computer for {email}.
        {isGoogle && " Without a local signature, the Gmail one is used."}
      </p>
      <DialogFooter>
        {isGoogle && hasLocal && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await clearLocalSignature(accountId);
              refresh();
              onClose();
            }}
          >
            Reset to Gmail signature
          </Button>
        )}
        <Button
          type="button"
          disabled={isPending || draft === null}
          onClick={() => {
            saveLocalSignature(accountId, draft ?? "");
            refresh();
            onClose();
          }}
        >
          Save
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
