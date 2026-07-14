import { invoke } from "@tauri-apps/api/core";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { DEFAULT_KEYS, type ShortcutAction } from "@/lib/shortcuts";

// App-wide settings, persisted in the durable settings table in accounts.db
// (the cache DB gets dropped on schema bumps, so it's no home for
// preferences). Every field has a default so a missing or partial stored
// blob — e.g. from an older version — always loads cleanly.

export interface AppSettings {
  // How often mail queries refetch in the background, in minutes. 0 = manual
  // refresh only.
  syncIntervalMinutes: number;
  // Ask before permanently deleting mail from Trash.
  confirmPermanentDelete: boolean;
  // Show a desktop notification when new mail arrives in the inbox.
  notificationsEnabled: boolean;
  // Per-action overrides of the default single-key shortcuts.
  shortcuts: Partial<Record<ShortcutAction, string>>;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Matches the pre-setting hardcoded 30s poll.
  syncIntervalMinutes: 0.5,
  confirmPermanentDelete: true,
  notificationsEnabled: true,
  shortcuts: {},
};

const SETTINGS_KEY = "settings:v1";

export function withDefaults(stored: Partial<AppSettings> | null): AppSettings {
  return { ...DEFAULT_SETTINGS, ...stored };
}

// The effective key for each shortcut action: user override, else default.
export function effectiveKeys(
  overrides: Partial<Record<ShortcutAction, string>>,
): Record<ShortcutAction, string> {
  return { ...DEFAULT_KEYS, ...overrides };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const json = await invoke<string | null>("settings_get", {
      key: SETTINGS_KEY,
    });
    return withDefaults(json ? JSON.parse(json) : null);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

// Unlike loads, save failures must surface — silently losing a saved
// preference would look like a bug.
export function saveSettings(settings: AppSettings): Promise<void> {
  return invoke("settings_set", {
    key: SETTINGS_KEY,
    json: JSON.stringify(settings),
  });
}

export const settingsQuery = queryOptions({
  queryKey: ["settings"],
  queryFn: loadSettings,
  staleTime: Infinity,
});

// Poll cadence in ms, or false when the user syncs manually.
export function syncIntervalMs(settings: AppSettings): number | false {
  return settings.syncIntervalMinutes > 0
    ? settings.syncIntervalMinutes * 60_000
    : false;
}

// The effective shortcut bindings — what handlers bind and labels render.
export function useKeys(): Record<ShortcutAction, string> {
  const { data } = useQuery(settingsQuery);
  return effectiveKeys((data ?? DEFAULT_SETTINGS).shortcuts);
}

export function useSettings() {
  const queryClient = useQueryClient();
  const { data } = useQuery(settingsQuery);
  const settings = data ?? DEFAULT_SETTINGS;

  const mutation = useMutation({
    mutationFn: async (patch: Partial<AppSettings>) => {
      const next = { ...(await loadSettings()), ...patch };
      await saveSettings(next);
      return next;
    },
    onSuccess: (next) => queryClient.setQueryData(settingsQuery.queryKey, next),
  });

  return {
    settings,
    update: (patch: Partial<AppSettings>) => mutation.mutateAsync(patch),
    isSaving: mutation.isPending,
    saveError: mutation.error,
  };
}
