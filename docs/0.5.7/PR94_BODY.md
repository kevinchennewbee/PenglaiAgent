# Penglai 0.5.7 Draft for Codex review

Grok Build stop line: this PR is **draft**. Do not merge, do not create `v0.5.7`, do not publish a GitHub Release, do not deploy production `gh-pages`.

## Identity

- Base SHA: `3102135c6821a044fe4f9b50638c91ce9f5e9cd1` (`main`)
- Code Head SHA: `11199631fe7a6ec002ab2b840a133152231d3da6` (docs commit may follow)
- Gate-fix SHA: `570fa37c8b20503af999b6c9cb08eb1c37358010`
- Base tag: `v0.5.6` at `75bbd591c61b757dfe015e54e40ad21ccf9ab94b`
- Official DSH: `0.1.1-rc.2` / `dsh-v0.1.1-rc.2` / `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` (npm `latest`/`next` re-checked 2026-08-26)
- DSH-IM current pin: unsigned `v3.0.1` / tag object `36c099299557ed053517018c0f6ac2762e6961e2` / peeled `fb8a9df652ed6eaa4b99a9338cab15db1b626b1c` / tarball SHA-256 `7db84c13cdb434b2c13690aace527ff8a7dbdf6bfc947c2e6c661dcc28bbffaf` (9 833 777 bytes)
- Tag verification: unsigned (`verified=false`)
- License: MIT
- v3.0.0 / v2.5.0 / v2.4.0 are historical only

Committed `release-info.json` remains a template: `phase=UNFROZEN`, `sourceSha=NONE`.

## This round (Native plugin-enable + DSH-IM rewrite gaps, Code Head `11199631fe7a6ec002ab2b840a133152231d3da6`)

DSH-IM is a **selective rewrite**, not a complete absorb of the v3.0.1 tree. Forbidden `lib/` / `bin/` / `cordis.patch.yml` / harness client are still absent. Remaining rewrite work that landed in this Head:

- `assertPluginJsClosure` no longer treats the esbuild ESM helper `Dynamic require of "' + x` as an inlined Lark/axios CJS require. Native `u3-first-party-plugins` on `2bc24fb` failed with `dshPid: 0` after enabling optional plugins because that helper substring aborted extract. Packed IM host on this Windows machine has the helper, zero quoted specs, and the new gate PASSES.
- Slack Socket Mode is `connected` only after `hello`; disconnect keeps tokens, logout wipes them.
- Telegram persists `updateOffset` on every update, including rejected non-private.
- QQ `msg_seq` is restart-safe (`max(previous+1, unix seconds)`) and persisted.
- WhatsApp reserved-outbound `isEcho` is applied on the production Baileys upsert path.
- Discord rejects group DMs (`channel_type` 3 / READY `private_channels`).
- DingTalk waits for Stream `REGISTERED` before connected; health follows SDK reconnecting.
- WeCom health follows WS `reconnecting`/`disconnected`; ingest test seam requires `chatType: "private"`.
- Slack `capabilities.threads` is `false` until evidence.
- SBOM pin is unsigned v3.0.1 / `fb8a9df…`, not v3.0.0.

CI oracles:

- Source CI push `2bc24fb`: [32928461863](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32928461863) success
- Native `2bc24fb`: [32928461849](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32928461849) **failure** at Installed first-party plugin compatibility (Windows + macOS aarch64 `dshPid: 0` after enable)
- Source CI push `570fa37`: [32930662052](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32930662052) success
- Native `570fa37` (CJS gate): [32930662068](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32930662068) in progress
- Source CI push `1119963`: [32931212763](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32931212763) in progress
- Native `1119963`: [32931212783](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32931212783) queued behind 570fa37 (`cancel-in-progress: false`)

Local Windows Setup remains `BLOCKED_TOOLCHAIN` (no VS2022 `cl`, no NSIS). Live remains `LIVE_BLOCKED_OWNER_ACCOUNT`. Do not merge main.

## Previous round (true-machine closeout, after Head `1b4f921eadd3b29ce76414295eeb6a3f88285119`)

- Re-measured official DSH: still `0.1.1-rc.2` / `b150a551`. No silent upgrade.
- DSH-IM pin moved to measured v3.0.1 tarball. QQ C2C markdown already rewritten; Telegram/English UI absorbed as overflow/copy principles only; Weixin files unchanged v3.0.0→v3.0.1; iLink kept.
- P0 WhatsApp: production `messages.upsert` uses Baileys `jidDecode`/`isPnUser`/`isLidUser`/`isJidGroup`/`isJidBroadcast`/`isJidStatusBroadcast`/`isJidNewsletter`. Group/broadcast/status/newsletter/unknown rejected. `accountRef` is only connected self identity.
- P0 macOS package-metadata tests compare `realpathSync` on both sides.
- P0 IM host pack: esbuild metafile names the real dynamic-require chain; axios/form-data and Baileys stay external and vendored; `pnpm pack:plugins` PASS on this Windows host.
- Native workflow display name is already `Native 0.5.7 release candidate`.
- Local Windows Setup is `BLOCKED_TOOLCHAIN` (no VS2022 `cl` / NSIS `makensis` on this machine).

## Previous round (source, after Head `3e1719d60022bcd9febe2c97ddc13f3fade04cd3`)

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
| WhatsApp | Baileys JID gate, encrypted keys, captions, persisted echo IDs | NOT_RUN | `LIVE_BLOCKED_OWNER_ACCOUNT` |

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

Codex: re-run source/contract/security on Node 22.22.2, compare transports against DSH-IM `fb8a9df652ed6eaa4b99a9338cab15db1b626b1c`, and do not approve live-support copy until `LIVE_IM_MATRIX.md` has real rows or explicit OWNER_ACCOUNT blocks (already explicit).
