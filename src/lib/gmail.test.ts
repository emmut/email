import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  deleteMessage,
  emptyTrash,
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
