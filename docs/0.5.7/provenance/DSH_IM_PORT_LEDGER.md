# DSH-IM v2.4.0 port ledger

Upstream: `https://github.com/xmanrui/dsh-im` @
`7211534aeff01dba4ab78c79a5fa31cb9fa9510f` (`v2.4.0`, MIT, unsigned tag).
Use: design/reference or rewrite into Penglai IM Core. Never vendor generated
`lib/` or start the DSH-IM runtime.

Legend: `reference` = read for protocol/UX; `rewrite` = reimplement against
Penglai Vault, Owner Broker, Artifact Service, routing-core, persistence;
`forbidden` = must not appear in Penglai.

## Adopted as rewrite targets

| Upstream | Penglai target | Mode | Notes |
|---|---|---|---|
| `src/channels/dingtalk/device-auth.mjs` | `packages/channel-dingtalk` | rewrite | real QR registration + poll; credentials into DSH + Vault |
| `src/channels/dingtalk/dingtalk-runtime.mjs` | `packages/channel-dingtalk` | rewrite | `dingtalk-stream@2.1.4` receive/send/reconnect |
| `src/channels/dingtalk/dingtalk-bridge.mjs` | `@penglai/im` host | rewrite | inbound → official Turn; no DSH-IM harness client |
| `src/channels/wecom/qr-auth.mjs` | `packages/channel-wecom` | rewrite | `@wecom/aibot-node-sdk@1.0.7` QR bot create |
| `src/channels/wecom/wecom-runtime.mjs` | `packages/channel-wecom` | rewrite | receive/send/reconnect |
| `src/channels/qq/qr-auth.mjs` | `packages/channel-qq` | rewrite | official QQ Bot QR, not personal QQ login |
| `src/channels/qq/qq-runtime.mjs` | `packages/channel-qq` | rewrite | `@tencent-connect/qqbot-connector@1.2.0` + `qqbot-nodejs@1.0.4` |
| `src/channels/slack/manifest.mjs` | `packages/channel-slack` | rewrite | official App Manifest + bot/app tokens; no QR |
| `src/channels/slack/slack-runtime.mjs` | `packages/channel-slack` | rewrite | Socket Mode; thread capability only after evidence |
| `src/channels/telegram/telegram-runtime.mjs` | `packages/channel-telegram` | rewrite | HTTP long-poll; webhook conflict + proxy diagnostics |
| `src/channels/discord/discord-runtime.mjs` | `packages/channel-discord` | rewrite | REST + Gateway; intents guidance |
| `src/channels/whatsapp/whatsapp-web-session.mjs` | `packages/channel-whatsapp` | rewrite | Baileys device-link; no plaintext auth dir |
| `src/channels/whatsapp/whatsapp-runtime.mjs` | `packages/channel-whatsapp` | rewrite | self-echo dedupe, reserved outbound IDs, logout wipe |
| `plugin-src/client/*` cards | `packages/im/src/dsh-client.js` | reference | UX for platform cards only |
| Weixin 1800-char segmentation idea | `packages/channel-weixin` | reference | keep Penglai iLink; adopt length splitting if needed |

## Shared upstream files (reference only)

| Upstream | Why not copy |
|---|---|
| `src/channels/*/config-store.mjs` | Penglai uses DSH credentials + Vault, not DSH-IM stores |
| `src/channels/*/state-store.mjs` | Penglai SQLite + private IM storage |
| `src/channels/*/harness-client.mjs` | would be a second Agent/session binding |
| `plugin-src/host/harness-session-coordinator.mjs` | DSH-IM session overlay |
| `plugin-src/host/harness-command-executor.mjs` | DSH-IM command host |
| `plugin-src/host/rpc-authority.mjs` | Penglai Owner Broker / IPC instead |

## Forbidden

| Upstream | Reason |
|---|---|
| `lib/**` | generated output |
| `bin/**` | second CLI/host |
| `cordis.patch.yml` | second DSH overlay |
| `src/channels/weixin/**` | do not replace Penglai iLink |
| `src/channels/feishu/**` | do not replace Penglai official Lark SDK |
| `src/channels/office/**` | Penglai Office is a required DSH plugin, not an IM channel |
| `plugin-src/host/channels/office/**` | same |
| `worker/**` | DSH-IM worker, not Penglai |

Preserve the MIT notice on any copied source file. Prefer rewrite.
