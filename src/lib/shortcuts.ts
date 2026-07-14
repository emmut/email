// Single source of truth for the Gmail-style single-key shortcuts. Handlers
// bind the effective keys (defaults merged with the user's overrides from
// settings) and every UI surface (tooltips, command palette, shortcuts help,
// settings) renders the same values, so a binding and its label can never
// drift apart. Keys are shown exactly as typed.
export const DEFAULT_KEYS = {
  compose: "c",
  reply: "r",
  replyAll: "a",
  forward: "f",
  archive: "e",
  trash: "#",
  junk: "!",
  nextMessage: "j",
  prevMessage: "k",
  search: "/",
  markUnread: "u",
  markRead: "i",
  help: "?",
} as const;

export type ShortcutAction = keyof typeof DEFAULT_KEYS;

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  compose: "Compose",
  reply: "Reply",
  replyAll: "Reply all",
  forward: "Forward",
  archive: "Archive",
  trash: "Move to trash",
  junk: "Mark as junk / not junk",
  nextMessage: "Next message",
  prevMessage: "Previous message",
  search: "Search",
  markUnread: "Mark as unread",
  markRead: "Mark as read",
  help: "Shortcuts help",
};

export const SHORTCUT_ACTIONS = Object.keys(DEFAULT_KEYS) as ShortcutAction[];

// A binding must be a single typed character (KeyboardEvent.key), since the
// handler matches e.key of unmodified keydowns. Escape is reserved for
// "back to list".
export function isValidShortcutKey(key: string): boolean {
  return key.length === 1 && key !== " ";
}

// Actions whose configured key collides with another action's.
export function conflictingActions(
  keys: Record<ShortcutAction, string>,
): Set<ShortcutAction> {
  const byKey = new Map<string, ShortcutAction[]>();
  for (const action of SHORTCUT_ACTIONS) {
    byKey.set(keys[action], [...(byKey.get(keys[action]) ?? []), action]);
  }
  const conflicts = new Set<ShortcutAction>();
  for (const actions of byKey.values()) {
    if (actions.length > 1) actions.forEach((a) => conflicts.add(a));
  }
  return conflicts;
}
