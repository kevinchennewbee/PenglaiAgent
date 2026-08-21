# Penglai 0.5.1

Penglai 0.5.1 adds a signed plugin distribution protocol (PPDP/1) and a versioned app-update protocol (PUDP/1). It is a community-verified release of official DeepSeek Harness `0.1.1-rc.1` with three declared targets: `darwin-aarch64`, `darwin-x86_64`, and `win32-x86_64`. Native status is recorded only from a matching runner.

The signed Plugin Registry is live. The desktop application is not shipped until the exact three installers and their native evidence are frozen into the immutable `v0.5.1` Release.

## Upgrade from 0.5.0

Apple Silicon users install 0.5.1 as a **manual DMG overlay** over 0.5.0. User data in `Penglai/0.5` is kept. Intel Mac and Windows x64 are fresh installs because 0.5.0 did not ship those clients. 0.5.0 cannot one-click update: it embeds a fixture updater key and never published `latest.json`.

From 0.5.1 onward, later same-platform versions are discovered from immutable GitHub Releases via `update-manifest-v1.json`.

## Plugin Center

Remote plugins can be refreshed, downloaded, installed disabled, enabled, and rolled back from Penglai-signed immutable catalogs. The first catalog is live at [`plugin-catalog-v1.000001`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000001), and production refresh/package/offline recovery have passed. Arbitrary URL/npm/Git install is not offered. DSH plugins share the local DSH process; permission lists are not an OS sandbox.

## Trust

- macOS: ad-hoc, not notarized, no Developer ID
- Windows: no Authenticode; SmartScreen warning expected
- No silent auto-update
- No Apple Developer Program requirement for Penglai Ed25519 signatures
