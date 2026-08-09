# Penglai 0.4.0 release security audit

Audit date: 2026-08-09

Scope: the local 0.4.0 public-release candidate, desktop bundle, Host runtime,
dependency locks, GitHub workflows, public documentation and `gh-pages` source.

Method: authorized source review, adversarial regression tests, dependency
advisory scans, release-gate scans and a local DMG lifecycle test. No production
service or third-party account was attacked.

## Verdict

The source candidate is suitable for Owner review before a public push. The
identified release-blocking code defects were fixed and the resulting macOS
Apple Silicon DMG passed install/use/uninstall acceptance. There are no known
npm or Rust vulnerability advisories in the shipped macOS/Windows dependency
paths as of the audit date.

This verdict is deliberately narrower than “perfectly secure”. The desktop is
a same-user application, its command/MCP processes are not OS-sandboxed, and
the local DMG is ad-hoc signed rather than Apple Developer ID signed/notarized.
The final GitHub branch-protection and repository security settings are Owner
cutover controls and must be checked when the candidate is pushed.

## Evidence summary

| Evidence | Observed result | Finding/path |
| --- | --- | --- |
| `npm test` | 71 files, 838 tests passed | F-01 through F-05 regression coverage |
| `npm audit --audit-level=moderate --registry=https://registry.npmjs.org` | 0 vulnerabilities | F-06 |
| `cargo audit --file packages/desktop/src-tauri/Cargo.lock` | 0 vulnerabilities; 17 allowed warnings | F-07 |
| `cargo tree ... --target aarch64-apple-darwin -i glib@0.18.5` | dependency absent | F-07 |
| `cargo tree ... --target x86_64-pc-windows-msvc -i glib@0.18.5` | dependency absent | F-07 |
| `cargo tree ... --target x86_64-unknown-linux-gnu -i glib@0.18.5` | reachable through Tauri GTK3 | F-07 |
| `node scripts/release-check.mjs` | public-source release gates pass | F-06, F-08, F-09 |
| `npm run tauri:build:local -w @penglai/desktop` | build, ad-hoc seal and `hdiutil verify` pass | F-10 |
| `node scripts/lifecycle-check.mjs` | install, first launch, isolated Host, setup, chat, Evidence preview, redacted diagnostics and uninstall pass | F-01, F-02, F-05, F-10 |

The full release gate was rerun on the clean one-commit public-history branch
and passed all eight groups.

## Findings and repairs

### F-01 — Host credential leaked through WebSocket URLs — fixed

The 0.4 candidate put the loopback Host token in a WebSocket query string.
URLs are commonly copied into logs, histories and diagnostics. Query
authentication is now rejected. Native/CLI clients use `X-Penglai-Token` and
browser-compatible WebSockets use an authenticated subprotocol.

Paths: `packages/host/src/server.ts`, `packages/host/src/cli/client.ts`,
`packages/desktop/src/bridge/http-bridge.ts`,
`packages/desktop/vite.config.ts`, `packages/host/static/app.js`.

### F-02 — Local credential file assumptions were too weak — fixed

Host startup now rejects token symlinks and non-regular files, checks current
user ownership, hardens the data directory to 0700 and token file to 0600, and
requires adequate token strength. Creation is exclusive and atomic. Desktop
startup and Doctor enforce/describe the same boundary without returning the
secret.

Paths: `packages/host/src/token-file.ts`, `packages/host/src/doctor.ts`,
`packages/desktop/src-tauri/src/lib.rs`.

### F-03 — Public model keys could cross plaintext HTTP — fixed

Provider endpoints now require HTTPS for non-loopback hosts. Only exact
`localhost`, `127.0.0.1` and `::1` HTTP endpoints are accepted for local
development; URL credentials and fragments are rejected. The rule is applied
at profile creation/update, model discovery, smoke checks, kernel creation and
review calls.

Paths: `packages/host/src/providers/url-safety.ts`,
`packages/host/src/profiles-store.ts`,
`packages/host/src/kernel/create-production-pi-kernel.ts`,
`packages/desktop/src/wizard/machine.ts`.

### F-04 — Indirect prompt injection crossed content boundaries — fixed

Document text, search results, fetched pages and MCP results are now wrapped as
untrusted data with a system-level instruction that embedded authority claims,
secret requests and tool instructions have no authority. MCP-provided names,
descriptions and JSON schemas are also structurally sanitized before they enter
the model tool surface. This is model defence-in-depth; deterministic policy,
workspace jail and Owner L3 approvals remain the authority boundary.

Paths: `packages/host/src/security/untrusted-content.ts`,
`packages/host/src/kernel/capability-tools.ts`,
`packages/host/src/mcp/client.ts`,
`packages/host/src/kernel/create-production-pi-kernel.ts`.

### F-05 — Evidence and approval logs could persist credentials — fixed

