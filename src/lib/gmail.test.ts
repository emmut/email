import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildRfc822,
  deleteMessage,
  emptyTrash,
  junkMessage,
  notJunkMessage,
  saveDraft,
  tagFolderId,
  tagIdFromFolder,
} from "@/lib/gmail";
import { fetch } from "@tauri-apps/plugin-http";

vi.mock("@/lib/auth", () => ({
  getAccessToken: vi.fn(async () => "test-token"),
}));

vi.mock("@tauri-apps/plugin-http", () => ({
  fetch: vi.fn(),
}));

const mockFetch = vi.mocked(fetch);

function respond(status: number, body = "") {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("tag folder ids", () => {
  it("round-trips a label id", () => {
    const id = tagFolderId("Label_42");
    expect(id).toBe("tag:Label_42");
    expect(tagIdFromFolder(id)).toBe("Label_42");
  });

  it("returns null for non-tag folders", () => {
    expect(tagIdFromFolder("inbox")).toBeNull();
    expect(tagIdFromFolder("trash")).toBeNull();
  });
});

describe("deleteMessage", () => {
  it("issues DELETE on the message resource", async () => {
    mockFetch.mockResolvedValue(respond(204));
    await deleteMessage("m1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/messages/m1");
    expect(init?.method).toBe("DELETE");
  });

  it("explains the insufficient-scope 403 from pre-upgrade sign-ins", async () => {
    mockFetch.mockResolvedValue(
      respond(403, '{"error":{"status":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"}}'),
    );
    await expect(deleteMessage("m1")).rejects.toThrow(/sign in again/i);
  });

  it("passes other errors through untouched", async () => {
    mockFetch.mockResolvedValue(respond(404, "not found"));
    await expect(deleteMessage("m1")).rejects.toThrow("Google API 404");
  });
});

describe("junk actions", () => {
  it("marks as junk by swapping INBOX for SPAM", async () => {
    mockFetch.mockResolvedValue(respond(200, "{}"));
    await junkMessage("m1");
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/messages/m1/modify");
    expect(JSON.parse(String(init?.body))).toEqual({
      addLabelIds: ["SPAM"],
      removeLabelIds: ["INBOX"],
    });
  });

  it("marks as not junk by swapping SPAM for INBOX", async () => {
    mockFetch.mockResolvedValue(respond(200, "{}"));
    await notJunkMessage("m1");
    const [, init] = mockFetch.mock.calls[0];
    expect(JSON.parse(String(init?.body))).toEqual({
      addLabelIds: ["INBOX"],
      removeLabelIds: ["SPAM"],
    });
  });
});

describe("buildRfc822", () => {
  it("omits To when there is no recipient yet and adds From/Date when given", () => {
    const mime = buildRfc822(
      { to: "", subject: "WIP", body: "hello" },
      "me@icloud.com",
    );
    expect(mime).toContain("From: me@icloud.com");
    expect(mime).toContain("Date: ");
    expect(mime).not.toContain("To:");
    expect(mime).toContain("Subject: WIP");
  });

  it("leaves From/Date to the server when no sender is given", () => {
    const mime = buildRfc822({ to: "a@b.com", subject: "Hi", body: "x" });
    expect(mime).toContain("To: a@b.com");
    expect(mime).not.toContain("From:");
    expect(mime).not.toContain("Date:");
  });
});

describe("saveDraft", () => {
  it("POSTs the raw message to the drafts collection", async () => {
    mockFetch.mockResolvedValue(respond(200, '{"id":"d1"}'));
    await saveDraft({ to: "a@b.com", subject: "Hi", body: "x" });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/drafts");
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body));
    expect(body.message.raw).toBeTruthy();
    expect(body.message.raw).not.toMatch(/[+/=]/); // base64url
  });

  it("threads a reply draft", async () => {
    mockFetch.mockResolvedValue(respond(200, '{"id":"d1"}'));
    await saveDraft({ to: "a@b.com", subject: "Re: x", body: "y", threadId: "t1" });
    const body = JSON.parse(String(mockFetch.mock.calls[0][1]?.body));
    expect(body.message.threadId).toBe("t1");
  });
});

describe("emptyTrash", () => {
  it("batch-deletes pages of trash until it runs dry", async () => {
    mockFetch
      .mockResolvedValueOnce(
        respond(200, JSON.stringify({ messages: [{ id: "a" }, { id: "b" }] })),
      )
      .mockResolvedValueOnce(respond(204))
      .mockResolvedValueOnce(respond(200, "{}"));
    await emptyTrash();

    expect(mockFetch).toHaveBeenCalledTimes(3);
    const [batchUrl, batchInit] = mockFetch.mock.calls[1];
    expect(String(batchUrl)).toContain("/messages/batchDelete");
    expect(JSON.parse(String(batchInit?.body))).toEqual({ ids: ["a", "b"] });
  });

  it("does nothing when trash is already empty", async () => {
    mockFetch.mockResolvedValue(respond(200, "{}"));
    await emptyTrash();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
