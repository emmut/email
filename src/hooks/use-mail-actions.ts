import { useMutation, useQueryClient } from "@tanstack/react-query";

import type { Mail } from "@/components/mail/data";
import { useAccount } from "@/context/AccountContext";
import {
  applyGmailActionToCache,
  applyGmailLabelChange,
  archiveMessage,
  deleteMessage,
  markRead,
  markUnread,
  removeGmailFromCache,
  setMessageTag,
  tagFolderId,
  trashMessage,
  type Tag,
} from "@/lib/gmail";
import {
  ICLOUD_FOLDER_NAMES,
  icloudDeleteMessage,
  icloudMarkRead,
  icloudMoveMessage,
  parseIcloudMailId,
  type IcloudMessageSummary,
} from "@/lib/icloud";
import {
  isNetworkError,
  queueGmailAction,
  queueIcloudAction,
} from "@/lib/offline";

export type MailAction = "archive" | "trash" | "read" | "unread" | "delete";

// How an action changes a folder's badge. The drafts badge counts all mail,
// the others count unread mail.
function countDelta(action: MailAction, folder: string, read: boolean): number {
  if (folder === "drafts") {
    return action === "read" || action === "unread" ? 0 : -1;
  }
  switch (action) {
    case "read":
      return read ? 0 : -1;
    case "unread":
      return read ? 1 : 0;
    case "archive":
    case "trash":
    case "delete":
      return read ? 0 : -1;
  }
}

// Shared optimistic mail actions: the cached lists update synchronously on
// mutate (dot flips, archived/trashed cards vanish), roll back on failure,
// and reconcile with the server in the background on success.
export function useMailActions(onRemoved?: (id: string) => void) {
  const queryClient = useQueryClient();
  const { activeAccount } = useAccount();

  const mutation = useMutation({
    mutationFn: async ({ action, id }: { action: MailAction; id: string }) => {
      const ref = parseIcloudMailId(id);
      if (ref && activeAccount) {
        try {
          switch (action) {
            case "archive":
              await icloudMoveMessage(
                activeAccount.id,
                ref.folder,
                ref.uid,
                ICLOUD_FOLDER_NAMES.archive,
              );
              return;
            case "trash":
              await icloudMoveMessage(
                activeAccount.id,
                ref.folder,
                ref.uid,
                ICLOUD_FOLDER_NAMES.trash,
              );
              return;
            case "read":
            case "unread":
              await icloudMarkRead(
                activeAccount.id,
                ref.folder,
                ref.uid,
                action === "read",
              );
              return;
            case "delete":
              await icloudDeleteMessage(activeAccount.id, ref.folder, ref.uid);
              return;
          }
        } catch (err) {
          // Offline: journal the action (also updates the SQLite cache) and
          // keep the optimistic UI — it replays when connectivity returns.
          // Permanent deletes are never queued: too destructive to replay.
          if (!isNetworkError(err) || action === "delete") throw err;
          await queueIcloudAction(activeAccount.id, ref.folder, ref.uid, action);
          return;
        }
      }
      try {
        switch (action) {
          case "archive":
            await archiveMessage(id);
            return;
          case "trash":
            await trashMessage(id);
            return;
          case "read":
            await markRead(id);
            return;
          case "unread":
            await markUnread(id);
            return;
          case "delete":
            await deleteMessage(id);
            return;
        }
      } catch (err) {
        if (!isNetworkError(err) || action === "delete") throw err;
        await queueGmailAction(id, action);
      }
    },
    onMutate: async ({ action, id }) => {
      const ref = parseIcloudMailId(id);
      if (ref && activeAccount) {
        const listKey = ["icloud", activeAccount.id, "messages"];
        await queryClient.cancelQueries({ queryKey: listKey });
        const icloudPrevious = queryClient.getQueriesData<
          IcloudMessageSummary[]
        >({ queryKey: listKey });
        queryClient.setQueriesData<IcloudMessageSummary[]>(
          { queryKey: listKey },
          (old) =>
            action === "read" || action === "unread"
              ? old?.map((m) =>
                  m.uid === ref.uid && m.folder === ref.folder
                    ? { ...m, read: action === "read" }
                    : m,
                )
              : old?.filter(
                  (m) => !(m.uid === ref.uid && m.folder === ref.folder),
                ),
        );
        if (action !== "read" && action !== "unread") onRemoved?.(id);
        return {
          previous: undefined,
          previousCounts: undefined,
          icloudPrevious,
        };
      }

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

      if (action !== "read" && action !== "unread") onRemoved?.(id);
      // Mirror the change into the local message store right away — durable
      // across restarts whether the server call succeeds now or replays later.
      if (action === "delete") void removeGmailFromCache(id);
      else void applyGmailActionToCache(id, action);
      return { previous, previousCounts, icloudPrevious: undefined };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      context?.icloudPrevious?.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
      if (context?.previousCounts) {
        queryClient.setQueryData(["gmail", "counts"], context.previousCounts);
      }
    },
    onSuccess: (_data, { action, id }) => {
      // Keep the pending-ops indicator fresh (the action may have queued).
      queryClient.invalidateQueries({ queryKey: ["ops"] });
      const ref = parseIcloudMailId(id);
      if (ref && activeAccount) {
        queryClient.invalidateQueries({
          queryKey: ["icloud", activeAccount.id, "counts"],
        });
        // Reconcile the destination folder's list in the background.
        if (action !== "read" && action !== "unread") {
          queryClient.invalidateQueries({
            queryKey: ["icloud", activeAccount.id, "messages"],
          });
        }
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["gmail", "counts"] });
      // Reconcile other folders (archive/trash destinations) in the background;
      // read/unread already left every list cache correct.
      if (action !== "read" && action !== "unread") {
        queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
      }
    },
  });

  return {
    act: (action: MailAction, id: string) => mutation.mutate({ action, id }),
    isPending: mutation.isPending,
    // Failures roll the optimistic update back; surface why so a "nothing
    // happened" (e.g. denied permanent delete) isn't silent.
    error: mutation.error,
  };
}

