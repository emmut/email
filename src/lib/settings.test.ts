import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  effectiveKeys,
  syncIntervalMs,
  withDefaults,
} from "@/lib/settings";
import {
  conflictingActions,
  DEFAULT_KEYS,
  isValidShortcutKey,
} from "@/lib/shortcuts";

describe("withDefaults", () => {
  it("fills every field when nothing is stored", () => {
    expect(withDefaults(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps stored values and defaults the rest", () => {
    const merged = withDefaults({ syncIntervalMinutes: 15 });
    expect(merged.syncIntervalMinutes).toBe(15);
    expect(merged.confirmPermanentDelete).toBe(true);
    expect(merged.shortcuts).toEqual({});
  });
});

describe("effectiveKeys", () => {
  it("returns defaults without overrides", () => {
    expect(effectiveKeys({})).toEqual(DEFAULT_KEYS);
  });

  it("applies overrides on top of defaults", () => {
    const keys = effectiveKeys({ compose: "n" });
    expect(keys.compose).toBe("n");
    expect(keys.reply).toBe(DEFAULT_KEYS.reply);
  });
});

describe("syncIntervalMs", () => {
  it("converts minutes to milliseconds", () => {
    expect(syncIntervalMs(withDefaults({ syncIntervalMinutes: 0.5 }))).toBe(
      30_000,
    );
    expect(syncIntervalMs(withDefaults({ syncIntervalMinutes: 5 }))).toBe(
      300_000,
    );
  });

  it("is false for manual sync (0)", () => {
    expect(syncIntervalMs(withDefaults({ syncIntervalMinutes: 0 }))).toBe(
      false,
    );
  });
});

describe("isValidShortcutKey", () => {
  it("accepts single printable characters", () => {
    expect(isValidShortcutKey("c")).toBe(true);
    expect(isValidShortcutKey("#")).toBe(true);
    expect(isValidShortcutKey("?")).toBe(true);
  });

  it("rejects named keys, space and empty", () => {
    expect(isValidShortcutKey("Enter")).toBe(false);
    expect(isValidShortcutKey("Escape")).toBe(false);
    expect(isValidShortcutKey(" ")).toBe(false);
    expect(isValidShortcutKey("")).toBe(false);
  });
});

describe("conflictingActions", () => {
  it("is empty for the defaults", () => {
    expect(conflictingActions(effectiveKeys({})).size).toBe(0);
  });

  it("flags every action sharing a key", () => {
    const conflicts = conflictingActions(effectiveKeys({ compose: "r" }));
    expect(conflicts).toEqual(new Set(["compose", "reply"]));
  });
});
