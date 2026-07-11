import type { Mail } from "@/components/mail/data";
import type { MailBody } from "@/lib/gmail";
import type { IcloudMessageSummary } from "@/lib/icloud";

export function mail(overrides: Partial<Mail> = {}): Mail {
  return {
    id: "m1",
    name: "Alice",
    email: "alice@example.com",
    subject: "Lunch plans",
    text: "Are you free tomorrow?",
    date: "2026-07-10T10:00:00.000Z",
    read: false,
    labelIds: [],
    labels: [],
    ...overrides,
  };
}

export function mailBody(overrides: Partial<MailBody> = {}): MailBody {
  return {
    html: null,
    text: "Hello there\nSecond line",
    threadId: "t1",
    subject: "Lunch plans",
    from: "Alice <alice@example.com>",
    replyTo: "Alice <alice@example.com>",
    to: "Bob <bob@example.com>, Carol <carol@example.com>",
    cc: "Dave <dave@example.com>",
    messageId: "<msg-1@example.com>",
    references: "<msg-0@example.com>",
    date: "Mon, 1 Jan 2024 10:00:00 +0100",
    ...overrides,
  };
}

export function icloudSummary(
  overrides: Partial<IcloudMessageSummary> = {},
): IcloudMessageSummary {
  return {
    uid: 42,
    message_id: "<msg-1@example.com>",
    from_name: "Alice",
    from_email: "alice@example.com",
    to: "bob@example.com",
    subject: "Lunch plans",
    snippet: "Are you free tomorrow?",
    date: "2026-07-10T10:00:00.000Z",
    flags: [],
    folder: "INBOX",
    read: false,
    ...overrides,
  };
}
