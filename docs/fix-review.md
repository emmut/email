# Fix Review — Email link bridge (Flatpak + CSP)

**Base:** `main` at `2fe57e9`
**Reviewed changes:** `fix/email-click-links`
**Date:** 2026-09-13
**Status:** implementation complete; Flatpak runtime verification remains

## Outcome

The diagnostic link bridge is now internally complete and buildable. It:

- accepts messages from the email iframe when WebKitGTK reports its sandboxed
  `srcdoc` origin as `"null"`;
- announces that the inline bridge ran, then reports successful and failed link
  opens in the message view;
- changes from `waiting` to `blocked` after four seconds if the bridge never
  starts, and resets when the selected message changes;
- validates every requested URL through `externalEmailLink` before opening it;
- allow-lists the exact inline bridge bytes in the production CSP.

The implementation is ready for a diagnostic Flatpak build. This review cannot
prove the desktop runtime path without installing that build and clicking a link.

## Resolved findings

### CSP hash mismatch

Resolved. `emailLinkBridgeScriptHash` and
`src-tauri/tauri.conf.json` now both contain:

```text
sha256-yR/xwaRUKfoLGTB43bTLAPHgESOqNe7bSi1UCMcrGso=
```

The test hashes the script extracted from `emailSrcDoc` and checks both values,
so future bridge edits cannot silently leave the release CSP stale.

The hash is still required. Production CSP does not permit arbitrary inline
scripts, and WebKit builds that apply it to `srcdoc` will otherwise block the
bridge. Using a hash preserves the restrictive policy instead of adding
`'unsafe-inline'`.

### Missing error handling helper

Resolved. Unknown opener failures are converted to readable messages by the
shared `errMessage` helper. Async results update diagnostics only if they still
belong to the most recently clicked link, preventing stale requests from
overwriting newer status.

### Incomplete diagnostics

Resolved. All diagnostic states are reachable and rendered:

- `waiting` while the iframe bridge starts;
- `blocked` after four seconds without a ready message;
- `ready` before interaction and `opened` with the latest URL;
- opener failures with the URL and error text.

The status row and iframe share a column flex layout, so the diagnostic does not
overflow or obscure the email body.

### Inline bridge complexity

Resolved. The mutable generic `post` helper was removed. The bridge now posts
the two explicit message shapes directly. Bridge construction, its message
protocol, URL validation, CSP hash, and iframe document wrapper now live in the
focused `email-link-bridge.ts` module. `MailDisplay` only consumes parsed bridge
messages and does not depend on the wire-format strings.

## Review axes

### Standards

No documented-standard violations remain. The repository README defines the
architecture and toolchain but no additional applicable style rules. The earlier
speculative-state concern is resolved because every state is now reached and
rendered; no unused diagnostic branches remain.

### Spec

All implementation requirements in the original review are complete. No scope
creep was found. The relaxed `"null"`-origin behavior and duplicate ready
announcement are intentional WebKitGTK compatibility measures described by the
fix.

## Security notes

The listener accepts `"null"`-origin messages because WebKitGTK can provide an
unreliable `event.source` for a sandboxed `srcdoc` iframe. This is deliberately
limited to the two bridge message types. Link-opening messages are additionally
restricted to valid `http`, `https`, `mailto`, and `tel` URLs.

Do not broaden either the accepted message types or URL protocols.

## Verification

- `pnpm exec tsc --noEmit` — passed
- `pnpm exec vitest run src/components/mail/mail-display.test.ts` — 15 passed
- `pnpm test` — 20 files, 174 Vitest tests and 1 Node test passed
- `pnpm build` — passed
- `git diff --check` — passed

Vite still reports the repository's existing large-chunk advisory during the
production build; it is unrelated to this fix.

## Runtime acceptance check

Install the next Flatpak diagnostic build and open an HTML email:

1. `Link bridge ready` means CSP and iframe messaging work.
2. Clicking a link should change the status to `Opened <url>` and launch the
   system handler.
3. `Link bridge not running` points to CSP or iframe-script execution.
4. `Open failed` points to the Tauri opener or the Flatpak OpenURI portal.

Summary: Standards — 0 findings. Spec — 0 outstanding implementation findings;
desktop runtime verification is the only remaining acceptance step.
