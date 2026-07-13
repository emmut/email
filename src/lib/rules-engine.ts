import { invoke } from "@tauri-apps/api/core";
import { cacheGet, cachePut } from "@/lib/cache";
import {
  loadRules,
  maxUid,
  planIcloudMoves,
  selectNewMessages,
  type IcloudRuleInput,
} from "@/lib/rules";

// Sync-time rule engine for iCloud (which has no server-side rules API).
// Runs after each successful inbox sync: evaluates the account's rules
// against messages that arrived since the previous run and moves matches to
// their target folders over IMAP — the move itself persists server-side, so
// the only client-side weakness is latency while the app is closed.
//
// Talks to the Tauri commands directly (not through icloud.ts) to keep the
// module dependency graph acyclic: icloud.ts imports this file.

const cursorKey = (accountId: string) => `rules:cursor:v1:${accountId}`;

export async function runIcloudRules(accountId: string): Promise<void> {
  const rules = (await loadRules(accountId)).filter((r) => r.enabled);
  if (!rules.length) return;

  const messages = await invoke<IcloudRuleInput[]>("icloud_cached_messages", {
    account_id: accountId,
    folder: "INBOX",
    limit: 50,
  });
  const top = maxUid(messages);
  const cursor = await cacheGet<number>(cursorKey(accountId));
  if (cursor === null) {
    // First run: baseline only — rules apply to mail arriving from now on,
    // never retroactively to the existing inbox.
    cachePut(cursorKey(accountId), top);
    return;
  }

  const moves = planIcloudMoves(selectNewMessages(messages, cursor), rules);
  for (const move of moves) {
    try {
      await invoke("icloud_move_message", {
        account_id: accountId,
        folder: "INBOX",
        uid: move.uid,
        target_folder: move.targetFolder,
      });
      // Drop it from the cached inbox immediately so the listing that follows
      // the sync never shows the moved message.
      await invoke("cache_remove_message", {
        account_id: accountId,
        folder: "INBOX",
        uid: move.uid,
      });
    } catch {
      // Target folder gone or transient IMAP failure — leave the message in
      // the inbox rather than failing the whole run.
    }
  }
  if (top > cursor) cachePut(cursorKey(accountId), top);
}
