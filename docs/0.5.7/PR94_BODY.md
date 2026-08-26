# Penglai 0.5.7 Draft for Codex review

Grok Build stop line: this PR is **draft**. Do not merge, do not create `v0.5.7`, do not publish a GitHub Release, do not deploy production `gh-pages`.

## Identity

- Base SHA: `3102135c6821a044fe4f9b50638c91ce9f5e9cd1` (`main`)
- Head SHA: `PENDING_ROUND3`
- Base tag: `v0.5.6` at `75bbd591c61b757dfe015e54e40ad21ccf9ab94b`
- Official DSH: `0.1.1-rc.2` / `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`
- npm `latest` and `next` at freeze: `0.1.1-rc.2`
- DSH-IM current pin: unsigned `v3.0.0` / tag object `881491704e7bddecc1ce937d53071865489df3f7` / peeled `40b5a46516b44e30fa90e084400a8c3d578214e9` / tarball SHA-256 `791c2d7335cb524fb48b6e2939837709214842746be96df503dd5ca40f491c5b` (9 434 947 bytes)
- Tag verification: unsigned (`verified=false`)
- License: MIT
- Post-tag audit (not v3.0.0 content): `ea5176be93cf0a5959397bd15d3ef614811a2a67`
- v2.4.0 and v2.5.0 are historical only (ADR 0044)

Committed `release-info.json` remains a template: `phase=UNFROZEN`, `sourceSha=NONE`.

## This round (source, after Head `3e1719d60022bcd9febe2c97ddc13f3fade04cd3`)

- Source CI `audit:dependencies` resolves exports-only packages from workspace `node_modules` before Node `resolve()` (`libopus-wasm` has no `main`).
- Native embed-runtime locates pinned DSH under hoisted `node_modules/@deepseek-ai/dsh` when `.pnpm` has no virtual-store entry (`node-linker=hoisted`).
- Installed UI harness finds hoisted Electron; native workflow no longer hard-codes `.pnpm/electron@43.4.0`.
- DSH-IM v3.0.0 transport rewrite into `@penglai/im`: Slack Socket Mode reconnect, Discord Gateway intents/opcodes/resume, Telegram offset restore, WeCom SDK reconnect, QQ QR async failure, DingTalk registration source `DING_DWS_CLAW`.
- Status reactions are wired (processing → success/error) for Slack, Telegram, Discord, WhatsApp, and Feishu. DingTalk/WeCom/QQ have no official reaction API in this rewrite.
- WhatsApp reserved outbound IDs persist across restore. Sidecar outbox waits until vault restore finishes.
- Do not merge `main`. Native jobs still `git switch -C main "$GITHUB_SHA"` on the 0.5.7 commit for identity naming; they do not merge `origin/main`.

## Previous round (source, after audit Head `6e1d5166b44814b1a0c02c9fe439271fe391b70a`)

- R56-SEC-009: unknown adapters use sentinel `unknown-adapter`; adapter, route status, inbound state, and dispatch mode are asserted independently. `parseClosedEnum` stays fail-closed.
- R50-PREP-008: source template requires `phase=UNFROZEN` / `sourceSha=NONE`. Candidate bind must become `TARGET_BUILT`. Observed SHA/size/digest require readback PASS.
- Sidecar inbound envelope rejects missing/unknown `chatType`, missing `accountRef/botId`, `${channel}-default` as runtime identity, group/thread, and extra tenant/server/thread fields. Proven private is explicit. Idempotency and HMAC are `channel + account + vendorMessageId`.
- Legacy `${channel}-default` adapter_configs migrate transactionally to `cfg:${channel}`.
- IM restore records classified, redacted channel/account failures instead of `.catch(() => undefined)`. Uncertain sends are not auto-retried.
- `/version` is a local IM control command: Penglai, DSH, and DSH-IM pins; no Session, no model, no Harness.
- Weixin typing uses existing iLink `getconfig` + `sendtyping`; failure never blocks the reply.
- Reaction helper is serialized, idempotent, short-timeout; Slack manifest adds `reactions:write`.
- Feishu single-paragraph post extracts text; richer posts stay rejected.
- QQ markdown rewrite from post-tag `ea5176be` (not v3.0.0): fences, GFM tables, unique seq, deterministic plain fallback.

## Nine-platform Code / Installed / Live

| Channel | Code | Installed | Live |
|---|---|---|---|
| Weixin | source-tested iLink + typing | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Feishu | source-tested official SDK + post text | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| DingTalk | QR source `DING_DWS_CLAW` + stream ACK; missing conversationType rejected | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WeCom | QR + WSClient authenticated; SDK reconnect; chattype not defaulted | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| QQ | QR + QQBot; C2C markdown rewrite; QR onSuccess fail-closed | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Slack | auth.test bot+app token; Socket Mode reconnect; DM `channel_type=im` required | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Telegram | getMe, offset persist/restore, 429 backoff, webhook conflict | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| Discord | REST `@me` + Gateway intents/opcodes/resume; DM explicit; guild rejected | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |
| WhatsApp | Baileys, encrypted keys, extra text payloads, persisted echo IDs | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |

`LIVE_CHANNEL_IDS` remains Weixin + Feishu. No real owner accounts were used in this round.

## Tests / CI

- Node 22.22.2 + pnpm 10.14.0 on this Windows host.
- `pnpm install --frozen-lockfile`: PASS
- `format:check` + `tsc -b`: PASS
- Targeted R56-SEC-009 / R50-PREP-008 / inbound envelope: PASS
- `test:contract` 104/104 PASS
- `test:integration` 46/46 PASS
- `test:security` 15/15 PASS
- `test:chaos` 5/5 PASS
- `test:unit` 666 pass / 14 fail: all 14 are Windows `EPERM` symlink cases (pre-existing host privilege), not the R56/R50 failures
- `audit:secrets` PASS; `sbom` PASS
- Native three-target / installed / live account: NOT_RUN
- This round did not merge main, tag `v0.5.7`, publish a Release, or deploy production gh-pages

## Remaining (do not hide)

- Full source CI on GitHub Actions still needs a green run on this new Head.
- Windows unit symlink tests need Developer Mode / SeCreateSymbolicLink on this machine; they are not source-gate proof.
- Source-tested reactions/reconnect/offset/source rewrites are not live-account evidence. Windows Setup install of final `Penglai.exe` remains NOT_RUN.
- Native macOS arm64 / Intel and Windows x64 installers are NOT_RUN.
- Live account evidence remains `LIVE_BLOCKED_OWNER_ACCOUNT`.

## Reviewer

Codex: re-run source/contract/security on Node 22.22.2, compare transports against DSH-IM `40b5a46516b44e30fa90e084400a8c3d578214e9`, treat `ea5176be` as a separate QQ markdown patch, and do not approve live-support copy until `LIVE_IM_MATRIX.md` has real rows or explicit OWNER_ACCOUNT blocks (already explicit).
