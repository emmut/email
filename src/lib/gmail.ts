import { useEffect, useRef } from "react";
import DOMPurify from "dompurify";
import { fetch } from "@tauri-apps/plugin-http";
import {
  queryOptions,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { getAccessToken } from "@/lib/auth";
import { cacheDeletePrefix, cacheGet, cachePut } from "@/lib/cache";
import type { Mail } from "@/components/mail/data";

export function clearGmailCache() {
  return cacheDeletePrefix("gmail:");
}

// Write the current in-memory folder listings through to SQLite — used after
// offline optimistic updates so a restart shows the same state.
export function persistGmailListCaches(queryClient: QueryClient) {
  const lists = queryClient.getQueriesData<Mail[]>({
    queryKey: ["gmail", "list"],
  });
  for (const [key, data] of lists) {
    if (key.length === 4 && key[3] === "" && data) {
      cachePut(`gmail:list:${key[2] as string}`, data);
    }
  }
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

function header(msg: Message, name: string): string {
  return (
    msg.payload?.headers?.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    )?.value ?? ""
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
      .sort((a, b) => a.name.localeCompare(b.name));
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

export function mailListQuery(folder: string, search: string) {
  return queryOptions({
    queryKey: ["gmail", "list", folder, search],
    queryFn: async (): Promise<Mail[]> => {
      const tagId = tagIdFromFolder(folder);
      let params = tagId
        ? `labelIds=${encodeURIComponent(tagId)}`
        : (FOLDER_PARAMS[folder] ?? FOLDER_PARAMS.inbox);
      if (search) {
        const q = params.startsWith("q=")
          ? `${decodeURIComponent(params.slice(2))} ${search}`
          : search;
        params = params.startsWith("q=")
          ? `q=${encodeURIComponent(q)}`
          : `${params}&q=${encodeURIComponent(q)}`;
      }
      const list = await gmail<{ messages?: MessageRef[] }>(
        `/messages?maxResults=50&${params}`,
      );
      let result: Mail[] = [];
      if (list.messages?.length) {
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
        result = messages.map((m) => toMail(m, names));
      }
      // Persist plain folder listings (not ad-hoc searches) for instant startup.
      if (!search) {
        cachePut(`gmail:list:${folder}`, result);
        // Fire-and-forget: warm the body cache for the newest messages so
        // they're readable offline without ever having been opened.
        void prefetchBodies(result.slice(0, 10));
      }
      return result;
    },
    staleTime: 30_000,
  });
}

async function prefetchBodies(mails: Mail[]) {
  for (const mail of mails) {
    try {
      if (await cacheGet<MailBody>(`gmail:body:${mail.id}`)) continue;
      await fetchMailBody(mail.id); // caches as a side effect
    } catch {
      return; // network gone — stop quietly
    }
  }
}

// Cache-only folder listing (null on cache miss) — painted while the network
// listing above is in flight.
export function gmailCachedListQuery(folder: string) {
  return queryOptions({
    queryKey: ["gmail", "list", folder, "@cache"],
    queryFn: () => cacheGet<Mail[]>(`gmail:list:${folder}`),
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
      .map((email) => ({ name, email }));
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

// Build an RFC 822 message and send it. Gmail fills in From/Date/Message-ID.
export async function sendMessage(msg: OutgoingMail) {
  const headers = [
    `To: ${msg.to}`,
    ...(msg.cc ? [`Cc: ${msg.cc}`] : []),
    ...(msg.bcc ? [`Bcc: ${msg.bcc}`] : []),
    `Subject: ${encodeHeaderValue(msg.subject)}`,
    ...(msg.inReplyTo ? [`In-Reply-To: ${msg.inReplyTo}`] : []),
    ...(msg.references ? [`References: ${msg.references}`] : []),
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
// Poll history.list with the last seen historyId; on any change, invalidate
// gmail queries so open views refetch. Far cheaper than re-listing folders.

interface HistoryResponse {
  historyId: string;
  history?: unknown[];
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
          queryClient.invalidateQueries({ queryKey: ["gmail", "list"] });
          queryClient.invalidateQueries({ queryKey: ["gmail", "counts"] });
        }
      } catch {
        // Expired/invalid historyId (Gmail keeps history ~1 week) — reseed
        // from the profile and refresh everything once.
        lastHistoryId.current = null;
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
