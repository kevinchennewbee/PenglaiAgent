# dsh-im v2.1.0 supply-chain record

Penglai does **not** install this package as a second Agent core or copy its generated `lib/`. This file records the audited upstream bytes that may be selectively adapted into `@penglai/im`.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v2.1.0` |
| Annotated tag object | `982c45858146a41fa446635cbd2c9c5e7c900bf7` |
| Peeled commit | `60d19eb45ddfae3717d82f6fa9312b74cd6e66a6` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/60d19eb45ddfae3717d82f6fa9312b74cd6e66a6` |
| Archive SHA-256 | `cd468f108a52f503df1dfeb4cbf90ff4565fa836db32f0fb616d43ff799791b6` |
| License | MIT (Copyright (c) 2026 xmanrui) |
| Tag signed | **no** — unsigned tag; do not claim signed upstream |
| Fetched | 2026-08-24 |
| Generated `lib/` | **not copied** |
| Whole runtime | **not installed** |

## Dependencies (from upstream `package.json`)

Runtime:

- `@tencent-connect/qqbot-connector` 1.2.0
- `@tencent-connect/qqbot-nodejs` 1.0.4
- `@wecom/aibot-node-sdk` 1.0.7
- `dingtalk-stream` 2.1.4
- `qrcode` 1.5.4

Dev / optional (not a Penglai default):

- `@larksuiteoapi/node-sdk` 1.73.0 (Penglai already pins Feishu via `@penglai/channel-feishu`)
- `@whiskeysockets/baileys` 7.0.0-rc14 (WhatsApp community protocol; Penglai keeps experimental / default-off)

## File-level audit (source only)

Inspected `plugin-src/host/channels/*` and `plugin-src/client/channels/*`. Do not vendor `lib/`, `bin/dsh-im.mjs`, or `cordis.patch.yml` (that patch is a second DSH overlay).

| Path | Use in Penglai |
|---|---|
| `plugin-src/host/channels/dingtalk/` | candidate adapter ideas; must reimplement against Penglai IM core, Vault, Owner Broker, Artifact Service |
| `plugin-src/host/channels/wecom/` | same |
| `plugin-src/host/channels/qq/` | same |
| `plugin-src/host/channels/slack/` | token/oauth only; **no QR** |
| `plugin-src/host/channels/telegram/` | bot token; **no QR** |
| `plugin-src/host/channels/discord/` | bot token; **no QR** |
| `plugin-src/host/channels/whatsapp/` | community protocol; opt-in only |
| `plugin-src/host/channels/weixin/` | **do not replace** Penglai iLink adapter |
| `plugin-src/host/channels/feishu/` | **do not replace** Penglai official SDK adapter |
| `plugin-src/host/channels/office/` | **do not copy** — Penglai Office is a required DSH plugin, not an IM channel |
| `plugin-src/client/*` | UX ideas for Connect cards only |
| `lib/` | forbidden generated output |
| `bin/` | forbidden second CLI / host |

## Rules for any later port

1. Keep official DSH as the only Agent core.
2. Keep one IM core (`@penglai/im`) and existing Weixin/Feishu live adapters.
3. Credentials go through official DSH credentials + Penglai Vault, not dsh-im stores.
4. High-impact bind/rebind/remove consume Main Owner Broker receipts.
5. Files go through Artifact Service; no absolute paths in renderer.
6. Preserve MIT notice on any copied source file.
7. A platform joins `LIVE_CHANNEL_IDS` only with a real adapter, health check, and send-reject path.

Unsigned upstream is recorded as a fact. It is not a Penglai signing claim.
