import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { HtmlEditor } from "@/components/ui/html-editor";
import { SignaturePreview } from "@/components/ui/signature-preview";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { sanitizeSignature } from "@/lib/signature-html";
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
  const html = draft ?? signature;
  const [editorKey, setEditorKey] = useState(0);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["signature", accountId] });

  return (
    <div className="flex flex-col gap-3">
      {isPending ? (
        <Skeleton className="h-44 w-full" />
      ) : (
        <Tabs defaultValue="visual">
          <TabsList aria-label="Signature editor mode">
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="html">HTML</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>
          <TabsContent value="visual">
            <div className="overflow-hidden rounded-lg border bg-white p-2">
              <SignaturePreview
                key={editorKey}
                html={html}
                editable
                onChange={(value) => {
                  setSaved(false);
                  setDraft(value);
                }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Edit text directly. Use HTML for layout and formatting.</p>
          </TabsContent>
          <TabsContent value="html">
            <HtmlEditor
              value={html}
              onChange={(value) => {
                setSaved(false);
                setDraft(value);
              }}
            />
          </TabsContent>
          <TabsContent value="preview">
            <div className="min-h-44 overflow-auto rounded-lg border bg-white p-2">
              {html.trim() ? <SignaturePreview html={html} /> : (
                <p className="p-3 text-sm text-gray-500">No signature. Add HTML in the HTML tab.</p>
              )}
            </div>
          </TabsContent>
        </Tabs>
      )}
      <p className="text-muted-foreground text-xs">
        Tables, inline styles, links, and images are preserved. Preview uses a white email background.
        <br />
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
              await refresh();
              setEditorKey((key) => key + 1);
              setDraft(null);
              setSaved(false);
            }}
          >
            Reset to Gmail signature
          </Button>
        )}
        <Button
          type="button"
          disabled={isPending || draft === null}
          onClick={() => {
            const sanitized = sanitizeSignature(draft ?? "");
            saveLocalSignature(accountId, sanitized);
            queryClient.setQueryData(["signature", accountId], sanitized);
            setDraft(null);
            setEditorKey((key) => key + 1);
            setSaved(true);
          }}
        >
          Save
        </Button>
      </div>
    </div>
  );
}
