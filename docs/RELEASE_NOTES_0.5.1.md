# Penglai 0.5.1

Penglai 0.5.1 adds a signed plugin distribution protocol (PPDP/1) and a versioned app-update protocol (PUDP/1). It is a community-verified, ad-hoc sealed distribution of official DeepSeek Harness `0.1.1-rc.1` with three declared targets: `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64`. Native PASS is reserved for a matching runner; Intel and Windows remain BLOCKED until those builders and installed E2E exist.

This file is **not a publication freeze**. Exact three-target installers, live GitHub Releases, and Plugin Center installed E2E are **NOT_RUN**. Do not treat it as a shipped 0.5.1 until Owner freeze.

## Upgrade from 0.5.0

Apple Silicon users install 0.5.1 as a **manual DMG overlay** over 0.5.0. User data in `Penglai/0.5` is kept. Intel Mac and Windows x64 are fresh installs because 0.5.0 did not ship those clients. 0.5.0 cannot one-click update: it embeds a fixture updater key and never published `latest.json`.

From 0.5.1 onward, later same-platform versions are discovered from immutable GitHub Releases via `update-manifest-v1.json`.

## Plugin Center

Remote plugins can be refreshed, downloaded, installed disabled, enabled, and rolled back after Penglai signs an immutable catalog. Arbitrary URL/npm/Git install is not offered. DSH plugins share the local DSH process; permission lists are not an OS sandbox.

## Trust

- macOS: ad-hoc, not notarized, no Developer ID
- Windows: no Authenticode; SmartScreen warning expected
- No silent auto-update
- No Apple Developer Program requirement for Penglai Ed25519 signatures
