import { describe, expect, it } from "vitest";

import { cn, compareNames } from "@/lib/utils";

describe("cn", () => {
  it("merges conflicting tailwind classes, last one wins", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
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
