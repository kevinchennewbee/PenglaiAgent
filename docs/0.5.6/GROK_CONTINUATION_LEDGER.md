# Penglai 0.5.6 Grok continuation ledger

Working ledger for `grok/0.5.6-continuation`. Not a public PASS claim.

Baseline (verified 2026-08-24):

| Field | Value |
|---|---|
| cwd | `/Volumes/KevinSSD-in/macmini/PenglaiAgent` |
| origin | `https://github.com/kevinchennewbee/PenglaiAgent.git` |
| parent branch | `feat/0.5.6` |
| parent HEAD | `a818b860d7b2b674dfb6e0625437f6a6159ebe54` |
| `origin/main` | `d1f61ef61eb3d86f33a4d7e1c05a2137b36c7b22` |
| continuation branch | `grok/0.5.6-continuation` created from that SHA |
| worktree at branch creation | clean |

Status values: `TODO` / `IN_PROGRESS` / `SOURCE_PASS` / `INSTALLED_PASS` / `LIVE_PASS` / `BLOCKED` / `DEFERRED_UPSTREAM` / `LIVE_NOT_RUN` / `OWNER_ACTION_REQUIRED`.

Evidence classes: S source, C contract, N native, I installed, L live, P public.

## A — kill false greens

| ID | Status | Production entry | Tests | Evidence | Remaining |
|---|---|---|---|---|---|
| A1-OFFICE | SOURCE_PASS | `packages/office/src/index.ts` `apply()`; `service.commit/export/return` | `packages/office/src/production-wiring.test.ts` | S at continuation HEAD | I/N dialog click later |
| A1-MEMORY | SOURCE_PASS | `packages/memory/src/index.ts` `acceptCandidate`/`forget`/`importConfirm`; `remote.ts` | `packages/memory/src/production-wiring.test.ts` | S | I later |
| A1-ARTIFACT | SOURCE_PASS | Office/IM `package.json` and production `apply()` | `packages/artifacts/src/consumers.test.ts` | S | I later |
| A1-TTS | SOURCE_PASS | packed `packages/moss-tts/src/dsh-client.js` | `packages/moss-tts/src/bundled-playback.test.ts` | S | I/L listen later |
| A1-MEM-TURN | SOURCE_PASS | Memory `apply()` `session/event` `turn/end` | `packages/memory/src/turn-pipeline.test.ts` | S | live curator generate still empty without Agent; E2 continues |
| A1-MEM-RECALL | SOURCE_PASS | Memory `agent/pre-step` | `packages/memory/src/turn-pipeline.test.ts` | S | I/L later |
| A1-IM-LIVE | TODO | `LIVE_CHANNEL_IDS`; `PenglaiImHost` send/bind | existing `registry.test.ts` plus production send | none yet | seven platforms not live |
| A2-LEDGER | SOURCE_PASS | `docs/0.5.6/IMPLEMENTATION_LEDGER.md` | this file | reaudit recorded | |

## B — one Main Owner Broker

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| B1-AUTHORITY | SOURCE_PASS | `packages/runtime/src/owner-broker.ts`; `owner-dialog.ts`; `apps/desktop/src/electron-main.ts` | I native dialog click |
| B2-OFFICE | SOURCE_PASS | Office apply/commit/export/return | HMAC sealed |
| B2-MEMORY | SOURCE_PASS | accept/forget/import/delete/personalize | correct still needs follow-up |
| B2-IM | SOURCE_PASS | bind/rebind/remove + host dialog | I, L |
| B2-CENTER | SOURCE_PASS | Plugin Center consumes broker receipt | I |

## C — Artifact Service consumers

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| C1-REF | SOURCE_PASS | `ArtifactRefV1` only; no renderer paths | I later |
| C2-OFFICE | SOURCE_PASS | inspect/commit/export/return ingest ArtifactRef | I later |
| C3-IM | SOURCE_PASS | outbound `sendFileToBoundRoute` ingest | inbound follow-up |
| C4-GC | TODO | workspace delete / TTL | |
| C5-COMPOSER | DEFERRED_UPSTREAM | official chat file Turn | DSH rc.2 has image-only Turn; draft only in `UPSTREAM_ISSUE_DRAFTS.md` |

## D — TTS / ASR

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| D1-ONE-PLAYER | SOURCE_PASS | packed `dsh-client.js` controller now matches TS state machine | still two copies; tests execute packed JS |
| D2-STATE | SOURCE_PASS | ended/error/stalled/abort/latest-wins | I/L |
| D3-PACKED | SOURCE_PASS | `bundled-playback.test.ts` | I asar digest later |
| D4-MIC | SOURCE_PASS | `rewriteElectronPlist` `NSMicrophoneUsageDescription` | I installed plist |
| D5-DEVICE | TODO | installed ASR/TTS | physical user later |

