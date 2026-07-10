import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useQueryClient } from "@tanstack/react-query";

import {
  archiveMessage,
  markRead,
  markUnread,
  sendMessage,
  trashMessage,
  type OutgoingMail,
} from "@/lib/gmail";
import {
  ICLOUD_FOLDER_NAMES,
  icloudMarkRead,
  icloudMoveMessage,
  icloudSendMessage,
} from "@/lib/icloud";

// Offline write queue. Actions taken while offline are journaled in SQLite
// (pending_ops), applied to the local cache immediately, and replayed against
// the provider when connectivity returns. Replay order = enqueue order.

type MailActionKind = "archive" | "trash" | "read" | "unread";

interface PendingOp {
  id: number;
  kind: string;
  payload: string;
  attempts: number;
  created_at: string;
}

// Ops that keep failing for non-network reasons (message deleted server-side,
// account removed, …) are dropped rather than blocking the queue forever.
const MAX_ATTEMPTS = 10;

/// Distinguish "network unreachable" from "server said no". Queue on the
/// former, surface the latter.
export function isNetworkError(err: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const msg = err instanceof Error ? err.message : String(err);
  if (/^Google API \d/.test(msg)) return false; // HTTP response = server reached
  return /connect|connection|network|timed? ?out|dns|unreachable|error sending request/i.test(
    msg,
  );
}

function enqueueOp(kind: string, payload: unknown) {
  return invoke<number>("ops_enqueue", {
    kind,
    payload: JSON.stringify(payload),
  });
}

export async function queueGmailAction(id: string, action: MailActionKind) {
  await enqueueOp(`gmail:${action}`, { id });
}

export async function queueGmailSend(msg: OutgoingMail) {
  await enqueueOp("gmail:send", msg);
}

export interface IcloudSendPayload {
  accountId: string;
  fromEmail: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
}

export async function queueIcloudSend(params: IcloudSendPayload) {
  await enqueueOp("icloud:send", params);
}

// Queue the op AND update the SQLite message cache so the optimistic state
// survives a restart while still offline.
export async function queueIcloudAction(
  accountId: string,
  folder: string,
  uid: number,
  action: MailActionKind,
) {
  if (action === "read" || action === "unread") {
    await enqueueOp("icloud:read", {
      accountId,
      folder,
      uid,
      read: action === "read",
    });
    await invoke("cache_mark_read", {
      account_id: accountId,
      folder,
      uid,
      read: action === "read",
    }).catch(() => {});
    return;
  }
  const targetFolder =
    action === "archive" ? ICLOUD_FOLDER_NAMES.archive : ICLOUD_FOLDER_NAMES.trash;
  await enqueueOp("icloud:move", { accountId, folder, uid, targetFolder });
  await invoke("cache_remove_message", {
    account_id: accountId,
    folder,
    uid,
  }).catch(() => {});
}

function runOp(op: PendingOp): Promise<unknown> {
  const p = JSON.parse(op.payload);
  switch (op.kind) {
    case "gmail:read":
      return markRead(p.id);
    case "gmail:unread":
      return markUnread(p.id);
    case "gmail:archive":
      return archiveMessage(p.id);
    case "gmail:trash":
      return trashMessage(p.id);
    case "gmail:send":
      return sendMessage(p as OutgoingMail);
    case "icloud:read":
      return icloudMarkRead(p.accountId, p.folder, p.uid, p.read);
    case "icloud:move":
      return icloudMoveMessage(p.accountId, p.folder, p.uid, p.targetFolder);
    case "icloud:send":
      return icloudSendMessage(p as IcloudSendPayload);
    default:
      throw new Error(`unknown pending op kind: ${op.kind}`);
  }
}

let flushing = false;

// Replay queued ops in order. Returns how many succeeded. Stops at the first
// network failure (still offline); non-network failures are retried up to
// MAX_ATTEMPTS, then dropped.
export async function flushPendingOps(): Promise<number> {
  if (flushing) return 0;
  if (typeof navigator !== "undefined" && !navigator.onLine) return 0;
  flushing = true;
  try {
    const ops = await invoke<PendingOp[]>("ops_list");
    let done = 0;
    for (const op of ops) {
      try {
        await runOp(op);
        await invoke("ops_delete", { id: op.id });
        done++;
      } catch (err) {
        if (isNetworkError(err)) break;
        if (op.attempts + 1 >= MAX_ATTEMPTS) {
          await invoke("ops_delete", { id: op.id });
        } else {
          await invoke("ops_bump", { id: op.id });
        }
      }
    }
    return done;
  } finally {
    flushing = false;
  }
}

// Flush on mount, when the OS reports connectivity back, and periodically as
// a safety net (navigator.onLine misses some transitions). After a successful
// replay, refetch so the UI reconciles with the server.
export function useOfflineQueue(intervalMs = 60_000) {
  const queryClient = useQueryClient();

  useEffect(() => {
    let cancelled = false;
    const flush = async () => {
      const done = await flushPendingOps().catch(() => 0);
      if (!cancelled && done > 0) {
        queryClient.invalidateQueries({ queryKey: ["gmail"] });
        queryClient.invalidateQueries({ queryKey: ["icloud"] });
      }
    };
    void flush();
    const timer = setInterval(flush, intervalMs);
    window.addEventListener("online", flush);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("online", flush);
    };
  }, [queryClient, intervalMs]);
}
