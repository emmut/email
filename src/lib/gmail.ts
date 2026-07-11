import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { invoke } from "@tauri-apps/api/core";
import { fetch } from "@tauri-apps/plugin-http";
import { queryOptions, useQueryClient } from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { cacheDeletePrefix, cacheGet, cachePut } from "@/lib/cache";
import { compareNames } from "@/lib/utils";
import type { Mail } from "@/components/mail/data";

// Gmail is single-account today (legacy OAuth token); the local message store
// is keyed under this id.
const GMAIL_CACHE_ACCOUNT = "legacy";

export function clearGmailCache() {
  lastFolderSync.clear();
  prefetchedBodies.clear();
  return Promise.all([
    cacheDeletePrefix("gmail:"),
    invoke("gmail_cache_clear", { account_id: GMAIL_CACHE_ACCOUNT }).catch(
      () => {},
    ),
  ]);
}

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const PEOPLE_BASE = "https://people.googleapis.com/v1";

async function google<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    throw new Error(`Google API ${res.status}: ${await res.text()}`);
  }
  // Some endpoints (e.g. labels.delete) return an empty body.
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function gmail<T>(path: string, init?: RequestInit): Promise<T> {
  return google<T>(`${BASE}${path}`, init);
}

// --- API response shapes (only the fields we read) ---

interface Profile {
  emailAddress: string;
  historyId: string;
}

interface MessageRef {
  id: string;
}

interface MessagePartBody {
  data?: string;
}

interface MessagePart {
  mimeType: string;
  headers?: { name: string; value: string }[];
  body?: MessagePartBody;
  parts?: MessagePart[];
}

interface Message {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: MessagePart;
}

interface Label {
  id: string;
  name: string;
  type: "system" | "user";
  messagesTotal?: number;
  messagesUnread?: number;
}

// --- header / body parsing ---

// The Gmail API returns header values raw, so non-ASCII text arrives as RFC
// 2047 encoded-words (=?charset?B|Q?data?=); decode them for display.
function decodeRfc2047(value: string): string {
  if (!value.includes("=?")) return value;
  // Whitespace between adjacent encoded words is not part of the text.
  const joined = value.replace(/(\?=)\s+(?==\?)/g, "$1");
  return joined.replace(
    /=\?([^?]+)\?([bq])\?([^?]*)\?=/gi,
    (match, charset: string, enc: string, data: string) => {
      try {
        let bytes: Uint8Array;
        if (enc.toLowerCase() === "b") {
          bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
        } else {
          const out: number[] = [];
          const text = data.replace(/_/g, " ");
          for (let i = 0; i < text.length; i++) {
            const hex = text.slice(i + 1, i + 3);
            if (text[i] === "=" && /^[0-9a-f]{2}$/i.test(hex)) {
              out.push(parseInt(hex, 16));
              i += 2;
            } else {
              out.push(text.charCodeAt(i));
            }
          }
          bytes = new Uint8Array(out);
        }
        // Charset may carry an RFC 2231 language tag ("utf-8*en").
        return new TextDecoder(charset.split("*")[0]).decode(bytes);
      } catch {
        return match;
      }
    },
  );
}

function header(msg: Message, name: string): string {
  return decodeRfc2047(
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? "",
  );
}

// "Display Name <addr@x>" → { name, email }; bare address → both.
function parseFrom(raw: string): { name: string; email: string } {
  const match = raw.match(/^\s*"?(.*?)"?\s*<(.+)>\s*$/);
  if (match) return { name: match[1] || match[2], email: match[2] };
  return { name: raw, email: raw };
}

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function htmlToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, script").forEach((el) => el.remove());
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

interface BodyContent {
  html: string | null; // sanitized, ready to render
  text: string;
}

export interface MailBody extends BodyContent {
  // Reply metadata (RFC 2822 threading + recipients)
  threadId: string;
  subject: string;
  from: string; // raw header, may be "Name <addr>"
  replyTo: string; // Reply-To if present, else From
  to: string;
  cc: string;
  messageId: string; // Message-ID header value
  references: string;
  date: string;
}

