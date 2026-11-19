# Development conventions

TypeScript and TSX follow [emmut/movies](https://github.com/emmut/movies), especially
its [conventions](https://github.com/emmut/movies/blob/main/CONTRIBUTING.md#conventions):

- Use named functions for declarations; keep arrows for inline callbacks.
- Put braces around every conditional body.
- Use kebab-case filenames and `@/` imports for internal modules.
- Keep modules cohesive, validate external input at boundaries, and use explicit
  control flow instead of nested ternaries or dense expressions.
- Share provider-independent logic; keep provider protocols in their adapters.

Use the Node versions declared in `package.json` and the pinned pnpm version.
Run `pnpm format`, `pnpm format:check`, `pnpm test`, and `pnpm build`.
The router generates `src/routeTree.gen.ts`; do not edit or format it manually.
For Rust, run `cargo test --locked --manifest-path src-tauri/Cargo.toml` on a
machine with the Tauri Linux development libraries (see the shared CI setup).
Use `pnpm audit` and `cargo audit --file src-tauri/Cargo.lock` for advisory checks.

Keep all TipTap packages on the same version when upgrading them. Credential
migration must preserve the existing credential if the keychain cannot save it.
Email HTML must pass through the shared sanitizer, including cached HTML at the
rendering boundary. Keep the inline email bridge's SHA-256 and production CSP
synchronized; its regression test verifies this.

The shadcn 4.11.0 Tailwind variants live in `src/styles/shadcn.css` with their
upstream license, so building does not require the component generator CLI.
