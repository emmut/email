# Email

Personal desktop Gmail client for a single account — read, reply, and act on mail
without opening the browser. Personal use only.

## Stack

- **Tauri 2** — desktop shell, Rust backend, system webview
- **Vite 7 + React 19 + TypeScript**
- **TanStack Router** — file-based routing, pure SPA (not TanStack Start; Tauri has no server runtime)
- **TanStack Query** — all data fetching
- **shadcn/ui** — Tailwind v4, radix base, Nova preset (Lucide / Geist)
- **Gmail REST API** over OAuth2 + PKCE

## Architecture

- Frontend is a pure SPA; Vite builds static assets that Tauri loads from disk. No SSR.
- All Gmail HTTP is routed through the Tauri `http` plugin (avoids CORS), not webview `fetch`.
- OAuth tokens live in the OS keychain via a thin Rust command — never in webview storage.
- Sync is `historyId`-based delta, not full polling.

## Prerequisites

- Node 20+ and [pnpm](https://pnpm.io) (this project uses pnpm, not npm)
- Rust + Cargo (stable)
- macOS: Xcode command-line tools (for the system webview build)
- A Google Cloud OAuth client of type **Desktop app**, with the Gmail API enabled
  on the project and your account added as a test user (scope: `gmail.modify`)

## OAuth setup

Export the client credentials before running the app:

```bash
export GOOGLE_OAUTH_CLIENT_ID="....apps.googleusercontent.com"
export GOOGLE_OAUTH_CLIENT_SECRET="..."
```

Notes:

- Google requires the client secret in token requests even for PKCE Desktop-app
  clients; for installed apps it is not considered confidential.
- Sign-in opens the system browser and redirects back to an ephemeral
  `http://127.0.0.1:<port>` loopback listener.
- The refresh token is stored in the macOS keychain
  (`com.emiljansson.email` / `gmail-refresh-token`); the webview only ever sees
  short-lived access tokens via the `get_access_token` command.

## Install from CI / releases

CI builds (GitHub Actions artifacts and release dmgs) are not notarized — macOS
marks the downloaded app as "damaged". After copying it to Applications, clear
the quarantine flag:

```bash
xattr -cr /Applications/Email.app
```

Locally built apps don't need this (no quarantine attribute is set). This is a
first-install-only step: subsequent versions arrive through the in-app updater
(see *Updates* below), and Sparkle strips the quarantine flag when installing.

## Updates (macOS)

The macOS app updates itself with [Sparkle](https://sparkle-project.org):
Sparkle checks for updates in the background (daily) and there's a manual
*Email → Check for Updates…* menu item.

How the pieces fit together:

- `scripts/fetch-sparkle.sh` downloads `Sparkle.framework` into
  `src-tauri/frameworks/` (gitignored); `src-tauri/build.rs` runs it
  automatically when the framework is missing, links it, and sets the rpaths.
  `tauri.conf.json` embeds the framework in the bundle.
- `src-tauri/src/updater.rs` starts a `SPUStandardUpdaterController` at launch
  (skipped when not running from an `.app` bundle, i.e. `tauri dev`).
- `SUFeedURL` in `src-tauri/Info.plist` points at
  `releases/latest/download/appcast.xml`; CI generates and attaches
  `appcast.xml` to every `v*` release (`scripts/generate-appcast.sh`), signing
  the dmg with EdDSA (`scripts/sign_update.py`). The EdDSA signature is what
  lets Sparkle install updates without a Developer ID / notarization.

One-time setup for a fork (or to rotate keys):

```bash
python3 scripts/generate-sparkle-keys.py
```

Put the printed public key in `src-tauri/Info.plist` under `SUPublicEDKey`,
and store the private key as the `SPARKLE_ED_PRIVATE_KEY` GitHub Actions
secret (never commit it). If the secret is missing, release builds still work
— CI just skips the appcast and in-app updates won't see that release.

## Updates (Arch Linux)

CI publishes each release's pacman package, together with a repo database, to
the rolling [`arch-repo`](https://github.com/emmut/email/releases/tag/arch-repo)
GitHub release, making it a personal pacman repository: updates arrive with
regular system updates (`pacman -Syu`), no AUR helper or manual download.

One-time setup — add to `/etc/pacman.conf`:

```ini
[email]
SigLevel = Optional TrustAll
Server = https://github.com/emmut/email/releases/download/arch-repo
```

Then install with `sudo pacman -Sy email`.

Notes:

- Packages are unsigned (`SigLevel = Optional TrustAll`); acceptable for a
  personal single-package repo fetched over HTTPS from this project's own
  releases.
- The database only lists the newest version; older `.pkg.tar.zst` files stay
  attached to the `arch-repo` release for manual downgrades
  (`pacman -U <file>`).
- `arch-repo` is marked as a prerelease on purpose — GitHub's
  `releases/latest` must keep pointing at the newest `v*` release because the
  Sparkle appcast URL depends on it.

## Develop

```bash
pnpm install
pnpm tauri dev        # launches the desktop app with HMR
```

Frontend-only (browser, no Tauri APIs):

```bash
pnpm dev              # http://localhost:1420
```

Build:

```bash
pnpm build            # tsc + vite build  -> dist/
pnpm tauri build      # bundles the desktop app
```

## Project layout

```
src/
  routes/             TanStack Router file-based routes (/, ...)
  components/
    mail/             inbox layout: mail-sidebar, mail-list, mail-display, mail (+ mock data.ts)
    ui/               shadcn primitives
  hooks/              use-mobile (shadcn sidebar)
  lib/                utils (cn)
  main.tsx            QueryClientProvider + RouterProvider
  routeTree.gen.ts    generated by the router plugin (committed; tsc needs it before vite)
src-tauri/            Rust backend, Tauri config, capabilities
```

## shadcn components

Components are managed through the shadcn MCP server (configured in `.mcp.json`).
CLI fallback:

```bash
pnpm dlx shadcn@latest add <component>
```

Note: the shadcn "Mail" layout on shadcn.com is a Next.js *example*, not a registry
block — the inbox here is composed from primitives plus the installable `sidebar-07` block.

## Status

- **Phase 0 — scaffold + mock inbox UI:** done.
- **Phase 1 — OAuth2 + PKCE, keychain token storage:** implemented (`src-tauri/src/oauth.rs`,
  sign-in gate on `/`, sign-out in the sidebar account menu). Needs an end-to-end test
  against a real Google Cloud "Desktop app" OAuth client — see *OAuth setup* above.
- **Phase 2 — read mail**, **Phase 3 — send/reply/act**, **Phase 4 — delta sync:** planned.
