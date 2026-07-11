import { describe, expect, it } from "vitest";

import {
  ICLOUD_FOLDER_NAMES,
  icloudCustomFolderId,
  icloudFolderName,
  icloudMailboxFromFolder,
  icloudMailId,
  parseIcloudMailId,
  toMail,
} from "@/lib/icloud";
import { icloudSummary } from "@/test/fixtures";

describe("icloud mail ids", () => {
  it("round-trips folder and uid", () => {
    const id = icloudMailId("INBOX", 42);
    expect(id).toBe("icloud:INBOX:42");
    expect(parseIcloudMailId(id)).toEqual({ folder: "INBOX", uid: 42 });
  });

  it("keeps colons inside folder names (uid after the last colon)", () => {
    expect(parseIcloudMailId("icloud:Work:2024:7")).toEqual({
      folder: "Work:2024",
      uid: 7,
    });
  });

  it("returns null for non-iCloud ids", () => {
    expect(parseIcloudMailId("18c2f0a")).toBeNull();
  });

  it("returns null for malformed ids", () => {
    expect(parseIcloudMailId("icloud:no-uid")).toBeNull();
    expect(parseIcloudMailId("icloud:INBOX:not-a-number")).toBeNull();
  });
});

describe("folder id mapping", () => {
  it("maps sidebar ids to IMAP mailbox names", () => {
    expect(icloudFolderName("inbox")).toBe("INBOX");
    expect(icloudFolderName("trash")).toBe("Deleted Messages");
    expect(icloudFolderName("sent")).toBe("Sent Messages");
  });

  it("falls back to INBOX for unknown ids", () => {
    expect(icloudFolderName("bogus")).toBe(ICLOUD_FOLDER_NAMES.inbox);
  });

  it("round-trips custom folder ids", () => {
    const id = icloudCustomFolderId("Kvitton åäö");
    expect(icloudMailboxFromFolder(id)).toBe("Kvitton åäö");
    expect(icloudFolderName(id)).toBe("Kvitton åäö");
  });

  it("standard folder ids are not custom", () => {
    expect(icloudMailboxFromFolder("inbox")).toBeNull();
  });
});

describe("toMail", () => {
  it("maps a summary to the Mail view-model", () => {
    expect(toMail(icloudSummary())).toEqual({
      id: "icloud:INBOX:42",
      name: "Alice",
      email: "alice@example.com",
      subject: "Lunch plans",
      text: "Are you free tomorrow?",
      date: "2026-07-10T10:00:00.000Z",
      read: false,
      labelIds: [],
      labels: [],
    });
  });

  it("falls back to the address local part when the sender has no name", () => {
    expect(toMail(icloudSummary({ from_name: null })).name).toBe("alice");
  });

  it("fills placeholders for empty subject and missing date", () => {
    const m = toMail(icloudSummary({ subject: "", date: null }));
    expect(m.subject).toBe("(no subject)");
    expect(Date.parse(m.date)).not.toBeNaN();
  });
});
