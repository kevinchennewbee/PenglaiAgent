# dsh-im v2.5.0 supply-chain record

This is a **historical** 0.5.7 DSH-IM audit pin. The current reference baseline
is unsigned `v3.0.1`. v3.0.0, v2.4.0 remain historical only.

Penglai does **not** install this package as a second Agent core or copy its
generated `lib/`. Selected channel authentication, transport, and structured
message-failure ideas may be rewritten into `@penglai/im`.

## Identity

| Field | Value |
|---|---|
| Upstream | `https://github.com/xmanrui/dsh-im` |
| Version | `v2.5.0` |
| Annotated tag object | `d910373e1aa77e830bbb4a32544ace972492e79e` |
| Peeled commit | `aa8fd71b936a0378604bd0f8f277059833ddb8f7` |
| Archive URL | `https://codeload.github.com/xmanrui/dsh-im/tar.gz/aa8fd71b936a0378604bd0f8f277059833ddb8f7` |
| Archive SHA-256 | `19e99f85001b5546e77a6c3d4163ea2bef59edd0554036421369e0621e908758` |
| License | MIT (Copyright (c) 2026 xmanrui) |
| Tag signed | **no** — unsigned annotated tag; `verification.verified=false` |
| Tagger date | 2026-08-25T07:15:22Z |
| Fetched | 2026-08-25 |
| Generated `lib/` | **not copied** |
| Whole runtime | **not installed** |

The SHA-256 above is of the GitHub commit tarball for peeled
`aa8fd71b936a0378604bd0f8f277059833ddb8f7` (9 299 185 bytes). Do not treat
tag name `v2.5.0` as a substitute for the peeled commit or the archive hash.

## v2.4.0 → v2.5.0 (6 commits)

Peeled `7211534aeff01dba4ab78c79a5fa31cb9fa9510f` … `aa8fd71b936a0378604bd0f8f277059833ddb8f7`:

1. `feat(ui): show plugin version on brand hover`
2. `feat: add structured message failure reporting`
3. `feat(weixin): show typing indicator during turns`
4. `fix: surface actionable channel message errors`
5. `merge: add Weixin typing indicator`
6. `chore: release v2.5.0`

Penglai adoption from this delta: rewrite `src/channels/shared/message-failure.mjs`
and the client last-message-error UX into `@penglai/im` (stable code + reference
id + user-actionable copy). Weixin typing remains **reference only**; Penglai
keeps iLink and must not copy DSH-IM Weixin/Feishu. Generated `lib/**` stays
forbidden.

## Dependencies (upstream `package.json` at the peeled commit)

Runtime:

- `@tencent-connect/qqbot-connector` 1.2.0
- `@tencent-connect/qqbot-nodejs` 1.0.4
- `@wecom/aibot-node-sdk` 1.0.7
- `dingtalk-stream` 2.1.4
- `qrcode` 1.5.4

Dev / optional in upstream (Penglai production treatment differs):

- `@larksuiteoapi/node-sdk` 1.73.0 — already pinned via `@penglai/channel-feishu`
- `@whiskeysockets/baileys` 7.0.0-rc14 — WhatsApp community protocol; Penglai
  keeps experimental / default-off and, if executed, must be a **direct**
  production dependency

## Forbidden upstream surfaces

- `lib/` generated output
- `bin/` including `bin/dsh-im.mjs`
- `cordis.patch.yml`
- DSH-IM harness client / Agent preset / session binding
- DSH-IM independent configuration storage
- DSH-IM Office
- Weixin replacement of Penglai iLink
- Feishu replacement of Penglai official Lark SDK

File-level mapping lives in `DSH_IM_PORT_LEDGER.md`.
