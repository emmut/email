import { describe, expect, it } from "vitest";

import { isNetworkError } from "@/lib/offline";

describe("isNetworkError", () => {
  it("treats HTTP responses from Google as non-network errors", () => {
    expect(isNetworkError(new Error("Google API 500: boom"))).toBe(false);
    expect(isNetworkError(new Error("Google API 403: forbidden"))).toBe(false);
  });

  it("recognizes transport-level failures", () => {
    expect(
      isNetworkError(new Error("error sending request to https://x")),
    ).toBe(true);
    expect(isNetworkError(new Error("Connection refused"))).toBe(true);
    expect(isNetworkError(new Error("request timed out"))).toBe(true);
    expect(isNetworkError("dns lookup failed")).toBe(true);
  });

  it("treats other errors as application errors", () => {
    expect(isNetworkError(new Error("select folder failed: NO"))).toBe(false);
  });
});
