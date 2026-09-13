import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  Cloud,
  ExternalLink,
  Inbox,
  LoaderCircle,
  LockKeyhole,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount } from "@/context/AccountContext";
import { cn, isMac } from "@/lib/utils";

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/^Error:\s*/i, "");
}

export function SignIn() {
  const {
    addGoogleAccount,
    addICloudAccount,
    accountsError,
    refetch,
  } = useAccount();
  const [showICloud, setShowICloud] = useState(false);
  const [icloudEmail, setIcloudEmail] = useState("");
  const [icloudPassword, setIcloudPassword] = useState("");

  const googleMutation = useMutation({ mutationFn: addGoogleAccount });
  const icloudMutation = useMutation({
    mutationFn: () => addICloudAccount(icloudEmail.trim(), icloudPassword),
  });
  const isPending = googleMutation.isPending || icloudMutation.isPending;
  const error = googleMutation.error ?? icloudMutation.error;

  return (
    <main
      className={cn(
        "bg-muted/30 flex h-svh overflow-y-auto p-6",
        isMac && "pt-12",
      )}
    >
      <div data-tauri-drag-region className="fixed inset-x-0 top-0 h-8" />
      <div className="mx-auto my-auto grid w-full max-w-4xl overflow-hidden rounded-2xl border bg-background shadow-sm md:grid-cols-[1.05fr_0.95fr]">
        <section className="border-b bg-muted/40 p-8 md:border-r md:border-b-0 md:p-10">
          <div className="flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Inbox className="size-5" />
          </div>
          <div className="mt-8 max-w-sm">
            <p className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
              Welcome to Email
            </p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              Your inbox, without the browser.
            </h1>
            <p className="text-muted-foreground mt-3 text-sm leading-6">
              Connect an account to read, write, and organize your mail from
              one focused desktop app.
            </p>
          </div>
          <ul className="mt-8 grid gap-3 text-sm">
            <li className="flex items-center gap-3">
              <span className="bg-background flex size-6 items-center justify-center rounded-full border">
                <Check className="size-3.5" />
              </span>
              Works with Gmail and iCloud Mail
            </li>
            <li className="flex items-center gap-3">
              <span className="bg-background flex size-6 items-center justify-center rounded-full border">
                <LockKeyhole className="size-3.5" />
              </span>
              Credentials stay in your system keychain
            </li>
          </ul>
        </section>

        <section className="flex min-h-96 flex-col justify-center p-8 md:p-10">
          {accountsError ? (
            <div className="flex flex-col items-start gap-4" role="alert">
              <div>
                <h2 className="text-lg font-semibold">
                  We couldn&apos;t load your accounts
                </h2>
                <p className="text-muted-foreground mt-1 text-sm leading-6">
                  Your account data is still on this computer. Try loading it
                  again before connecting a new account.
                </p>
              </div>
              <p className="text-destructive text-sm">
                {errorMessage(accountsError)}
              </p>
              <Button onClick={() => void refetch()}>Try again</Button>
            </div>
          ) : showICloud ? (
            <ICloudForm
              email={icloudEmail}
              password={icloudPassword}
              isPending={isPending}
              onEmailChange={setIcloudEmail}
              onPasswordChange={setIcloudPassword}
              onBack={() => {
                icloudMutation.reset();
                setShowICloud(false);
              }}
              onSubmit={() => icloudMutation.mutate()}
            />
          ) : (
            <div>
              <h2 className="text-lg font-semibold">Connect your first account</h2>
              <p className="text-muted-foreground mt-1 text-sm">
                Choose your mail provider to get started.
              </p>
              <div className="mt-6 flex flex-col gap-3">
                <Button
                  size="lg"
                  className="w-full justify-start px-4"
                  onClick={() => googleMutation.mutate()}
                  disabled={isPending}
                >
                  {googleMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <span className="flex size-5 items-center justify-center rounded-full bg-white text-xs font-bold text-neutral-800">
                      G
                    </span>
                  )}
                  <span className="flex-1 text-left">
                    {googleMutation.isPending
                      ? "Finish signing in in your browser…"
                      : "Continue with Google"}
                  </span>
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  className="w-full justify-start px-4"
                  disabled={isPending}
                  onClick={() => {
                    googleMutation.reset();
                    setShowICloud(true);
                  }}
                >
                  <Cloud />
                  Continue with iCloud
                </Button>
              </div>
              <p className="text-muted-foreground mt-5 text-xs leading-5">
                Email only requests the access it needs to manage mail. You can
                remove an account at any time in Settings.
              </p>
            </div>
          )}

          {error != null && (
            <div
              className="border-destructive/20 bg-destructive/10 text-destructive mt-5 rounded-lg border p-3 text-sm"
              role="alert"
            >
              {errorMessage(error)}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ICloudForm({
  email,
  password,
  isPending,
  onEmailChange,
  onPasswordChange,
  onBack,
  onSubmit,
}: {
  email: string;
  password: string;
  isPending: boolean;
  onEmailChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 mb-5"
        disabled={isPending}
        onClick={onBack}
      >
        <ArrowLeft />
        All providers
      </Button>
      <h2 className="text-lg font-semibold">Connect iCloud Mail</h2>
      <p className="text-muted-foreground mt-1 text-sm leading-6">
        Apple requires an app-specific password instead of your Apple Account
        password.
      </p>
      <form
        className="mt-5 flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (email.trim() && password) onSubmit();
        }}
      >
        <label className="grid gap-1.5 text-sm font-medium">
          iCloud email
          <Input
            autoFocus
            autoComplete="email"
            placeholder="you@icloud.com"
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          App-specific password
          <Input
            autoComplete="off"
            placeholder="xxxx-xxxx-xxxx-xxxx"
            type="password"
            value={password}
            onChange={(event) => onPasswordChange(event.target.value)}
          />
        </label>
        <a
          href="https://account.apple.com/sign-in"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground inline-flex w-fit items-center gap-1 text-xs underline underline-offset-4 hover:text-foreground"
        >
          Create a password at account.apple.com
          <ExternalLink className="size-3" />
        </a>
        <Button
          size="lg"
          type="submit"
          disabled={isPending || !email.trim() || !password}
        >
          {isPending && <LoaderCircle className="animate-spin" />}
          {isPending ? "Checking your account…" : "Connect iCloud Mail"}
        </Button>
      </form>
    </div>
  );
}
