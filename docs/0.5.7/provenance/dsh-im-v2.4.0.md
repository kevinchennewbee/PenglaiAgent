# dsh-im v2.4.0 supply-chain record (historical)

**Superseded for Penglai 0.5.7** by
[`dsh-im-v2.5.0.md`](dsh-im-v2.5.0.md) / ADR 0044. Keep this file only as the
audit trail of the earlier pin. Do not treat v2.4.0 as a second current pin.

Penglai does **not** install this package as a second Agent core or copy its
generated `lib/`. This file records the audited upstream bytes that may be
selectively adapted into `@penglai/im`.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v2.4.0` |
| Annotated tag object | `65a05750cda1ec376bbe764c5d1dec20c8a664bc` |
| Peeled commit | `7211534aeff01dba4ab78c79a5fa31cb9fa9510f` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/7211534aeff01dba4ab78c79a5fa31cb9fa9510f` |
| Archive SHA-256 | `54e9de330461538b9035b521e86da3b001880cd2e1cbe2e8a6e657b662c29766` |
| License | MIT (Copyright (c) 2026 xmanrui) |
| Tag signed | **no** — unsigned tag; do not claim signed upstream |
| Fetched | 2026-08-25 |
| Generated `lib/` | **not copied** |
| Whole runtime | **not installed** |

Do not automatically follow a newer DSH-IM release during 0.5.7 unless Owner
re-pins for a security fix that affects already-ported Penglai code.

## Dependencies (from upstream `package.json` at the peeled commit)

Runtime:

- `@tencent-connect/qqbot-connector` 1.2.0
- `@tencent-connect/qqbot-nodejs` 1.0.4
- `@wecom/aibot-node-sdk` 1.0.7
- `dingtalk-stream` 2.1.4
- `qrcode` 1.5.4

Dev / optional in upstream (Penglai production treatment differs):

- `@larksuiteoapi/node-sdk` 1.73.0 — Penglai already pins Feishu via `@penglai/channel-feishu`
- `@whiskeysockets/baileys` 7.0.0-rc14 — WhatsApp community protocol; Penglai keeps experimental / default-off and, if used, must be a direct production dependency because Penglai executes it

## Forbidden upstream surfaces

- `lib/` generated output
- `bin/` including `bin/dsh-im.mjs`
- `cordis.patch.yml`
- DSH-IM harness client / Agent preset / session binding
- DSH-IM independent configuration storage
- DSH-IM Office implementation (`plugin-src/host/channels/office/`, `src/channels/office/`)
- Weixin replacement of Penglai iLink
- Feishu replacement of Penglai official Lark SDK

File-level mapping lives in `DSH_IM_PORT_LEDGER.md`.
