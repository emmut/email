import { useEffect, useRef } from "react";

import type { Mail } from "@/components/mail/data";
import { loadSettings } from "@/lib/settings";

// Desktop "new mail" notifications. The pure selection/formatting helpers are
// exported for unit testing; notifyNewMail is the side-effecting shell that
// checks the user setting, the window focus, and the OS permission before
// handing off to the Tauri notification plugin.

// A Gmail history delta reports every added message regardless of folder; only
// unread arrivals still sitting in the inbox are worth announcing.
export function isUnreadInboxArrival(m: Mail): boolean {
  return !m.read && m.labelIds.includes("INBOX");
}

// The unread inbox mails that weren't in the previous snapshot — used to turn a
// polled iCloud inbox listing into "what just arrived". labelIds is empty for
// iCloud, so membership is the caller's responsibility (it passes the inbox).
export function selectNewInboxMail(
  mails: Mail[],
  seen: ReadonlySet<string>,
): Mail[] {
  return mails.filter((m) => !m.read && !seen.has(m.id));
}

// One mail reads as sender + subject; a batch collapses to a count so a burst
// of arrivals is a single unobtrusive notification, not a stack of them.
export function formatMailNotification(mails: Mail[]): {
  title: string;
  body: string;
} | null {
  if (mails.length === 0) return null;
  if (mails.length === 1) {
    const [m] = mails;
    return { title: m.name || m.email, body: m.subject };
  }
  return {
    title: `${mails.length} new messages`,
    body: mails
      .slice(0, 3)
      .map((m) => m.name || m.email)
      .join(", "),
  };
}

// Cached across calls: the OS only needs to be asked once per session.
let permissionGranted: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  const { isPermissionGranted, requestPermission } = await import(
    "@tauri-apps/plugin-notification"
  );
  if (permissionGranted === null) {
    permissionGranted = await isPermissionGranted();
    if (!permissionGranted) {
      permissionGranted = (await requestPermission()) === "granted";
    }
  }
  return permissionGranted;
}

// Announce the given (already inbox-filtered) mails, unless the user disabled
// notifications or the app window is focused — mail you can already see needs
// no alert. Never throws: a failed notification must not break syncing.
export async function notifyNewMail(mails: Mail[]): Promise<void> {
  const content = formatMailNotification(mails);
  if (!content) return;
  try {
    const settings = await loadSettings();
    if (!settings.notificationsEnabled) return;

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    if (await getCurrentWindow().isFocused()) return;

    if (!(await ensurePermission())) return;

    const { sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    );
    sendNotification(content);
  } catch {
    // Notifications are best-effort; ignore plugin/permission failures.
  }
}

// iCloud has no push/delta channel, so new-mail detection is a diff of the
// polled inbox listing against the previous snapshot. The first populated
// snapshot (and any change of `key`, e.g. switching account) is adopted as the
// baseline silently — only mail that appears afterwards is announced. Passing
// `undefined` (inbox not in view) resets the baseline so returning to it later
// re-seeds rather than announcing the backlog.
export function useNewMailNotifications(
  key: string,
  mails: Mail[] | undefined,
) {
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    seen.current = null;
  }, [key]);

  useEffect(() => {
    if (!mails) {
      seen.current = null;
      return;
    }
    if (seen.current === null) {
      seen.current = new Set(mails.map((m) => m.id));
      return;
    }
    const fresh = selectNewInboxMail(mails, seen.current);
    for (const m of mails) seen.current.add(m.id);
    if (fresh.length) void notifyNewMail(fresh);
  }, [mails]);
}
