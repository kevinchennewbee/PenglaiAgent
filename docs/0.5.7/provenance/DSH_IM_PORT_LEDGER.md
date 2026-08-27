# DSH-IM v3.0.5 port ledger

Current 0.5.7 pin: `https://github.com/xmanrui/dsh-im` @
`64587b3b6162fa34f1c3ddb335a254d4154c9175` (`v3.0.5`, MIT, unsigned tag object
`63bdfc72be1289097e3c73acb95ba9260531091d`). Earlier identities are
historical only. See `dsh-im-v3.0.5.md` for the eight-commit review from
v3.0.2 and the explicit adopted/rejected decisions.
The later `v3.0.6` delta was reviewed on 2026-08-27 and did not change the
pin; see `dsh-im-v3.0.6.md` for the exact identity and decisions.
Use: design/reference or rewrite into Penglai IM Core. Never vendor generated
`lib/` or start the DSH-IM runtime.

Legend: `reference` = read for protocol/UX; `rewrite` = reimplement against
Penglai Vault, Owner Broker, Artifact Service, routing-core, persistence;
`forbidden` = must not appear in Penglai.

## Adopted as rewrite targets

| Upstream | Penglai target | Mode | Notes |
|---|---|---|---|
| `src/channels/dingtalk/device-auth.mjs` | `packages/channel-dingtalk` | rewrite | real QR registration + poll; credentials into DSH + Vault |
| `src/channels/dingtalk/dingtalk-runtime.mjs` | `packages/channel-dingtalk` | rewrite | `dingtalk-stream@2.1.4` receive/send; connected only after REGISTERED handshake; explicit callback ACK; health follows `registered/connected/reconnecting` |
| `src/channels/dingtalk/dingtalk-bridge.mjs` | `@penglai/im` host | rewrite | inbound → official Turn; no DSH-IM harness client |
| `src/channels/wecom/qr-auth.mjs` | `packages/channel-wecom` | rewrite | `@wecom/aibot-node-sdk@1.0.7` QR bot create |
| `src/channels/wecom/wecom-runtime.mjs` | `packages/channel-wecom` | rewrite | official typed `frame.body`; `sendMessage(chatId, body)`; health follows WS `reconnecting`/`disconnected`; inbound requires vendor `chattype=single` |
| `src/channels/qq/qr-auth.mjs` | `packages/channel-qq` | rewrite | official QQ Bot QR, not personal QQ login |
| `src/channels/qq/qq-runtime.mjs` | `packages/channel-qq` | rewrite | `qqbot-nodejs@1.0.4`; QR onboarding selectively rewritten from Tencent `qqbot-agent-sdk` MIT commit `6163b5d`; the `UNLICENSED` connector is not shipped |
| `src/channels/slack/manifest.mjs` | `packages/channel-slack` | rewrite | official App Manifest + bot/app tokens; no QR |
| `src/channels/slack/slack-runtime.mjs` | `packages/channel-slack` | rewrite | Socket Mode connected after `hello`; disconnect vs logout split; threads capability false until evidence |
| `src/channels/telegram/telegram-runtime.mjs` | `packages/channel-telegram` | rewrite | HTTP long-poll; webhook conflict + proxy diagnostics; offset persisted on every update including rejected non-private |
| `src/channels/discord/discord-runtime.mjs` | `packages/channel-discord` | rewrite | REST + Gateway; DIRECT_MESSAGES-only intent; REST-confirm channel type 1; reject unknown, guild, and group DM |
| `src/channels/whatsapp/whatsapp-web-session.mjs` | `packages/channel-whatsapp` | rewrite | Baileys device-link; no plaintext auth dir |
| `src/channels/whatsapp/whatsapp-runtime.mjs` | `packages/channel-whatsapp` | rewrite | self-echo dedupe on the Baileys upsert path, reserved outbound IDs, logout wipe |
| `plugin-src/client/*` cards | `packages/im/src/dsh-client.js` | reference | UX for platform cards only |
| card status placement @ v3.0.3 | `packages/im/src/dsh-client.js` | principle rewrite | platform name and connection state share a responsive header; no DSH-IM CSS or component code copied |
| `src/channels/shared/message-failure.mjs` | `@penglai/im` message-failure | rewrite | stable code + reference id + user-actionable copy; MIT if source is adapted |
| `plugin-src/client/last-message-error.js` | Messaging card error row | reference | last failure on the platform card |
| `src/channels/weixin/weixin-runtime.mjs` typing | `packages/channel-weixin` | rewrite | iLink `getconfig` + `sendtyping`; best-effort; never replace iLink |
| `src/channels/weixin/weixin-api.mjs` @ v3.0.5 | `packages/channel-weixin/src/protocol.ts` | selective rewrite | exact `ilinkai.wechat.com` international redirect host added; lookalike suffixes rejected; Penglai does not broaden to arbitrary subdomains |
| `src/channels/qq/markdown-reply.mjs` @ v3.0.1 | `packages/channel-qq/src/markdown-reply.ts` | rewrite | C2C markdown hardening now inside v3.0.1; fences, GFM tables, restart-safe seq, Unicode-safe split, C2C passive quota of 4, fallback only on markdown rejection |
| `src/channels/shared` reactions idea | `packages/im/src/reactions.ts` | rewrite | short timeout, serialized, idempotent; failure never blocks reply |
| `src/channels/shared/status-reaction.mjs` | `@penglai/im` host + adapters | rewrite | processing/success/error wired through Slack/Telegram/Discord/WhatsApp/Feishu |
| Slack Socket Mode reconnect | `packages/channel-slack` | rewrite | hello/disconnect ACK, backoff reconnect; connected only after hello |
| Discord Gateway op 1/6/7/9/10/11 | `packages/channel-discord` | rewrite | DM-only intent, heartbeat ACK, resume, invalid session; no privileged Message Content intent |
| Telegram cursor persist | `packages/channel-telegram` + IM host | rewrite | offset restored from adapter_config before long-poll |
| WeCom `maxReconnectAttempts` | `packages/channel-wecom` | rewrite | WSClient reconnecting/disconnected |
| WeCom thinking stream @ v3.0.3 | not ported | reference | Penglai sends only the durable official DSH final through its outbox and does not expose intermediate model thinking to external IM |
| WhatsApp group callers @ v3.0.3 | not ported | rejected and upstream-reverted | conflicts with Penglai private-only policy and was reverted by v3.0.4 |
| QQ QR `onSuccess` async failure | `packages/channel-qq` | rewrite | vault/connect errors fail-closed |
| DingTalk registration `source` | `packages/channel-dingtalk` | rewrite | `DING_DWS_CLAW` (DingTalk QR API source token) |
| Weixin 1800-char segmentation idea | `packages/channel-weixin` | reference | keep Penglai iLink; adopt length splitting if needed |
| `src/channels/dingtalk/dingtalk-controller.mjs` | `packages/channel-dingtalk` | rewrite | Stream supervisor, ACK, reconnect |
| `src/channels/wecom/wecom-controller.mjs` | `packages/channel-wecom` | rewrite | WSClient authenticated/message/reconnect |
| `src/channels/qq/qq-controller.mjs` | `packages/channel-qq` | rewrite | Penglai MIT QR onboard rewrite + typed QQBot gateway; no `UNLICENSED` connector |
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
