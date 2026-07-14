import { useState } from "react";
import { Star, Trash2, UserPlus } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/context/AccountContext";
import { initialsFromEmail } from "@/lib/utils";
import type { Account } from "@/types/account";

export function AccountsSection() {
  const {
    accounts,
    activeAccountId,
    switchAccount,
    setDefaultAccount,
    addGoogleAccount,
    addICloudAccount,
    removeAccount,
  } = useAccount();
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null);
  const [icloudOpen, setIcloudOpen] = useState(false);
  const [icloudEmail, setIcloudEmail] = useState("");
  const [icloudPassword, setIcloudPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const attempt = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="divide-y rounded-lg border">
        {accounts.map((acc) => (
          <div key={acc.id} className="flex items-center gap-3 p-3">
            <Avatar className="size-8 rounded-lg">
              {acc.avatar_url && <AvatarImage src={acc.avatar_url} alt="" />}
              <AvatarFallback className="rounded-lg text-xs">
                {initialsFromEmail(acc.email)}
              </AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-sm leading-tight">
              <span className="truncate font-medium">{acc.email}</span>
              <span className="text-muted-foreground text-xs">
                {acc.kind === "google" ? "Google" : "iCloud"}
                {acc.id === activeAccountId && " · active"}
              </span>
            </div>
            {acc.is_default ? (
              <Badge
                variant="outline"
                className="shrink-0 font-normal"
                title="Opens at launch"
              >
                Default
              </Badge>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground shrink-0"
                title="Open this account at launch"
                onClick={attempt(() => setDefaultAccount(acc.id))}
              >
                <Star data-icon="inline-start" />
                Make default
              </Button>
            )}
            {acc.id !== activeAccountId && (
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0"
                onClick={attempt(() => switchAccount(acc.id))}
              >
                Switch
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive shrink-0"
              aria-label={`Remove ${acc.email}`}
              onClick={() => setRemoveTarget(acc)}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
      </div>
      <p className="text-muted-foreground text-xs">
        The default account is the one the app opens with at launch.
      </p>

      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={attempt(addGoogleAccount)}>
          <UserPlus data-icon="inline-start" />
          Add Google account
        </Button>
        <Button variant="outline" size="sm" onClick={() => setIcloudOpen(true)}>
          <UserPlus data-icon="inline-start" />
          Add iCloud account
        </Button>
      </div>
      {error != null && <p className="text-destructive text-xs">{error}</p>}

      <Dialog open={icloudOpen} onOpenChange={setIcloudOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add iCloud account</DialogTitle>
          </DialogHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!icloudEmail || !icloudPassword) return;
              await attempt(() =>
                addICloudAccount(icloudEmail, icloudPassword),
              )();
              setIcloudOpen(false);
              setIcloudEmail("");
              setIcloudPassword("");
            }}
          >
            <Input
              autoFocus
              placeholder="iCloud email"
              value={icloudEmail}
              onChange={(e) => setIcloudEmail(e.target.value)}
              type="email"
            />
            <Input
              placeholder="App-specific password"
              value={icloudPassword}
              onChange={(e) => setIcloudPassword(e.target.value)}
              type="password"
            />
            <p className="text-muted-foreground text-xs">
              Generate an app-specific password at{" "}
              <a
                href="https://appleid.apple.com"
                target="_blank"
                rel="noopener"
                className="underline"
              >
                appleid.apple.com
              </a>
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                type="button"
                onClick={() => setIcloudOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Add account</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={removeTarget !== null}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removeTarget?.email}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The account is removed from this app; mail on the server is
              untouched. You can add it again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeTarget) void attempt(() => removeAccount(removeTarget.id))();
                setRemoveTarget(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
