import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
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
export function SignatureSection() {
  const { activeAccount } = useAccount();
  if (!activeAccount) return null;
  return (
    <SignatureEditor
      key={activeAccount.id}
      accountId={activeAccount.id}
      email={activeAccount.email}
      isGoogle={activeAccount.kind === "google"}
    />
  );
}

function SignatureEditor({
  accountId,
  email,
  isGoogle,
}: {
  accountId: string;
  email: string;
  isGoogle: boolean;
}) {
  const queryClient = useQueryClient();
  const { activeAccount } = useAccount();
  const { signature, isPending, hasLocal } = useSignature(activeAccount);
  // null until the user edits; empty text saves as "" (explicitly none).
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // Remount the editor after save/reset so it shows the persisted content.
  const [editorKey, setEditorKey] = useState(0);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["signature", accountId] });

  return (
    <div className="flex flex-col gap-3">
      {isPending ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <RichTextEditor
          key={editorKey}
          initialHtml={signature}
          onChange={(html, text) => {
            setSaved(false);
            setDraft(text.trim() ? html : "");
          }}
        />
      )}
      <p className="text-muted-foreground text-xs">
        Saved on this computer for {email}.
        {isGoogle && " Without a local signature, the Gmail one is used."}
      </p>
      <div className="flex items-center justify-end gap-2">
        {saved && (
          <span className="text-muted-foreground mr-auto text-xs">Saved.</span>
        )}
        {isGoogle && hasLocal && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              await clearLocalSignature(accountId);
              refresh();
              setDraft(null);
              setEditorKey((k) => k + 1);
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
            setDraft(null);
            setSaved(true);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
