import { createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Mail } from "@/components/mail/mail";
import { SignIn } from "@/components/auth/sign-in";
import { authStatusQuery } from "@/lib/auth";

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(authStatusQuery),
  component: Index,
});

function Index() {
  const { data: signedIn } = useSuspenseQuery(authStatusQuery);
  return signedIn ? <Mail /> : <SignIn />;
}
