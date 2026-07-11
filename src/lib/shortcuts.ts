// Single source of truth for the Gmail-style single-key shortcuts. The key
// handlers bind these constants and every UI surface (tooltips, command
// palette, shortcuts help) renders the same constant, so a binding and its
// label can never drift apart. Keys are shown exactly as typed.
export const KEYS = {
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
