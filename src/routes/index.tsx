import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Mail } from "@/components/mail/mail";
import { SignIn } from "@/components/auth/sign-in";
import { authStatusQuery } from "@/lib/auth";
import { useAccount } from "@/context/AccountContext";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(authStatusQuery),
  component: Index,
});

function Index() {
  // Signed in = at least one account in the accounts DB, or a legacy Google
  // sign-in from before multi-account support (keychain token, no account row).
  const { data: legacySignedIn } = useSuspenseQuery(authStatusQuery);
  const { accounts, isLoading } = useAccount();
  if (isLoading) return null;
  return legacySignedIn || accounts.length > 0 ? <Mail /> : <SignIn />;
}
