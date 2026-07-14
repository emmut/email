import { describe, expect, it } from "vitest";

import { cn, compareNames, nextSelectedId } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});

describe("nextSelectedId", () => {
  const ids = ["a", "b", "c"];

  it("advances to the mail after the removed one", () => {
    expect(nextSelectedId(ids, "b")).toBe("c");
  });

  it("falls back to the previous mail at the end of the list", () => {
    expect(nextSelectedId(ids, "c")).toBe("b");
  });

  it("returns null when the removed mail was the only one", () => {
    expect(nextSelectedId(["a"], "a")).toBeNull();
  });

  it("returns null when the removed mail is not in the list", () => {
    expect(nextSelectedId(ids, "x")).toBeNull();
  });
});

describe("compareNames", () => {
  it("orders alphabetically", () => {
    expect(compareNames("Apple", "Banana")).toBeLessThan(0);
    expect(compareNames("Banana", "Apple")).toBeGreaterThan(0);
  });

  it("ignores case (base sensitivity)", () => {
    expect(compareNames("apple", "Apple")).toBe(0);
  });

  it("sorts a list deterministically", () => {
    const names = ["Work", "archive-old", "Receipts", "budget"];
    expect([...names].sort(compareNames)).toEqual([
      "archive-old",
      "budget",
      "Receipts",
      "Work",
    ]);
  });
});
