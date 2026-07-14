import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export const isMac = navigator.platform.startsWith("Mac")

// Locale-aware name ordering for folders/tags, following the language the
// user's system reports to the webview.
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, navigator.language, { sensitivity: "base" })
}

// "emil.jansson@x" → "EJ"
export function initialsFromEmail(email: string) {
  return email
    .split("@")[0]
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
