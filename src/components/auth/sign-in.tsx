import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Cloud, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/context/AccountContext";

export function SignIn() {
  const queryClient = useQueryClient();
  const { addGoogleAccount, addICloudAccount } = useAccount();
  const [showICloud, setShowICloud] = useState(false);
  const [icloudEmail, setIcloudEmail] = useState("");
  const [icloudPassword, setIcloudPassword] = useState("");

  const googleMutation = useMutation({
    mutationFn: addGoogleAccount,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  const icloudMutation = useMutation({
    mutationFn: () => addICloudAccount(icloudEmail.trim(), icloudPassword),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  const isPending = googleMutation.isPending || icloudMutation.isPending;
  const error = googleMutation.error ?? icloudMutation.error;

  return (
    <div className="flex h-svh flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
          <Inbox className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold">Email</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Sign in with a Google or iCloud account to load your inbox.
        </p>
      </div>
      {showICloud ? (
        <form
          className="flex w-64 flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (icloudEmail.trim() && icloudPassword) icloudMutation.mutate();
          }}
        >
          <Input
            autoFocus
            placeholder="iCloud email"
            type="email"
            value={icloudEmail}
            onChange={(e) => setIcloudEmail(e.target.value)}
          />
          <Input
            placeholder="App-specific password"
            type="password"
            value={icloudPassword}
            onChange={(e) => setIcloudPassword(e.target.value)}
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
          <Button
            type="submit"
            disabled={isPending || !icloudEmail.trim() || !icloudPassword}
          >
            {icloudMutation.isPending ? "Signing in…" : "Sign in with iCloud"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={isPending}
            onClick={() => setShowICloud(false)}
          >
            Back
          </Button>
        </form>
      ) : (
        <div className="flex w-64 flex-col gap-3">
          <Button
            onClick={() => googleMutation.mutate()}
            disabled={isPending}
          >
            {googleMutation.isPending
              ? "Waiting for browser…"
              : "Sign in with Google"}
          </Button>
          <Button
            variant="outline"
            disabled={isPending}
            onClick={() => setShowICloud(true)}
          >
            <Cloud className="size-4" />
            Sign in with iCloud
          </Button>
        </div>
      )}
      {error != null && (
        <p className="text-destructive max-w-sm text-center text-sm">
          {String(error)}
        </p>
      )}
    </div>
  );
}
