# Penglai 0.5.3

Penglai 0.5.3 is an update-closeout hotfix. It keeps official DeepSeek Harness `0.1.1-rc.1` as the only core and ships `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64` packages from one source commit.

## Fixed

- Upgrade post-verification no longer requires the optional Penglai IM plugin to be enabled. The hard gate now matches the product contract: embedded runtime integrity, profile readiness, required DSH credentials and Penglai Center inventory, and a healthy DSH process must pass; optional plugins may remain disabled.
- A later manual overlay can reconcile a stale `RECOVERY_REQUIRED` journal from an older failed post-verification attempt. It records the installed newer version as current without inventing a signed update ledger, then allows future update checks again.
- Regression coverage proves both the default-disabled IM path and recovery of a superseded 0.5.2 journal.

## 0.5.2 correction

The immutable 0.5.2 packages install and run, but a 0.5.1 → 0.5.2 assisted update can finish installation and then record `POST_VERIFY_FAILED` when Penglai IM is left at its default disabled state. The 0.5.2 bytes are immutable and have not been replaced. Users in that state should manually overlay 0.5.3; 0.5.3 recognizes that the failed 0.5.2 journal has been superseded and restores the update page to a usable current state.

## Upgrade paths

- **0.5.1 users:** use **Settings → Penglai → Update** to install the highest stable release, or manually overlay 0.5.3 if the 0.5.1 Workspace bug prevents reaching Settings.
- **0.5.2 installed directly:** use the same update page normally.
- **0.5.2 showing recovery required after an assisted update:** manually overlay the same-platform 0.5.3 package once.
- **0.5.0:** manually overlay 0.5.3; 0.5.0 has no production updater trust path.

All paths preserve the `Penglai/0.5` data generation and external Workspaces. The updater verifies the Penglai Ed25519 signature and exact installer hash; there is no silent auto-update. Discovery uses GitHub's anonymous Releases API, so a shared network that exhausts GitHub's anonymous rate limit must wait for the reset or use the immutable Release page for the manual overlay. Normal uninstall preserves application data unless the user separately confirms an exact deletion plan.

## Trust and platform limits

This remains a `community-verified` release. macOS packages are ad-hoc signed and not notarized; Windows is not Authenticode signed. Gatekeeper or SmartScreen may warn. Do not disable system security.

The Plugin Center remains independent of desktop releases: another compatible, Penglai-signed catalog generation or DSH plugin archive can be published through the public [Penglai Plugin Registry](https://github.com/kevinchennewbee/PenglaiPluginRegistry) without rebuilding the client.
