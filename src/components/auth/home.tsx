import { Mail } from "@/components/mail/mail";
import { SignIn } from "@/components/auth/sign-in";
import { useAccount } from "@/context/AccountContext";
import { isDesktopApp } from "@/lib/auth";

export function Home() {
  const { activeAccount, isLoading } = useAccount();

  if (isLoading) {
    return (
      <div className="bg-muted/30 flex h-svh items-center justify-center">
        <div
          aria-label="Loading accounts"
          className="bg-muted size-10 animate-pulse rounded-xl"
        />
      </div>
    );
  }

  // Browser development has no Tauri account database and intentionally uses
  // the mock inbox. The desktop app must have a real, selected account before
  // any provider queries are allowed to mount.
  return activeAccount || !isDesktopApp ? <Mail /> : <SignIn />;
}