// Collect the first text/html and text/plain parts anywhere in the MIME tree.
// HTML is preferred for display (sanitized here); plain text is the fallback.
function extractBody(payload: MessagePart | undefined): BodyContent {
  if (!payload) return { html: null, text: "" };
  let plain = "";
  let html = "";
  const walk = (part: MessagePart) => {
    if (part.body?.data) {
      if (part.mimeType === "text/plain" && !plain) {
        plain = decodeBase64Url(part.body.data);
      } else if (part.mimeType === "text/html" && !html) {
        html = decodeBase64Url(part.body.data);
      }
    }
    part.parts?.forEach(walk);
  };
  walk(payload);
  return {
    html: html
      ? DOMPurify.sanitize(html, {
          USE_PROFILES: { html: true },
          FORBID_TAGS: ["form", "input", "button", "select", "textarea"],
        })
      : null,
    text: plain || (html ? htmlToText(html) : ""),
  };
}

const SYSTEM_LABELS = new Set([
  "INBOX",
  "UNREAD",
  "IMPORTANT",
  "STARRED",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
]);

function toMail(msg: Message, labelNames: Map<string, string>): Mail {
  const from = parseFrom(header(msg, "From"));
  return {
    id: msg.id,
    name: from.name,
    email: from.email,
    subject: header(msg, "Subject") || "(no subject)",
    text: msg.snippet ?? "",
    date: new Date(Number(msg.internalDate ?? 0)).toISOString(),
    read: !msg.labelIds?.includes("UNREAD"),
    labelIds: msg.labelIds ?? [],
    labels: (msg.labelIds ?? [])
      .filter((id) => !SYSTEM_LABELS.has(id) && !id.startsWith("CATEGORY_"))
      .map((id) => labelNames.get(id) ?? id)
      .map((name) => name.toLowerCase()),
  };
}

// --- queries ---

export const profileQuery = queryOptions({
  queryKey: ["gmail", "profile"],
  queryFn: () => gmail<Profile>("/profile"),
  staleTime: Infinity,
});

// Signed-in account's profile photo URL (null if none or not permitted).
export const avatarQuery = queryOptions({
  queryKey: ["gmail", "avatar"],
  queryFn: async (): Promise<string | null> => {
    const res = await google<{
      photos?: { url?: string; metadata?: { primary?: boolean } }[];
    }>(`${PEOPLE_BASE}/people/me?personFields=photos`);
    const photo =
      res.photos?.find((p) => p.metadata?.primary) ?? res.photos?.[0];
    return photo?.url ?? null;
  },
  staleTime: Infinity,
  retry: false, // 403 when the granted scopes don't cover profile photos
});

// Label id → display name, fetched once per session (user labels rarely change;
// the map is only used for badge text).
let labelNamesPromise: Promise<Map<string, string>> | null = null;
function labelNames(): Promise<Map<string, string>> {
  labelNamesPromise ??= gmail<{ labels: Label[] }>("/labels")
    .then((res) => new Map(res.labels.map((l) => [l.id, l.name])))
    .catch((err) => {
      labelNamesPromise = null;
      throw err;
    });
  return labelNamesPromise;
}

// --- tags (Gmail user labels) ---

export interface Tag {
  id: string;
  name: string;
}

export const tagsQuery = queryOptions({
  queryKey: ["gmail", "tags"],
  queryFn: async (): Promise<Tag[]> => {
    const res = await gmail<{ labels: Label[] }>("/labels");
    return res.labels
      .filter((l) => l.type === "user")
      .map((l) => ({ id: l.id, name: l.name }))
      .sort((a, b) => compareNames(a.name, b.name));
  },
  staleTime: 5 * 60_000,
});

export async function createTag(name: string): Promise<Tag> {
  const label = await gmail<Label>("/labels", {
    method: "POST",
    body: JSON.stringify({
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    }),
  });
  // Keep the id → name map current so new tags render by name immediately.
  (await labelNames()).set(label.id, label.name);
  return { id: label.id, name: label.name };
}

// Deletes the label everywhere; Gmail removes it from all messages.
export function deleteTag(tagId: string) {
  return gmail<void>(`/labels/${encodeURIComponent(tagId)}`, {
    method: "DELETE",
  });
}

export function setMessageTag(id: string, tagId: string, on: boolean) {
  return modifyMessage(
    id,
    on ? { addLabelIds: [tagId] } : { removeLabelIds: [tagId] },
  );
}

