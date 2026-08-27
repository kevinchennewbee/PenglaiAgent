# Security Policy

Penglai 0.5.7 is a **community-verified** desktop distribution of official DeepSeek Harness (DSH). This file is the public security entry. The full product contract lives in [`docs/SECURITY.md`](docs/SECURITY.md).

## Supported versions

| Version | Status |
| --- | --- |
| 0.5.7 | Current immutable public release |
| 0.5.6 | Previous immutable public release; supported for upgrade to 0.5.7 |
| 0.5.0–0.5.5 | Supported only for upgrading to the current 0.5 generation; 0.5.0 requires a manual overlay |
| 0.4.1 and earlier | Unsupported; 0.5 does not silently import or delete old secrets or databases |

## Trust tier

- macOS: ad-hoc sealed, **not notarized**, no Developer ID.
- Windows: **no Authenticode**.
- Penglai Ed25519 signatures protect installer and updater integrity. They are **not** Apple or Microsoft publisher trust.
- First launch may show an OS reputation warning. Penglai will not tell users to turn off Gatekeeper or SmartScreen.
- There is **no silent auto-update**. Later 0.5.x upgrades are signed assisted upgrades that the user must confirm.

## Secrets and local data

API keys, Weixin tokens, and Feishu App Secrets are stored only through the official DSH credentials seam in an app-private YAML file. The renderer never reads plaintext secrets.

On macOS the credentials directory/file use 0700/0600. On Windows they use a current-user ACL. A local process running as the same OS user may still read the YAML. That is an accepted boundary, not Keychain or hardware isolation.

0.4.1 credentials and databases are not read, imported, or deleted.

Official DSH rc.2 bundles a session-telemetry adapter and a configured DeepSeek
OTLP endpoint. Penglai does not operate that backend and does not rely only on
the adapter's default mode: the owned DSH child receives
`DSH_TELEMETRY_DISABLED=1` from a closed environment allowlist. DSH applies that
disable after profile patches and constructs no telemetry SDK provider or upload
pipeline.

## Instant messaging risk

`@penglai/im` is the only IM plugin. Eight platforms have connection entries.
Adapters cannot call a parallel Agent. Live support is evidence-gated in
`docs/0.5.7/LIVE_IM_MATRIX.md`. Slack, Telegram, and Discord do not fake QR.
The WhatsApp community runtime is not bundled in 0.5.7; its compatibility card
has no connection action.

- Weixin: real QR login. The scanner is the only allowed identity unless the user expands the allowlist.
- Feishu: the user must create and publish their own enterprise self-built app. There is no Penglai-hosted Feishu QR and no fake “scan to finish”.
- Both channels accept private text, supported images, files, and audio. Images use the official DSH image path; non-image bytes use Workspace/Session-scoped opaque artifacts. Group chat, video, and unsupported rich content are rejected before they reach the model.
- Route binding is explicit Workspace/Session. Focus, recency, or “any agent” guesses are not used.

QR payloads, chat bodies, and identities must never appear in Git, logs, diagnostics, evidence, or screenshots.

## Reporting a vulnerability

Use GitHub's private
[`Report a vulnerability`](https://github.com/kevinchennewbee/PenglaiAgent/security/advisories/new)
flow. Do not open a public issue that contains secrets, QR images, chat text,
owner paths, or updater private keys.

Please include:

- Penglai version and platform (`macos_aarch64`, `macos_x64`, or `windows_x64`)
- Whether the build is the publication candidate
- Reproduction without real API keys or account material
- Impact on credentials, IM routing, update/uninstall, or Electron hardening

If a real credential may have leaked, rotate it immediately and say so in the report. Do not attach the secret.

## What this project will not claim

Penglai will not claim notarization, Authenticode, App Store trust, silent auto-update, zero-config Feishu, or “absolute security”.
