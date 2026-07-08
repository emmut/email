import { invoke } from "@tauri-apps/api/core";
import { queryOptions } from "@tanstack/react-query";

// `pnpm dev` in a plain browser has no Tauri backend — pretend we're signed in
// so the mock inbox stays reachable.
const inTauri = "__TAURI_INTERNALS__" in window;

export const authStatusQuery = queryOptions({
  queryKey: ["auth", "status"],
  queryFn: () => (inTauri ? invoke<boolean>("auth_status") : Promise.resolve(true)),
  staleTime: Infinity,
});

export function signIn(): Promise<void> {
  return invoke("sign_in");
}

export function signOut(): Promise<void> {
  return invoke("sign_out");
}

export function getAccessToken(): Promise<string> {
  return invoke("get_access_token");
}