// Tags surface in the sidebar as synthetic folder ids ("tag:<labelId>").
// These two are the only places that know the encoding.
export function tagFolderId(tagId: string): string {
  return `tag:${tagId}`;
}

export function tagIdFromFolder(folder: string): string | null {
  return folder.startsWith("tag:") ? folder.slice(4) : null;
}

// Folder id (sidebar) → messages.list params. Archive = everything that has
// been removed from the inbox but not sent/drafted/junked/trashed.
const FOLDER_PARAMS: Record<string, string> = {
  inbox: "labelIds=INBOX",
  drafts: "labelIds=DRAFT",
  sent: "labelIds=SENT",
  junk: "labelIds=SPAM",
  trash: "labelIds=TRASH",
  archive: `q=${encodeURIComponent("-in:inbox -in:sent -in:drafts -in:spam -in:trash")}`,
};

function folderParams(folder: string): string {
  const tagId = tagIdFromFolder(folder);
  return tagId
    ? `labelIds=${encodeURIComponent(tagId)}`
    : (FOLDER_PARAMS[folder] ?? FOLDER_PARAMS.inbox);
}

async function fetchMailsFromNetwork(params: string): Promise<Mail[]> {
  const list = await gmail<{ messages?: MessageRef[] }>(
    `/messages?maxResults=50&${params}`,
  );
  if (!list.messages?.length) return [];
  const [names, messages] = await Promise.all([
    labelNames(),
    Promise.all(
      list.messages.map((m) =>
        gmail<Message>(
          `/messages/${m.id}?format=metadata` +
            `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
        ),
      ),
    ),
  ]);
  return messages.map((m) => toMail(m, names));
}

// --- local message store: SQLite is the read path, the network fills it ---

interface GmailCachedMessage {
  id: string;
  thread_id: string | null;
  name: string;
  email: string;
  subject: string;
  snippet: string;
  date: string;
  read: boolean;
  label_ids: string[];
}

// App folder id → the label defining it (null = Archive: no folder label).
function folderLabelId(folder: string): string | null {
  const tagId = tagIdFromFolder(folder);
  if (tagId) return tagId;
  const map: Record<string, string | null> = {
    inbox: "INBOX",
    drafts: "DRAFT",
    sent: "SENT",
    junk: "SPAM",
    trash: "TRASH",
    archive: null,
  };
  return folder in map ? map[folder] : "INBOX";
}

function mailToRow(m: Mail): GmailCachedMessage {
  return {
    id: m.id,
    thread_id: null,
    name: m.name,
    email: m.email,
    subject: m.subject,
    snippet: m.text,
    date: m.date,
    read: m.read,
    label_ids: m.labelIds,
  };
}

async function rowsToMails(rows: GmailCachedMessage[]): Promise<Mail[]> {
  const isUserLabel = (id: string) =>
    !SYSTEM_LABELS.has(id) && !id.startsWith("CATEGORY_");
  // Badge names need the label map; offline it may be unavailable — fall back
  // to raw ids rather than failing the listing.
  const names = rows.some((r) => r.label_ids.some(isUserLabel))
    ? await labelNames().catch(() => new Map<string, string>())
    : new Map<string, string>();
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    subject: r.subject,
    text: r.snippet,
    date: r.date,
    read: r.read,
    labelIds: r.label_ids,
    labels: r.label_ids
      .filter(isUserLabel)
      .map((id) => (names.get(id) ?? id).toLowerCase()),
  }));
}

async function readGmailFolder(folder: string): Promise<Mail[]> {
  const rows = await invoke<GmailCachedMessage[]>("gmail_cache_list", {
    account_id: GMAIL_CACHE_ACCOUNT,
    label_id: folderLabelId(folder),
    limit: 50,
  });
  return rowsToMails(rows);
}

// Full folder syncs are expensive (1 list + 50 metadata requests). Between
// them the history delta keeps the local store fresh, so invalidation-driven
// refetches are pure SQLite reads.
const FULL_SYNC_INTERVAL = 5 * 60_000;
const lastFolderSync = new Map<string, number>();

async function syncGmailFolder(folder: string): Promise<void> {
  const mails = await fetchMailsFromNetwork(folderParams(folder));
  await invoke("gmail_cache_replace_folder", {
    account_id: GMAIL_CACHE_ACCOUNT,
    label_id: folderLabelId(folder),
    messages: mails.map(mailToRow),
  });
  lastFolderSync.set(folder, Date.now());
  // Fire-and-forget: warm the body cache for the newest messages so they're
  // readable offline without ever having been opened.
  void prefetchBodies(mails.slice(0, 10));
}

// Called when the historyId reseeds (expired/invalid) — the deltas we missed
// are unknown, so folders must fully resync on next view.
function invalidateFolderSyncState() {
  lastFolderSync.clear();
}

// Label ops mirroring the server-side mail actions, applied to the local
// store immediately (online or offline) so the state survives a restart.
const ACTION_LABEL_OPS: Record<string, { add: string[]; remove: string[] }> = {
  read: { add: [], remove: ["UNREAD"] },
  unread: { add: ["UNREAD"], remove: [] },
  archive: { add: [], remove: ["INBOX"] },
  trash: { add: ["TRASH"], remove: ["INBOX"] },
};

export function applyGmailLabelChange(
  id: string,
  add: string[],
  remove: string[],
) {
  return invoke("gmail_cache_modify_labels", {
    account_id: GMAIL_CACHE_ACCOUNT,
    message_id: id,
    add,
    remove,
  }).catch(() => {});
}

export function applyGmailActionToCache(
  id: string,
  action: "read" | "unread" | "archive" | "trash",
) {
  const ops = ACTION_LABEL_OPS[action];
  return applyGmailLabelChange(id, ops.add, ops.remove);
}

// Drop a permanently deleted message from the local store.
export function removeGmailFromCache(id: string) {
  return invoke("gmail_cache_delete", {
    account_id: GMAIL_CACHE_ACCOUNT,
    ids: [id],
  });
}

export function mailListQuery(folder: string, search: string) {
  return queryOptions({
    queryKey: ["gmail", "list", folder, search],
    queryFn: async (): Promise<Mail[]> => {
      // Ad-hoc searches go straight to the server, uncached.
      if (search) {
        let params = folderParams(folder);
        const q = params.startsWith("q=")
          ? `${decodeURIComponent(params.slice(2))} ${search}`
          : search;
        params = params.startsWith("q=")
          ? `q=${encodeURIComponent(q)}`
          : `${params}&q=${encodeURIComponent(q)}`;
        return fetchMailsFromNetwork(params);
      }
      // Local-first: full-sync at most every FULL_SYNC_INTERVAL (history
      // deltas cover the gaps), then serve the listing from SQLite.
      let syncError: unknown = null;
      if (Date.now() - (lastFolderSync.get(folder) ?? 0) > FULL_SYNC_INTERVAL) {
        try {
          await syncGmailFolder(folder);
        } catch (err) {
          syncError = err;
        }
      }
      const mails = await readGmailFolder(folder);
      if (syncError !== null && mails.length === 0) {
        throw syncError instanceof Error
          ? syncError
          : new Error(String(syncError));
      }
      return mails;
    },
    staleTime: 30_000,
  });
}

// Ids checked once per session — list queries refetch every 30s and the
// answer for an already-cached body never changes.
const prefetchedBodies = new Set<string>();

async function prefetchBodies(mails: Mail[]) {
  for (const mail of mails) {
    if (prefetchedBodies.has(mail.id)) continue;
    try {
      if (!(await cacheGet<MailBody>(`gmail:body:${mail.id}`))) {
        await fetchMailBody(mail.id); // caches as a side effect
      }
      prefetchedBodies.add(mail.id);
    } catch {
      return; // network gone — stop quietly
    }
  }
}

// Local-store-only folder listing — instant, no network. Painted while the
// syncing query above is in flight.
export function gmailCachedListQuery(folder: string) {
  return queryOptions({
    queryKey: ["gmail", "list", folder, "@cache"],
    queryFn: () => readGmailFolder(folder),
    staleTime: Infinity,
  });
}

// Bodies are immutable — serve from the local cache when present, and cache
// on first fetch (also used by the list prefetcher).
async function fetchMailBody(id: string): Promise<MailBody> {
  const cached = await cacheGet<MailBody>(`gmail:body:${id}`);
  if (cached) return cached;
  const msg = await gmail<Message>(`/messages/${id}?format=full`);
  const from = header(msg, "From");
  const body: MailBody = {
    ...extractBody(msg.payload),
    threadId: msg.threadId,
    subject: header(msg, "Subject"),
    from,
    replyTo: header(msg, "Reply-To") || from,
    to: header(msg, "To"),
    cc: header(msg, "Cc"),
    messageId: header(msg, "Message-ID"),
    references: header(msg, "References"),
    date: header(msg, "Date"),
  };
  cachePut(`gmail:body:${id}`, body);
  return body;
}

export function mailBodyQuery(id: string) {
  return queryOptions({
    queryKey: ["gmail", "message", id],
    queryFn: () => fetchMailBody(id),
    staleTime: Infinity,
  });
}

// Sidebar badge counts, keyed by folder id.
export const folderCountsQuery = queryOptions({
  queryKey: ["gmail", "counts"],
  queryFn: async (): Promise<Record<string, number>> => {
    try {
      const [inbox, drafts, junk] = await Promise.all([
        gmail<Label>("/labels/INBOX"),
        gmail<Label>("/labels/DRAFT"),
        gmail<Label>("/labels/SPAM"),
      ]);
      const counts = {
        inbox: inbox.messagesUnread ?? 0,
        drafts: drafts.messagesTotal ?? 0,
        junk: junk.messagesUnread ?? 0,
      };
      cachePut("gmail:counts", counts);
      return counts;
    } catch (err) {
      // Offline — fall back to the last known counts.
      const cached = await cacheGet<Record<string, number>>("gmail:counts");
      if (cached) return cached;
      throw err;
    }
  },
  staleTime: 30_000,
});

// --- signature ---

interface SendAs {
  sendAsEmail: string;
  isDefault?: boolean;
  isPrimary?: boolean;
  signature?: string;
}

// Default send-as identity's signature, as Gmail-hosted HTML ("" if none).
export const signatureQuery = queryOptions({
  queryKey: ["gmail", "signature"],
  queryFn: async () => {
    const res = await gmail<{ sendAs?: SendAs[] }>("/settings/sendAs");
    const identity =
      res.sendAs?.find((s) => s.isDefault) ??
      res.sendAs?.find((s) => s.isPrimary) ??
      res.sendAs?.[0];
    return identity?.signature ?? "";
  },
  staleTime: Infinity,
});

// --- contacts (People API) ---

export interface Contact {
  name: string;
  email: string;
  source: "google" | "icloud";
}

interface Person {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
}

function toContacts(people: Person[] | undefined): Contact[] {
  return (people ?? []).flatMap((p) => {
    const name = p.names?.[0]?.displayName ?? "";
    return (p.emailAddresses ?? [])
      .map((e) => e.value?.trim())
      .filter((v): v is string => Boolean(v))
      .map((email) => ({ name, email, source: "google" as const }));
  });
}

// Saved contacts + "other contacts" (the interaction-derived pool Gmail's own
// autocomplete uses), deduped by address.
export const contactsQuery = queryOptions({
  queryKey: ["gmail", "contacts"],
  queryFn: async (): Promise<Contact[]> => {
    const [saved, other] = await Promise.all([
      google<{ connections?: Person[] }>(
        `${PEOPLE_BASE}/people/me/connections?personFields=names,emailAddresses&pageSize=1000`,
      ),
      google<{ otherContacts?: Person[] }>(
        `${PEOPLE_BASE}/otherContacts?readMask=names,emailAddresses&pageSize=1000`,
      ),
    ]);
    const byEmail = new Map<string, Contact>();
    for (const c of [...toContacts(saved.connections), ...toContacts(other.otherContacts)]) {
      const key = c.email.toLowerCase();
      const existing = byEmail.get(key);
      if (!existing || (!existing.name && c.name)) byEmail.set(key, c);
    }
    return [...byEmail.values()];
  },
  staleTime: 10 * 60_000,
});

// --- mutations ---

function modifyMessage(
  id: string,
  labels: { addLabelIds?: string[]; removeLabelIds?: string[] },
) {
  return gmail<Message>(`/messages/${id}/modify`, {
    method: "POST",
    body: JSON.stringify(labels),
  });
}

export function archiveMessage(id: string) {
  return modifyMessage(id, { removeLabelIds: ["INBOX"] });
}

export function trashMessage(id: string) {
  return gmail<Message>(`/messages/${id}/trash`, { method: "POST" });
}

// Accounts authorized before the full-mail scope was adopted hold tokens that
// can modify but not delete; Google answers 403 ACCESS_TOKEN_SCOPE_INSUFFICIENT
// until the user re-consents. Translate that to an actionable message.
function withScopeHint(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.startsWith("Google API 403") &&
    /ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient/i.test(msg)
  ) {
    return new Error(
      "Google denied permanent deletion: this sign-in predates the delete permission. Sign out and sign in again to grant it.",
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

// Permanent removal — needs the full mail scope, not gmail.modify.
export async function deleteMessage(id: string) {
  try {
    await gmail<void>(`/messages/${id}`, { method: "DELETE" });
  } catch (err) {
    throw withScopeHint(err);
  }
}

export async function emptyTrash() {
  try {
    // batchDelete caps at 1000 ids; page until the trash listing runs dry.
    for (;;) {
      const page = await gmail<{ messages?: MessageRef[] }>(
        "/messages?labelIds=TRASH&maxResults=500",
      );
      const ids = (page.messages ?? []).map((m) => m.id);
      if (!ids.length) return;
      await gmail<void>("/messages/batchDelete", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    }
  } catch (err) {
    throw withScopeHint(err);
  }
}

export function markRead(id: string) {
  return modifyMessage(id, { removeLabelIds: ["UNREAD"] });
}

export function markUnread(id: string) {
  return modifyMessage(id, { addLabelIds: ["UNREAD"] });
}

// --- sending ---

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// RFC 2047 encoded-word for non-ASCII header values (e.g. Subject: åäö).
function encodeHeaderValue(value: string): string {
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${bytesToBase64(new TextEncoder().encode(value))}?=`;
}

export interface OutgoingMail {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string; // plain text version
  html?: string; // rich version; sent as multipart/alternative when present
  // Set for replies so Gmail threads the message correctly:
  threadId?: string;
  inReplyTo?: string; // original Message-ID
  references?: string; // original References + Message-ID
  labelIds?: string[]; // user labels applied to the sent message
}

function base64Content(content: string): string {
  return bytesToBase64(new TextEncoder().encode(content));
}

function mimePart(type: string, content: string): string {
  return (
    `Content-Type: ${type}; charset="UTF-8"\r\n` +
    "Content-Transfer-Encoding: base64\r\n\r\n" +
    base64Content(content)
  );
}

// CR/LF in a header value would let pasted input inject additional headers
// (e.g. a hidden Bcc) into the raw RFC 822 message.
function stripNewlines(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

// Reply drafts carry decoded display names ("Ann Öberg <a@b>"); re-encode any
// non-ASCII name so the outgoing To/Cc/Bcc headers stay 7-bit clean.
function encodeAddressList(raw: string): string {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (/^[\x20-\x7e]*$/.test(part)) return part;
      const match = part.match(/^"?(.*?)"?\s*(<[^>]+>)$/);
      if (!match || !match[1]) return part;
      return `${encodeHeaderValue(match[1])} ${match[2]}`;
    })
    .join(", ");
}

// Build an RFC 822 message and send it. Gmail fills in From/Date/Message-ID.
export async function sendMessage(msg: OutgoingMail) {
  const headers = [
    `To: ${encodeAddressList(stripNewlines(msg.to))}`,
    ...(msg.cc ? [`Cc: ${encodeAddressList(stripNewlines(msg.cc))}`] : []),
    ...(msg.bcc ? [`Bcc: ${encodeAddressList(stripNewlines(msg.bcc))}`] : []),
    `Subject: ${encodeHeaderValue(stripNewlines(msg.subject))}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${stripNewlines(msg.inReplyTo)}`] : []),
    ...(msg.references ? [`References: ${stripNewlines(msg.references)}`] : []),
    "MIME-Version: 1.0",
  ];

  let rfc822: string;
  if (msg.html) {
    const boundary = `b${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    rfc822 =
      headers.join("\r\n") +
      `\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n` +
      `--${boundary}\r\n${mimePart("text/plain", msg.body)}\r\n` +
      `--${boundary}\r\n${mimePart("text/html", msg.html)}\r\n` +
      `--${boundary}--`;
  } else {
    rfc822 = headers.join("\r\n") + "\r\n" + mimePart("text/plain", msg.body);
  }

  const raw = bytesToBase64(new TextEncoder().encode(rfc822))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const sent = await gmail<Message>("/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) }),
  });
  if (msg.labelIds?.length) {
    await modifyMessage(sent.id, { addLabelIds: msg.labelIds });
  }
  return sent;
}

// --- historyId delta sync ---
//
// Poll history.list with the last seen historyId and apply the delta to the
// LOCAL STORE (added messages fetched individually, deletions removed, label
// changes patched), then invalidate so open views re-read SQLite. Steady
// state costs one request per poll instead of re-listing whole folders.

interface HistoryMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
}

interface HistoryRecord {
  messagesAdded?: { message: HistoryMessage }[];
  messagesDeleted?: { message: HistoryMessage }[];
  labelsAdded?: { message: HistoryMessage; labelIds?: string[] }[];
  labelsRemoved?: { message: HistoryMessage; labelIds?: string[] }[];
}

interface HistoryResponse {
  historyId: string;
  history?: HistoryRecord[];
}

async function applyGmailHistory(records: HistoryRecord[]) {
  const added = new Set<string>();
  const deleted = new Set<string>();
  const labelOps: { id: string; add: string[]; remove: string[] }[] = [];
  for (const rec of records) {
    for (const a of rec.messagesAdded ?? []) added.add(a.message.id);
    for (const d of rec.messagesDeleted ?? []) {
      deleted.add(d.message.id);
      added.delete(d.message.id);
    }
    for (const l of rec.labelsAdded ?? [])
      labelOps.push({ id: l.message.id, add: l.labelIds ?? [], remove: [] });
    for (const l of rec.labelsRemoved ?? [])
      labelOps.push({ id: l.message.id, add: [], remove: l.labelIds ?? [] });
  }

  const newIds = [...added];
  if (newIds.length) {
    const [names, messages] = await Promise.all([
      labelNames(),
      Promise.all(
        newIds.map((id) =>
          gmail<Message>(
            `/messages/${id}?format=metadata` +
              `&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
          ).catch(() => null), // may already be gone again
        ),
      ),
    ]);
    const mails = messages
      .filter((m): m is Message => m !== null)
      .map((m) => toMail(m, names));
    if (mails.length) {
      await invoke("gmail_cache_upsert", {
        account_id: GMAIL_CACHE_ACCOUNT,
        messages: mails.map(mailToRow),
      });
      void prefetchBodies(mails);
    }
  }
  if (deleted.size) {
    await invoke("gmail_cache_delete", {
      account_id: GMAIL_CACHE_ACCOUNT,
      ids: [...deleted],
    });
  }
  for (const op of labelOps) {
    if (deleted.has(op.id) || added.has(op.id)) continue; // already final
    await applyGmailLabelChange(op.id, op.add, op.remove);
  }
}

export function useGmailSync(enabled = true, intervalMs = 30_000) {
  const queryClient = useQueryClient();
  const lastHistoryId = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    const tick = async () => {
      try {
        if (!lastHistoryId.current) {
          const profile = await gmail<Profile>("/profile");
          if (!cancelled) lastHistoryId.current = profile.historyId;
          return;
        }
        const delta = await gmail<HistoryResponse>(
          `/history?startHistoryId=${lastHistoryId.current}`,
        );
        if (cancelled) return;
        lastHistoryId.current = delta.historyId;
        if (delta.history?.length) {
          await applyGmailHistory(delta.history);
          queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
          queryClient.invalidateQueries({ queryKey: ["gmail", "counts"] });
        }
      } catch {
        // Expired/invalid historyId (Gmail keeps history ~1 week) — reseed,
        // force full folder resyncs, and refresh everything once.
        lastHistoryId.current = null;
        invalidateFolderSyncState();
        queryClient.invalidateQueries({ queryKey: ["gmail"] });
      }
    };

    const timer = setInterval(tick, intervalMs);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [queryClient, enabled, intervalMs]);
}
