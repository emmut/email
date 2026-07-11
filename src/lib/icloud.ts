import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import { cacheGet, cachePut } from "@/lib/cache";
import type { Mail } from "@/components/mail/data";
import type { Contact, MailBody } from "@/lib/gmail";

// App folder ids (sidebar) → iCloud IMAP mailbox names.
export const ICLOUD_FOLDER_NAMES: Record<string, string> = {
  inbox: "INBOX",
  drafts: "Drafts",
  sent: "Sent Messages",
  junk: "Junk",
  trash: "Deleted Messages",
  archive: "Archive",
};

// Custom (user-created) mailboxes get sidebar folder ids of the form
// "icloud-mbx:<mailbox name>", analogous to Gmail's tag folder ids.
const CUSTOM_FOLDER_PREFIX = "icloud-mbx:";

export function icloudCustomFolderId(mailbox: string): string {
  return `${CUSTOM_FOLDER_PREFIX}${mailbox}`;
}

export function icloudMailboxFromFolder(folder: string): string | null {
  return folder.startsWith(CUSTOM_FOLDER_PREFIX)
    ? folder.slice(CUSTOM_FOLDER_PREFIX.length)
    : null;
}

export function icloudFolderName(folder: string): string {
  const custom = icloudMailboxFromFolder(folder);
  if (custom) return custom;
  return ICLOUD_FOLDER_NAMES[folder] ?? ICLOUD_FOLDER_NAMES.inbox;
}

// Mail ids for iCloud messages carry the mailbox and UID: "icloud:<folder>:<uid>".
export function icloudMailId(folder: string, uid: number): string {
  return `icloud:${folder}:${uid}`;
}

export function parseIcloudMailId(
  id: string,
): { folder: string; uid: number } | null {
  if (!id.startsWith("icloud:")) return null;
  const rest = id.slice("icloud:".length);
  const sep = rest.lastIndexOf(":");
  if (sep === -1) return null;
  const uid = Number(rest.slice(sep + 1));
  if (!Number.isFinite(uid)) return null;
  return { folder: rest.slice(0, sep), uid };
}

export interface IcloudMessageSummary {
  uid: number;
  message_id: string | null;
  from_name: string | null;
  from_email: string;
  to: string;
  subject: string;
  snippet: string;
  date: string | null;
  flags: string[];
  folder: string;
  read: boolean;
}

export interface IcloudMessageDetail {
  uid: number;
  message_id: string;
  from_name: string | null;
  from_email: string;
  to: string;
  cc: string | null;
  references: string | null;
  subject: string;
  body_text: string;
  body_html: string | null;
  date: string | null;
  flags: string[];
  folder: string;
}

// --- queries ---

// Sync-then-read: an incremental IMAP pass (new UIDs, flag refresh, vanished
// detection) updates SQLite, then the list is served from SQLite. If the sync
// fails but the cache has content, the cached list is shown (offline mode).
export function icloudMessagesQuery(accountId: string, folder: string, limit?: number) {
  return queryOptions({
    queryKey: ["icloud", accountId, "messages", folder, limit],
    queryFn: async (): Promise<IcloudMessageSummary[]> => {
      let syncError: unknown = null;
      try {
        await invoke("cache_sync_icloud", {
          account_id: accountId,
          folder,
          limit: limit ?? 50,
        });
      } catch (e) {
        syncError = e;
      }
      const messages = await invoke<IcloudMessageSummary[]>(
        "icloud_cached_messages",
        { account_id: accountId, folder, limit: limit ?? 50 },
      );
      if (syncError !== null && messages.length === 0) {
        throw syncError instanceof Error ? syncError : new Error(String(syncError));
      }
      return messages;
    },
    enabled: !!accountId && !!folder,
    staleTime: 30_000,
    // Poll for new mail like the Gmail history sync does. Cheap now that the
    // IMAP session is pooled and the sync is an incremental delta.
    refetchInterval: 30_000,
  });
}

// Server-side full-mailbox search (IMAP SEARCH). Keyed under the same
// "messages" prefix so optimistic read/remove updates apply to results too.
export function icloudSearchQuery(accountId: string, folder: string, query: string) {
  return queryOptions({
    queryKey: ["icloud", accountId, "messages", folder, "search", query],
    queryFn: () =>
      invoke<IcloudMessageSummary[]>("icloud_search_messages", {
        account_id: accountId,
        folder,
        query,
        limit: 50,
      }),
    enabled: !!accountId && !!folder && !!query,
    staleTime: 30_000,
  });
}

// Cache-only listing — instant, no network. Used to paint the list while the
// syncing query above is still in flight.
export function icloudLocalMessagesQuery(accountId: string, folder: string, limit?: number) {
  return queryOptions({
    queryKey: ["icloud", accountId, "messages", folder, limit, "local"],
    queryFn: () =>
      invoke<IcloudMessageSummary[]>("icloud_cached_messages", {
        account_id: accountId,
        folder,
        limit: limit ?? 50,
      }),
    enabled: !!accountId && !!folder,
    staleTime: Infinity,
  });
}