A shared recursive redactor now runs before Evidence, approval decisions and
diagnostic text are persisted. It covers private-key blocks, authentication
headers, common secret fields/assignments, URL credentials, CLI secret flags
and well-known token shapes. Tests assert that raw command, output and metadata
secrets do not survive. Redaction remains best-effort, so users should not paste
secrets into ordinary content.

Paths: `packages/host/src/security/redaction.ts`,
`packages/host/src/storage/product-store.ts`,
`packages/host/src/conversation-approvals.ts`,
`packages/host/src/diagnostics.ts`.

### F-06 — JavaScript dependency and lock provenance findings — fixed

Vite and vulnerable transitive packages were updated/overridden. The npm lock
was regenerated against the official registry with integrity hashes, and CI
now fails on moderate-or-higher npm advisories. The audit reports zero known
vulnerabilities on the audit date.

Paths: `package.json`, `package-lock.json`, `packages/desktop/package.json`,
`.github/workflows/host-test.yml`, `scripts/release-check.mjs`.

### F-07 — Rust advisories — shipped targets clean; Linux GUI warning accepted

`event-listener` was updated from 5.4.1 to 5.4.2, removing
RUSTSEC-2026-0221. Cargo audit reports no vulnerability findings, but reports 17
allowed warnings: unmaintained crates and RUSTSEC-2024-0429 for `glib 0.18.5`.
Target trees prove the GTK3/glib chain is absent from macOS and Windows builds
and present only in the Linux Tauri GUI tree. The 0.4.0 release matrix does not
ship Linux Desktop; its Linux artifact is the TypeScript headless runtime and
does not contain that Rust GUI dependency. A future Linux GUI release must
upgrade/migrate this stack or repeat a target-specific risk decision.

Path: `packages/desktop/src-tauri/Cargo.lock`.

### F-08 — Supply-chain automation used floating Actions and lacked update ownership — fixed

GitHub Actions are pinned to full commit SHAs. Dependabot now covers npm,
Cargo and GitHub Actions weekly. Release workflows retain asset hashes, SBOM,
runtime manifest checks and updater signature gates.

Paths: `.github/workflows/*.yml`, `.github/dependabot.yml`.

### F-09 — Privacy, licence and security claims were incomplete — fixed

The public documents now describe stored data, outbound third parties,
retention/deletion, same-user limits, non-sandboxed child processes, prompt
injection limits, diagnostic redaction and third-party licence ownership. The
website mirrors the material claims instead of saying that all bundled code is
MIT.

Paths: `SECURITY.md`, `docs/PRIVACY_AND_DATA.md`, `NOTICE`, `README.md`,
`docs/UNINSTALL.md`, and the `gh-pages` English/Chinese pages.

### F-10 — Local installer acceptance — passed with explicit signing limit

The rebuilt Apple Silicon DMG is 252,154,286 bytes with SHA-256
`83e3bdb69181c51427998ff00e01be513cdced9d19614f177615c866d178b02e`.
`hdiutil` verified its image checksum. The mounted app passed ad-hoc seal
verification and a sandboxed install/use/uninstall lifecycle using its bundled
Node 22.22.2 Host runtime. This proves local integrity and functionality, not an
Apple-verified publisher identity or notarization.

Path: `packages/desktop/scripts/build-local-dmg.mjs`,
`scripts/lifecycle-check.mjs`, `docs/RELEASE_NOTES_0.4.0.md`.

## Owner cutover controls

These controls live in GitHub settings and cannot be made true by a source
commit alone:

Read-only API inspection on 2026-08-09 found:

- `main` is not protected and no repository ruleset exists;
- Actions currently allow all actions and do not require SHA pinning at the
  repository-setting level (the candidate workflow files themselves are pinned);
- Dependabot vulnerability alerts and security updates are disabled;
- private vulnerability reporting is disabled;
- secret scanning and push protection are enabled, with zero open secret
  scanning alerts visible to the authenticated owner.

1. Require pull-request review and passing checks on `main`; block force pushes
   and branch deletion.
2. Restrict allowed Actions to trusted/pinned actions and retain least-privilege
   workflow permissions.
3. Enable Dependabot alerts/security updates and private vulnerability
   reporting.
4. Review the clean public candidate diff and the website diff before push.
5. Publish as a draft first. Inspect checksums/SBOM/assets downloaded back from
   GitHub before promoting it to a public release.

## Reproduction

Run from a clean checkout on the candidate commit:

```bash
npm ci
npm test
npm audit --audit-level=moderate --registry=https://registry.npmjs.org
node scripts/release-check.mjs
cargo audit --file packages/desktop/src-tauri/Cargo.lock
cargo check --locked --manifest-path packages/desktop/src-tauri/Cargo.toml
cargo test --locked --manifest-path packages/desktop/src-tauri/Cargo.toml
npm run tauri:build:local -w @penglai/desktop
node scripts/lifecycle-check.mjs
```

The DMG is intentionally not committed. Recompute and compare its SHA-256 with
the release notes when rebuilding; compressed image hashes are not expected to
be reproducible across arbitrary rebuild times.
