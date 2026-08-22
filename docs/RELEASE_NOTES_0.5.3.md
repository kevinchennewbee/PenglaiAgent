# Penglai 0.5.3

Penglai 0.5.3 is an update-closeout hotfix. It keeps official DeepSeek Harness `0.1.1-rc.1` as the only core and ships `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64` packages from one source commit.

## Fixed

- Upgrade post-verification no longer requires the optional Penglai IM plugin to be enabled. The hard gate now matches the product contract: embedded runtime integrity, profile readiness, required DSH credentials and Penglai Center inventory, and a healthy DSH process must pass; optional plugins may remain disabled.
- A later manual overlay can reconcile a stale `RECOVERY_REQUIRED` journal from an older failed post-verification attempt. It records the installed newer version as current without inventing a signed update ledger, then allows future update checks again.
- Signed remote plugin archives now stage under the app-private `Penglai/0.5/plugins/packages` tree. The application-bundled plugin directory remains read-only, and remote install/update rechecks package identity and SHA-256 before an atomic stage.
- Windows packaging now writes and verifies the same Electron fuse policy as macOS: RunAsNode, `NODE_OPTIONS`, and CLI inspect are disabled in the packaged `Penglai.exe`. All three native release jobs inspect the final packaged binary.
- Startup recovery now tears down the owned proxy and DSH process before showing the local recovery page. App-private persistence and memory directories are created owner-only, and budget reservation cleanup treats `%` and `_` in official session ids literally instead of as SQL wildcards.
- Installer verification is bound to the same opened regular file bytes, device/inode identity, size, SHA-256, and Ed25519 signature through staging and the final atomic rename. A symlink or path swap after validation is rejected instead of opening different bytes for installation.
- Regression coverage proves both the default-disabled IM path and recovery of a superseded 0.5.2 journal.

## Office Reader plugin

The immutable signed catalog [`plugin-catalog-v1.000004`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000004) carries `@penglai/office-reader` 0.1.2. It is a deliberately read-only first release: bounded text and cell extraction for DOCX, XLSX, and PPTX through the official DSH filesystem, with no network, native code, install scripts, or macro execution. Version 0.1.2 uses the exact structured input/output contracts required by DSH 0.1.1-rc.1. It remains disabled until the owner confirms `workspace.read` in Plugin Center. A verified plugin update can restart embedded DSH only after native owner approval and an exact committed package/version/SHA journal match. Publishing later compatible catalog sequences does not require another desktop release.

## 0.5.2 correction

The immutable 0.5.2 packages install and run, but a 0.5.1 → 0.5.2 assisted update can finish installation and then record `POST_VERIFY_FAILED` when Penglai IM is left at its default disabled state. The 0.5.2 bytes are immutable and have not been replaced. Users in that state should manually overlay 0.5.3; 0.5.3 recognizes that the failed 0.5.2 journal has been superseded and restores the update page to a usable current state.

## Upgrade paths

The public 0.5.1 updater discovered the immutable 0.5.3 Release, downloaded the exact `443178529`-byte Apple Silicon asset, reached `READY_FOR_USER`, required the native owner confirmation, and opened the verified DMG. Its SHA-256 was `2111a99a896a003b47a1dda25e1c4ec4adcab64d562975b0a1a0f7e7079d26e0`. After the system-level application copy, 0.5.3 launched the official DSH UI with the preserved Workspace and reported `COMMITTED / 0.5.3` on the Update page. A completed 0.5.1 profile exposes that path under **Settings → Penglai → Update**. A fresh 0.5.1 profile can, however, remain at the final wizard step because its completion gate looks for `$DSH_HOME/workspace.json` while DSH rc.1 persists the official registry under `storages/workspace.json`. The wizard's generic error text misreports that condition as a Workspace jail failure. Those users must install the same-platform 0.5.3 package manually. We do not claim that an already-published 0.5.1 binary gained a new visible recovery button.

- **0.5.1 users:** use **Settings → Penglai → Update** to install the highest stable release, or manually overlay 0.5.3 if the 0.5.1 Workspace bug prevents reaching Settings.
- **0.5.2 installed directly:** use the same update page normally.
- **0.5.2 showing recovery required after an assisted update:** manually overlay the same-platform 0.5.3 package once.
- **0.5.0:** manually overlay 0.5.3; 0.5.0 has no production updater trust path.

All paths preserve the `Penglai/0.5` data generation and external Workspaces. The updater verifies the Penglai Ed25519 signature and exact installer hash; there is no silent auto-update. Discovery uses GitHub's anonymous Releases API, so a shared network that exhausts GitHub's anonymous rate limit must wait for the reset or use the immutable Release page for the manual overlay. Normal uninstall preserves application data unless the user separately confirms an exact deletion plan.

## Trust and platform limits

This remains a `community-verified` release. macOS packages are ad-hoc signed and not notarized; Windows is not Authenticode signed. Gatekeeper or SmartScreen may warn. Do not disable system security.

The Plugin Center remains independent of desktop releases: another compatible, Penglai-signed catalog generation or DSH plugin archive can be published through the public [Penglai Plugin Registry](https://github.com/kevinchennewbee/PenglaiPluginRegistry) without rebuilding the client. Catalog 4 has passed production-path GitHub refresh, catalog and package signature verification, app-private staging, disabled-by-default installation, and offline last-good recovery. When an updated plugin package requires a fresh module instance, 0.5.3 permits an automatic embedded-DSH restart only after native owner approval and an exact committed update journal match.
