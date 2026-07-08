import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Mail } from "@/components/mail/data";
import {
  archiveMessage,
  markRead,
  markUnread,
  trashMessage,
} from "@/lib/gmail";

export type MailAction = "archive" | "trash" | "read" | "unread";

// How an action changes a folder's badge. The drafts badge counts all mail,
// the others count unread mail.
function countDelta(action: MailAction, folder: string, read: boolean): number {
  if (folder === "drafts") {
    return action === "archive" || action === "trash" ? -1 : 0;
  }
  switch (action) {
    case "read":
      return read ? 0 : -1;
    case "unread":
      return read ? 1 : 0;
    case "archive":
    case "trash":
      return read ? 0 : -1;
  }
}

// Shared optimistic mail actions: the cached lists update synchronously on
// mutate (dot flips, archived/trashed cards vanish), roll back on failure,
// and reconcile with the server in the background on success.
export function useMailActions(onRemoved?: (id: string) => void) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ action, id }: { action: MailAction; id: string }) => {
      switch (action) {
        case "archive":
          return archiveMessage(id);
        case "trash":
          return trashMessage(id);
        case "read":
          return markRead(id);
        case "unread":
          return markUnread(id);
      }
    },
    onMutate: async ({ action, id }) => {
      await queryClient.cancelQueries({ queryKey: ["gmail", "list"] });
      await queryClient.cancelQueries({ queryKey: ["gmail", "counts"] });
      const previous = queryClient.getQueriesData<Mail[]>({
        queryKey: ["gmail", "list"],
      });
      const previousCounts = queryClient.getQueryData<Record<string, number>>([
        "gmail",
        "counts",
      ]);

      // Locate the mail and its folder before the list caches change, so the
      // badge delta can account for read state.
      let folder: string | undefined;
      let mail: Mail | undefined;
      for (const [key, data] of previous) {
        const hit = data?.find((m) => m.id === id);
        if (hit) {
          folder = key[2] as string;
          mail = hit;
          break;
        }
      }

      queryClient.setQueriesData<Mail[]>(
        { queryKey: ["gmail", "list"] },
        (old) =>
          action === "read" || action === "unread"
            ? old?.map((m) =>
                m.id === id ? { ...m, read: action === "read" } : m,
              )
            : old?.filter((m) => m.id !== id),
      );

      // Optimistic badge counts: drafts counts totals, inbox/junk count unread.
      if (folder && mail) {
        const delta = countDelta(action, folder, mail.read);
        if (delta !== 0) {
          queryClient.setQueryData<Record<string, number>>(
            ["gmail", "counts"],
            (old) =>
              old && folder in old
                ? { ...old, [folder]: Math.max(0, old[folder] + delta) }
                : old,
          );
        }
      }

      if (action === "archive" || action === "trash") onRemoved?.(id);
      return { previous, previousCounts };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      if (context?.previousCounts) {
        queryClient.setQueryData(["gmail", "counts"], context.previousCounts);
      }
    },
    onSuccess: (_data, { action }) => {
      queryClient.invalidateQueries({ queryKey: ["gmail", "counts"] });
      // Reconcile other folders (archive/trash destinations) in the background;
      // read/unread already left every list cache correct.
      if (action === "archive" || action === "trash") {
        queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      }
    },
  });

  return {
    act: (action: MailAction, id: string) => mutation.mutate({ action, id }),
    isPending: mutation.isPending,
  };
}
