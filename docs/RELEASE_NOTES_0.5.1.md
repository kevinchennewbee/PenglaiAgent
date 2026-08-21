# Penglai 0.5.1

Penglai 0.5.1 adds a signed plugin distribution protocol (PPDP/1) and a versioned app-update protocol (PUDP/1). The desktop app is still a community-verified, ad-hoc sealed Apple Silicon distribution of official DeepSeek Harness 0.1.0-rc.8.

## Upgrade from 0.5.0

Install the 0.5.1 DMG manually over 0.5.0. User data in `Penglai/0.5` is kept. 0.5.0 cannot one-click update: it embeds a fixture updater key and never published `latest.json`.

From 0.5.1 onward, later same-platform versions are discovered from immutable GitHub Releases via `update-manifest-v1.json`.

## Plugin Center

Remote plugins can be refreshed, downloaded, installed disabled, enabled, and rolled back after Penglai signs an immutable catalog. Arbitrary URL/npm/Git install is not offered. DSH plugins share the local DSH process; permission lists are not an OS sandbox.

## Trust

- macOS: ad-hoc, not notarized, no Developer ID
- No silent auto-update
- No Apple Developer Program requirement for Penglai Ed25519 signatures
