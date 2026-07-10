import { invoke } from "@tauri-apps/api/core";

// Thin wrappers over the SQLite JSON cache (cache_kv). Cache failures are
// never surfaced — the network path is always authoritative.

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const json = await invoke<string | null>("cache_get_json", { key });
    return json ? (JSON.parse(json) as T) : null;
  } catch {
    return null;
  }
}

export function cachePut(key: string, value: unknown) {
  invoke("cache_put_json", { key, json: JSON.stringify(value) }).catch(
    () => {},
  );
}

export function cacheDeletePrefix(prefix: string) {
  return invoke("cache_delete_prefix", { prefix }).catch(() => {});
}
