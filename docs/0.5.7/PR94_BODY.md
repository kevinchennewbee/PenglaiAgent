# Penglai 0.5.7 Draft for Codex review

Grok Build stop line: this PR is **draft**. Do not merge, do not create `v0.5.7`, do not publish a GitHub Release, do not deploy production `gh-pages`.

## Identity

- Base SHA: `3102135c6821a044fe4f9b50638c91ce9f5e9cd1` (`main`)
- Head SHA: `829c85f1b230dc5f95a43147f2d5dd56b14ad058`
- Base tag: `v0.5.6` at `75bbd591c61b757dfe015e54e40ad21ccf9ab94b`
- Official DSH: `0.1.1-rc.2` / `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- npm `latest` and `next` at freeze: `0.1.1-rc.2`
- DSH-IM current pin: unsigned `v2.5.0` / tag object `d910373e1aa77e830bbb4a32544ace972492e79e` / peeled `aa8fd71b936a0378604bd0f8f277059833ddb8f7` / tarball SHA-256 `19e99f85001b5546e77a6c3d4163ea2bef59edd0554036421369e0621e908758`
- v2.4.0 is historical only (ADR 0044)

Committed `release-info.json` remains a template: `phase=UNFROZEN`, `sourceSha=NONE`.

## v2.4.0 鈫?v2.5.0 audit

Six commits: structured message-failure reporting, Weixin typing, actionable channel errors, brand hover version, merge, release. Penglai rewrote failure codes into `@penglai/im`. Weixin/Feishu replacements remain forbidden. `lib/` / `bin/` / `cordis.patch.yml` are not vendored.

## Nine-platform implementation

| Channel | Implementation | Live evidence |
|---|---|---|
| Weixin | existing iLink | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Feishu | existing official SDK | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| DingTalk | device QR + `dingtalk-stream` DWClient TOPIC_ROBOT ACK + sessionWebhook send | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WeCom | intelligent-bot QR + WSClient authenticated/message | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| QQ | `startQrConnect` + QQBot; not personal QQ | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Slack | `auth.test` then Socket Mode `apps.connections.open` + envelope ACK; bot+app token | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Telegram | getMe, webhook conflict fail-closed, abortable long poll timeout=25 | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Discord | REST `@me` then Gateway Identify/READY, heartbeat op=1, reconnect backoff 1s/3s/10s; DM only | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WhatsApp | Baileys production import, Vault AES-256-GCM data key, persisted creds+Signal keys, risk ack, logout wipe | `LIVE_BLOCKED_OWNER_ACCOUNT` |

`LIVE_CHANNEL_IDS` remains Weixin + Feishu. README/website say connection entries exist; support follows the matrix only.

Owner action for live rows: scan once or paste a bot token on this machine. Grok Build does not hold those accounts.

## This round (source, after previous Head `b405319`)

- Lockfile now records `@penglai/budget` 鈫?`@penglai/runtime` and importers for `channel-slack` / `channel-telegram` / `channel-discord` / `channel-whatsapp` (including Baileys).
- Channel lifecycle is fail-closed: incomplete inbound dropped, Slack requires bot+app tokens, leftover token adapters never become `connected`, vault maps hydrate only from valid serialized secrets, HMAC `peerRef` is not the vendor id.
- QR is rendered to a PNG data URL (`data-penglai-im-scan-image`); WhatsApp/QQ peek QR payload rather than a raw scan host URL.
- Budget `setPolicy` consumes a Main owner-broker receipt (`budget.set-policy`); forged UUID/receipt and replay fail closed.
- Plugin Center last-good promotes `next` then `prev` after a crash window; DSH supervisor restart uses 1s/3s/10s backoff.

## Tests / CI

- Source tests on this Windows host (Node 22.22.2, `node --import tsx --test`):
  - Channel packages (dingtalk, wecom, qq, slack, telegram, discord, whatsapp): **15/15 PASS**
  - IM unit/adapter/registry/owner/message-failure/media: **18/18 PASS**
  - `packages/im/src/im.test.ts`: **22/22 PASS**
  - Budget including owner-receipt: **10/10 PASS** (after `tsc -b` so runtime `dist` includes `budget.set-policy`)
  - `supervisor-policy.test.ts` and `last-good.test.ts`: **PASS**
  - Plugin-center extra suite: **61/63**; the two failures are pre-existing Windows `EPERM` symlink cases in onboarding-wizard / remotes-security, not introduced here
- Native CI (macOS ARM / Intel / Windows x64): **NOT_RUN** on this host.
- Installed tests: **NOT_RUN**.
- `pnpm install --frozen-lockfile` on this Windows host after regenerating the lockfile: **PASS** (Node 22.22.2 + pnpm 10.14.0 + `node-linker=hoisted` + `package-import-method=copy`). Previous EISDIR on `@deepseek-ai/cordis` was not reproduced on this run.

## Remaining (do not hide)

- Frozen lockfile install is **PASS** on this Windows host after the lockfile regeneration in `917fe00`. It is still not evidence for other machines or a clean clone from GitHub Actions.
- Native three-target builders and installed evidence are **NOT_RUN**.
- Live account evidence is `LIVE_BLOCKED_OWNER_ACCOUNT`.
- Source tests are not a substitute for installed, notarized, Authenticode, or public-release evidence.

## High-risk files

- `packages/im/src/index.ts`
- `packages/im/src/host.ts`
- `packages/channel-dingtalk/src/stream-client.ts`
- `packages/channel-wecom/src/ws-client.ts`
- `packages/channel-qq/src/qr-auth.ts`
- `packages/channel-slack/src/index.ts`
- `packages/channel-discord/src/index.ts`
- `packages/channel-whatsapp/src/baileys-link.ts`
- `packages/budget/src/remote.ts`
- `packages/budget/src/owner.ts`
- `packages/plugin-center/src/profile-tx.ts`
- `pnpm-lock.yaml`
- `third_party/sources.lock.json`
- `docs/0.5.7/provenance/dsh-im-v2.5.0.md`

## Reviewer

Codex: re-run source/contract/security on Node 22.22.2, compare transports against DSH-IM `aa8fd71b936a0378604bd0f8f277059833ddb8f7`, and do not approve live-support copy until `LIVE_IM_MATRIX.md` has real rows or explicit OWNER_ACCOUNT blocks (already explicit).
