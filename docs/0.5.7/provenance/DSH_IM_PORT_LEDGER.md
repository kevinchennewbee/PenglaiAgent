# DSH-IM v3.0.0 port ledger

Current 0.5.7 pin: `https://github.com/xmanrui/dsh-im` @
`40b5a46516b44e30fa90e084400a8c3d578214e9` (`v3.0.0`, MIT, unsigned tag object
`881491704e7bddecc1ce937d53071865489df3f7`). v2.4.0 and v2.5.0 identities are
historical only. Post-tag `ea5176be93cf0a5959397bd15d3ef614811a2a67` is a
separate audit in `dsh-im-post-v3.0.0.md` and is not v3.0.0 content.
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
| `src/channels/shared/message-failure.mjs` | `@penglai/im` message-failure | rewrite | stable code + reference id + user-actionable copy; MIT if source is adapted |
| `plugin-src/client/last-message-error.js` | Messaging card error row | reference | last failure on the platform card |
| `src/channels/weixin/weixin-runtime.mjs` typing | `packages/channel-weixin` | rewrite | iLink `getconfig` + `sendtyping`; best-effort; never replace iLink |
| `src/channels/qq/markdown-reply.mjs` @ `ea5176be` | `packages/channel-qq/src/markdown-reply.ts` | rewrite | post-tag hardening; not v3.0.0 content |
| `src/channels/shared` reactions idea | `packages/im/src/reactions.ts` | rewrite | short timeout, serialized, idempotent; failure never blocks reply |
| `src/channels/shared/status-reaction.mjs` | `@penglai/im` host + adapters | rewrite | processing/success/error wired through Slack/Telegram/Discord/WhatsApp/Feishu |
| Slack Socket Mode reconnect | `packages/channel-slack` | rewrite | hello/disconnect ACK, backoff reconnect |
| Discord Gateway op 1/6/7/9/10/11 | `packages/channel-discord` | rewrite | Message Content intent, heartbeat ACK, resume, invalid session |
| Telegram cursor persist | `packages/channel-telegram` + IM host | rewrite | offset restored from adapter_config before long-poll |
| WeCom `maxReconnectAttempts` | `packages/channel-wecom` | rewrite | WSClient reconnecting/disconnected |
| QQ QR `onSuccess` async failure | `packages/channel-qq` | rewrite | vault/connect errors fail-closed |
| DingTalk registration `source` | `packages/channel-dingtalk` | rewrite | `DING_DWS_CLAW` (DingTalk QR API source token) |
| Weixin 1800-char segmentation idea | `packages/channel-weixin` | reference | keep Penglai iLink; adopt length splitting if needed |
| `src/channels/dingtalk/dingtalk-controller.mjs` | `packages/channel-dingtalk` | rewrite | Stream supervisor, ACK, reconnect |
| `src/channels/wecom/wecom-controller.mjs` | `packages/channel-wecom` | rewrite | WSClient authenticated/message/reconnect |
| `src/channels/qq/qq-controller.mjs` | `packages/channel-qq` | rewrite | startQrConnect + QQBot gateway |
| `src/channels/slack/slack-controller.mjs` | `packages/channel-slack` | rewrite | Socket Mode envelope ACK |
| `src/channels/whatsapp/whatsapp-controller.mjs` | `packages/channel-whatsapp` | rewrite | Baileys session, QR, logout wipe |

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