## E — Memory 2.0 automatic

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| E1-MODE | TODO | off / suggest / auto-workspace | product copy |
| E2-INGEST | SOURCE_PASS | Host `turn/end` + `ingestOfficialTurn`; Remote `ingestCurator` sealed | production generate via official Agent still empty when `agents.create` missing |
| E3-RISK | TODO | local policy, not model confidence alone | |
| E4-RECALL | SOURCE_PASS | official `agent/pre-step` | I/L |
| E5-LIVE | TODO | installed DeepSeek | needs no-echo key |

## F — dsh-im 2.1.0

| ID | Status | Remaining |
|---|---|---|
| F1-PROVENANCE | SOURCE_PASS | `docs/0.5.6/provenance/dsh-im-v2.1.0.md` archive SHA-256 `cd468f108a52f503df1dfeb4cbf90ff4565fa836db32f0fb616d43ff799791b6`; MIT; unsigned tag | adapters not yet ported |
| F2-WX-FS | TODO | no regression |
| F3-CONTRACT | TODO | ChannelAdapter |
| F4-BATCH1 | TODO | DingTalk / WeCom / QQ |
| F4-BATCH2 | TODO | Slack / Telegram / Discord |
| F4-BATCH3 | TODO | WhatsApp experimental |
| F5-CONNECT | TODO | one Connect button; no fake QR |
| F6-UI | TODO | user cards |
| F8-LIVE | LIVE_NOT_RUN | no platform accounts |

## G / H / I / J

| ID | Status | Remaining |
|---|---|---|
| G1-START | TODO | installed splash/recovery |
| G2-CENTER | TODO | honest installed/health |
| G3-COPY | TODO | no false “nine platforms live” |
| H1-CI | SOURCE_PASS | `.github/workflows/source-ci.yml` now runs integration/E2E/chaos/deps/licenses/build/pack/clean-clone | GitHub not triggered (no push) |
| H2-EVIDENCE | TODO | installed ≠ source |
| I1-IDENTITY | TODO | still 0.5.5 UNFROZEN |
| I2-ASSETS | TODO | 10-asset contract |
| I3-PROFILE | TODO | profile/closure STALE |
| J1-DMG | TODO | ARM64 DMG |
| J2-ISOLATED | TODO | do not touch user 0.5.5 |
| J3-KEY | OWNER_ACTION_REQUIRED | no-echo TTY only |
| J4-MATRIX | TODO | installed live matrix |
| J5-USER | OWNER_ACTION_REQUIRED | key / listen / speak / optional QR |

## Honest downgrade of Cursor ledger (A2)

Original `docs/0.5.6/IMPLEMENTATION_LEDGER.md` marked many R56 rows `source-pass`. Independent reaudit of production entries at `a818b860`:

| Original ID | Original | Reaudit | Close condition |
|---|---|---|---|
| R56-OWN-001 | source-pass | overclaimed | Office `apply()` must construct and consume Main broker receipts; HMAC `approve()` sealed |
| R56-OWN-002 | source-pass | overclaimed | Memory accept must consume broker receipt, not UUID shape |
| R56-OWN-003 | source-pass | overclaimed | Center disable/rollback must consume broker receipt, not `owncap_` grant |
| R56-MEM-004 | source-pass | overclaimed | ingest must run from official `turn/end`, not test helper |
| R56-MEM-011 | source-pass | overclaimed | recall must enter official `agent/pre-step` |
| R56-MEM-013 | in-progress | still open | N-used wired to official Turn |
| R56-FILE-003 | source-pass | overclaimed as product | Artifact class exists; Office/IM do not depend on or call it |
| R56-VOICE-001 | source-pass | overclaimed | packed `dsh-client.js` is a second player |
| R56-CH-DT..WA | source-pass | overclaimed as live | manifest/guided only; `LIVE_CHANNEL_IDS` is weixin+feishu |
| R56-DIST-* | not-started | accurate | keep |

Do not delete the historical table. This section is the close/reopen record.

## Authorization

Local branch, local commits, local build, isolated Apple Silicon install only.

Forbidden without exact passphrase:

- push / PR: `OWNER_GO_GITHUB_0_5_6`
- real IM account: `OWNER_GO_PLATFORM_LIVE_<CHANNEL>`
- merge / tag / Release / site: `OWNER_GO_PUBLISH_0_5_6`
