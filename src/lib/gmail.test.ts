import { describe, expect, it } from "vitest";

import { tagFolderId, tagIdFromFolder } from "@/lib/gmail";

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
