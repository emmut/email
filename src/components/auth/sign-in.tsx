import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth";

export function SignIn() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: signIn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["auth"] }),
  });

  return (
    <div className="flex h-svh flex-col items-center justify-center gap-6">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="bg-muted flex size-12 items-center justify-center rounded-xl">
          <Inbox className="size-6" />
        </div>
        <h1 className="text-2xl font-semibold">Email</h1>
        <p className="text-muted-foreground max-w-sm text-sm">
          Sign in with your Google account to load your inbox. Your browser
          will open to complete the sign-in.
        </p>
      </div>
      <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
        {mutation.isPending ? "Waiting for browser…" : "Sign in with Google"}
      </Button>
      {mutation.isError && (
        <p className="text-destructive max-w-sm text-center text-sm">
          {String(mutation.error)}
        </p>
      )}
    </div>
  );
}