export function icloudMessageBodyQuery(accountId: string, folder: string, uid: number) {
  return queryOptions({
    queryKey: ["icloud", accountId, "message", folder, uid],
    queryFn: async (): Promise<MailBody> => {
      const detail = await invoke<IcloudMessageDetail>("icloud_fetch_message", {
        account_id: accountId,
        folder,
        uid,
      });
      const from = detail.from_name
        ? `${detail.from_name} <${detail.from_email}>`
        : detail.from_email;
      const html = detail.body_html
        ? DOMPurify.sanitize(detail.body_html, {
            USE_PROFILES: { html: true },
            FORBID_TAGS: ["form", "input", "button", "select", "textarea"],
          })
        : null;
      return {
        html,
        text: detail.body_text,
        threadId: detail.message_id,
        subject: detail.subject,
        from,
        replyTo: from,
        to: detail.to,
        cc: detail.cc ?? "",
        messageId: detail.message_id,
        references: detail.references ?? "",
        date: detail.date ?? "",
      };
    },
    enabled: !!accountId && !!folder && uid > 0,
    staleTime: Infinity,
  });
}

// User-created mailboxes for the sidebar "Folders" group — everything on the
// server minus the standard mailboxes already shown as fixed folders.
export function icloudFoldersQuery(accountId: string) {
  const standard = new Set(Object.values(ICLOUD_FOLDER_NAMES));
  return queryOptions({
    queryKey: ["icloud", accountId, "folders"],
    queryFn: async (): Promise<string[]> => {
      try {
        const all = await invoke<string[]>("icloud_list_folders", {
          account_id: accountId,
        });
        const custom = all.filter((name) => !standard.has(name));
        cachePut(`icloud:folders:${accountId}`, custom);
        return custom;
      } catch (err) {
        // Offline — fall back to the last known folder list.
        const cached = await cacheGet<string[]>(`icloud:folders:${accountId}`);
        if (cached) return cached;
        throw err;
      }
    },
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

export function icloudCreateFolder(accountId: string, name: string) {
  return invoke<void>("icloud_create_folder", { account_id: accountId, name });
}

export function icloudDeleteFolder(accountId: string, name: string) {
  return invoke<void>("icloud_delete_folder", { account_id: accountId, name });
}

// Sidebar badge counts keyed by app folder id (inbox/junk unread, drafts total).
export function icloudFolderCountsQuery(accountId: string) {
  return queryOptions({
    queryKey: ["icloud", accountId, "counts"],
    queryFn: async (): Promise<Record<string, number>> => {
      try {
        const counts = await invoke<Record<string, number>>(
          "icloud_folder_counts",
          { account_id: accountId },
        );
        cachePut(`icloud:counts:${accountId}`, counts);
        return counts;
      } catch (err) {
        // Offline — fall back to the last known counts.
        const cached = await cacheGet<Record<string, number>>(
          `icloud:counts:${accountId}`,
        );
        if (cached) return cached;
        throw err;
      }
    },
    enabled: !!accountId,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}

// --- mutations ---

export function icloudSendMessage(params: {
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
}) {
  return invoke<void>("icloud_send_message", {
    account_id: params.accountId,
    from_email: params.fromEmail,
    to: params.to,
    cc: params.cc ?? null,
    bcc: params.bcc ?? null,
    subject: params.subject,
    body_text: params.bodyText,
    body_html: params.bodyHtml ?? null,
    in_reply_to: params.inReplyTo ?? null,
    references: params.references ?? null,
  });
}

export function icloudMarkRead(accountId: string, folder: string, uid: number, read: boolean) {
  return invoke<void>("icloud_mark_read", { account_id: accountId, folder, uid, read });
}

export function icloudMoveMessage(
  accountId: string,
  folder: string,
  uid: number,
  targetFolder: string,
) {
  return invoke<void>("icloud_move_message", {
    account_id: accountId,
    folder,
    uid,
    target_folder: targetFolder,
  });
}

// --- adapters to Mail view-model ---

export function toMail(msg: IcloudMessageSummary): Mail {
  return {
    id: icloudMailId(msg.folder, msg.uid),
    name: msg.from_name ?? msg.from_email.split("@")[0],
    email: msg.from_email,
    subject: msg.subject || "(no subject)",
    text: msg.snippet,
    date: msg.date ?? new Date().toISOString(),
    read: msg.read,
    labelIds: [],
    labels: [],
  };
}


// --- avatar ---

// Apple exposes no profile-photo API for app-specific passwords (IMAP/SMTP
// only), so the best available avatar is a Gravatar keyed by the email hash.
// d=404 makes a missing Gravatar fail the <img> load, which drops the Radix
// Avatar back to the initials fallback.
export function icloudAvatarQuery(email: string) {
  return queryOptions({
    queryKey: ["icloud", "avatar", email],
    queryFn: async (): Promise<string> => {
      const bytes = new TextEncoder().encode(email.trim().toLowerCase());
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      return `https://www.gravatar.com/avatar/${hash}?s=160&d=404`;
    },
    enabled: !!email,
    staleTime: Infinity,
  });
}

// --- contacts ---

// IMAP has no contacts API; the local message cache (senders + recipients)
// is the best available address book for iCloud accounts.
export const icloudContactsQuery = queryOptions({
  queryKey: ["icloud", "contacts"],
  queryFn: async (): Promise<Contact[]> => {
    const rows = await invoke<{ name: string | null; email: string }[]>(
      "cache_contacts",
    );
    return rows.map((r) => ({
      name: r.name ?? "",
      email: r.email,
      source: "icloud" as const,
    }));
  },
  staleTime: 5 * 60_000,
});
