import { describe, expect, it } from "vitest";

import {
  formatMailNotification,
  isUnreadInboxArrival,
  selectNewInboxMail,
} from "@/lib/notifications";
import type { Mail } from "@/components/mail/data";

function mail(over: Partial<Mail> = {}): Mail {
  return {
    id: "1",
    name: "Ada Lovelace",
    email: "ada@example.com",
    subject: "Hello",
    text: "snippet",
    date: "2026-07-14T00:00:00.000Z",
    read: false,
    labelIds: ["INBOX", "UNREAD"],
    labels: [],
    ...over,
  };
}

describe("isUnreadInboxArrival", () => {
  it("accepts an unread inbox message", () => {
    expect(isUnreadInboxArrival(mail())).toBe(true);
  });

  it("rejects a read message", () => {
    expect(isUnreadInboxArrival(mail({ read: true }))).toBe(false);
  });

  it("rejects a message that is not in the inbox", () => {
    expect(isUnreadInboxArrival(mail({ labelIds: ["SENT"] }))).toBe(false);
  });
});

describe("selectNewInboxMail", () => {
  it("returns unread mails not already seen", () => {
    const mails = [mail({ id: "a" }), mail({ id: "b" })];
    expect(selectNewInboxMail(mails, new Set(["a"]))).toEqual([mails[1]]);
  });

  it("ignores read mails even when unseen", () => {
    const mails = [mail({ id: "a", read: true })];
    expect(selectNewInboxMail(mails, new Set())).toEqual([]);
  });

  it("returns nothing when everything is already seen", () => {
    const mails = [mail({ id: "a" }), mail({ id: "b" })];
    expect(selectNewInboxMail(mails, new Set(["a", "b"]))).toEqual([]);
  });
});

describe("formatMailNotification", () => {
  it("is null for an empty batch", () => {
    expect(formatMailNotification([])).toBeNull();
  });

  it("shows sender and subject for a single mail", () => {
    expect(formatMailNotification([mail()])).toEqual({
      title: "Ada Lovelace",
      body: "Hello",
    });
  });

  it("falls back to the email when there is no name", () => {
    expect(formatMailNotification([mail({ name: "" })])).toEqual({
      title: "ada@example.com",
      body: "Hello",
    });
  });

  it("collapses a batch into a count with the first senders", () => {
    const mails = [
      mail({ id: "a", name: "Ada" }),
      mail({ id: "b", name: "Bea" }),
      mail({ id: "c", name: "Cid" }),
      mail({ id: "d", name: "Dot" }),
    ];
    expect(formatMailNotification(mails)).toEqual({
      title: "4 new messages",
      body: "Ada, Bea, Cid",
    });
  });
});
