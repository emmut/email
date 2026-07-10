import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";
import type { Mail } from "@/components/mail/data";

export interface IcloudFolder {
  name: string;
  delimiter: string;
  attributes: string[];
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
  subject: string;
  body_text: string;
  body_html: string | null;
  date: string | null;
  flags: string[];
  folder: string;
}

export interface IcloudMailBody {
  html: string | null;
  text: string;
  threadId: string;
  subject: string;
  from: string;
  replyTo: string;
  to: string;
  cc: string;
  messageId: string;
  references: string;
  date: string;
}

// --- queries ---

export function icloudFoldersQuery(accountId: string) {
  return queryOptions({
    queryKey: ["icloud", accountId, "folders"],
    queryFn: () => invoke<IcloudFolder[]>("icloud_list_folders", { account_id: accountId }),
    enabled: !!accountId,
    staleTime: 5 * 60_000,
  });
}

export function icloudMessagesQuery(accountId: string, folder: string, limit?: number) {
  return queryOptions({
    queryKey: ["icloud", accountId, "messages", folder, limit],
    queryFn: () =>
      invoke<IcloudMessageSummary[]>("icloud_list_messages", {
        account_id: accountId,
        folder,
        limit: limit ?? 50,
      }),
    enabled: !!accountId && !!folder,
    staleTime: 30_000,
  });
}

export function icloudMessageBodyQuery(accountId: string, folder: string, uid: number) {
  return queryOptions({
    queryKey: ["icloud", accountId, "message", folder, uid],
    queryFn: async (): Promise<IcloudMailBody> => {
      const detail = await invoke<IcloudMessageDetail>("icloud_fetch_message", {
        account_id: accountId,
        folder,
        uid,
      });
      const from = detail.from_name
        ? `${detail.from_name} <${detail.from_email}>`
        : detail.from_email;
      return {
        html: detail.body_html,
        text: detail.body_text,
        threadId: detail.message_id,
        subject: detail.subject,
        from,
        replyTo: from,
        to: detail.to,
        cc: detail.cc ?? "",
        messageId: detail.message_id,
        references: "",
        date: detail.date ?? "",
      };
    },
    enabled: !!accountId && !!folder && uid > 0,
    staleTime: Infinity,
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

// --- adapters to Mail view-model ---

export function toMail(msg: IcloudMessageSummary): Mail {
  return {
    id: `icloud:${msg.uid}`,
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

export function toMailBody(body: IcloudMailBody) {
  return body;
}