// Move an iCloud message to an arbitrary mailbox (context-menu "Move to
// folder"). Optimistic like archive: the card leaves the current list at
// once and comes back if the server says no. Not offline-queued.
export function useMoveToFolder() {
  const queryClient = useQueryClient();
  const { activeAccount } = useAccount();

  const mutation = useMutation({
    mutationFn: async ({ id, target }: { id: string; target: string }) => {
      const ref = parseIcloudMailId(id);
      if (!ref || !activeAccount) {
        throw new Error("moving to a folder requires an iCloud account");
      }
      await icloudMoveMessage(activeAccount.id, ref.folder, ref.uid, target);
    },
    onMutate: async ({ id }) => {
      const ref = parseIcloudMailId(id);
      if (!ref || !activeAccount) return { previous: undefined };
      const listKey = ["icloud", activeAccount.id, "messages"];
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueriesData<IcloudMessageSummary[]>({
        queryKey: listKey,
      });
      queryClient.setQueriesData<IcloudMessageSummary[]>(
        { queryKey: listKey },
        (old) =>
          old?.filter((m) => !(m.uid === ref.uid && m.folder === ref.folder)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
    },
    onSuccess: () => {
      if (!activeAccount) return;
      // Reconcile the destination folder's list and the badge counts.
      queryClient.invalidateQueries({
        queryKey: ["icloud", activeAccount.id],
      });
    },
  });

  return {
    moveTo: (id: string, target: string) => mutation.mutate({ id, target }),
    error: mutation.error,
  };
}

function addTagToMail(mail: Mail, tag: Tag): Mail {
  return {
    ...mail,
    labelIds: [...new Set([...mail.labelIds, tag.id])],
    labels: [...new Set([...mail.labels, tag.name.toLowerCase()])],
  };
}

function removeTagFromMail(mail: Mail, tag: Tag): Mail {
  return {
    ...mail,
    labelIds: mail.labelIds.filter((id) => id !== tag.id),
    labels: mail.labels.filter((l) => l !== tag.name.toLowerCase()),
  };
}

// Optimistic tag toggle: list caches update synchronously (badge appears or
// disappears, mail drops out of an open tag folder), roll back on failure,
// and reconcile with the server on success.
export function useTagActions() {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: ({ id, tag, on }: { id: string; tag: Tag; on: boolean }) =>
      setMessageTag(id, tag.id, on),
    onMutate: async ({ id, tag, on }) => {
      void applyGmailLabelChange(id, on ? [tag.id] : [], on ? [] : [tag.id]);
      await queryClient.cancelQueries({ queryKey: ["gmail", "list"] });
      const previous = queryClient.getQueriesData<Mail[]>({
        queryKey: ["gmail", "list"],
      });
      const apply = on ? addTagToMail : removeTagFromMail;
      for (const [key, mails] of previous) {
        if (!mails) continue;
        // Untagging while that tag's folder is open removes the mail from it.
        if (!on && key[2] === tagFolderId(tag.id)) {
          queryClient.setQueryData(
            key,
            mails.filter((m) => m.id !== id),
          );
          continue;
        }
        queryClient.setQueryData(
          key,
          mails.map((m) => (m.id === id ? apply(m, tag) : m)),
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      context?.previous?.forEach(([key, data]) =>
        queryClient.setQueryData(key, data),
      );
    },
    onSuccess: () => {
      // Reconcile tag folder lists (newly tagged mail appears there).
      queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
    },
  });

  return {
    toggle: (id: string, tag: Tag, on: boolean) =>
      mutation.mutate({ id, tag, on }),
  };
}
