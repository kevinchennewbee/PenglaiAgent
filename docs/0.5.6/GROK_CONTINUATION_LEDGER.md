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
| A1-IM-LIVE | SOURCE_PASS | `LIVE_CHANNEL_IDS` weixin+feishu; `sendOutboundText` / bind refuse others | `channel-adapter.test.ts`; `registry.test.ts` | S | LIVE_NOT_RUN |
| A2-LEDGER | SOURCE_PASS | `docs/0.5.6/IMPLEMENTATION_LEDGER.md` | this file | reaudit recorded | |

## B — one Main Owner Broker

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| B1-AUTHORITY | SOURCE_PASS | `packages/runtime/src/owner-broker.ts`; `owner-dialog.ts`; `apps/desktop/src/electron-main.ts` | I native dialog click |
| B2-OFFICE | SOURCE_PASS | Office apply/commit/export/return | HMAC sealed |
| B2-MEMORY | SOURCE_PASS | accept/forget/import/delete/personalize/correct | I later |
| B2-IM | SOURCE_PASS | bind/rebind/remove + host dialog | I, L |
| B2-CENTER | SOURCE_PASS | Plugin Center consumes broker receipt | I |

## C — Artifact Service consumers

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| C1-REF | SOURCE_PASS | `ArtifactRefV1` only; no renderer paths | I later |
| C2-OFFICE | SOURCE_PASS | inspect/commit/export/return ingest ArtifactRef | I later |
| C3-IM | SOURCE_PASS | outbound `sendFileToBoundRoute`; inbound office/pdf/text via `onAdmittedBytes` | images stay official saveImage |
| C4-GC | SOURCE_PASS | `deleteWorkspace` + `gc` WAL checkpoint | I later |
| C5-COMPOSER | DEFERRED_UPSTREAM | official chat file Turn | DSH rc.2 has image-only Turn; draft only in `UPSTREAM_ISSUE_DRAFTS.md` |

## D — TTS / ASR

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| D1-ONE-PLAYER | SOURCE_PASS | packed JS is tested against the TS state machine tokens | still two copies; generation gate in `bundled-playback.test.ts` |
| D2-STATE | SOURCE_PASS | ended/error/stalled/abort/latest-wins | I/L |
| D3-PACKED | SOURCE_PASS | `bundled-playback.test.ts` | I asar digest later |
| D4-MIC | INSTALLED_PASS | installed ARM64 `Info.plist` overwrites Electron's default string with bilingual Penglai copy | device permission click later |
| D5-DEVICE | TODO | installed ASR/TTS | physical user later |

## E — Memory 2.0 automatic

| ID | Status | Production entry | Remaining |
|---|---|---|---|
| E1-MODE | SOURCE_PASS | off / 先询问我 / 智能整理（推荐） | I later |
| E2-INGEST | SOURCE_PASS | Host `turn/end` + `ingestOfficialTurn`; Remote `ingestCurator` sealed | production generate via official Agent still empty when `agents.create` missing |
| E3-RISK | SOURCE_PASS | auto-save uses local classifyMemoryText, ignores model confidence | |
| E4-RECALL | SOURCE_PASS | official `agent/pre-step` | I/L |
| E5-LIVE | TODO | installed DeepSeek | needs no-echo key |

## F — dsh-im 2.1.0

| ID | Status | Remaining |
|---|---|---|
| F1-PROVENANCE | SOURCE_PASS | `docs/0.5.6/provenance/dsh-im-v2.1.0.md` archive SHA-256 `cd468f108a52f503df1dfeb4cbf90ff4565fa836db32f0fb616d43ff799791b6`; MIT; unsigned tag | |
| F2-WX-FS | SOURCE_PASS | existing weixin/feishu tests still pass; not replaced | L |
| F3-CONTRACT | SOURCE_PASS | `packages/im/src/channel-adapter.ts` | |
| F4-BATCH1 | SOURCE_PASS | `@penglai/channel-dingtalk` / `wecom` / `qq`; send refused; not in LIVE_CHANNEL_IDS | inbound/outbox protocol still incomplete |
| F4-BATCH2 | SOURCE_PASS | token adapters; no fake QR | LIVE_NOT_RUN |
| F4-BATCH3 | SOURCE_PASS | WhatsApp experimental, risk ack, no Baileys | LIVE_NOT_RUN |
| F5-CONNECT | SOURCE_PASS | Connect / guided; QR only where protocol has QR | I |
| F6-UI | SOURCE_PASS | platform cards: display name, user status, Connect; diagnostics folded | I |
| F8-LIVE | LIVE_NOT_RUN | weixin/feishu need `OWNER_GO_PLATFORM_LIVE_*`; others no accounts | |

## G / H / I / J

| ID | Status | Remaining |
|---|---|---|
| G1-START | INSTALLED_PASS | isolated from-DMG wizard: welcome → privacy → models → key; welcome ack persisted; recovery not shown; splash already gone at first CDP snapshot |
| G2-CENTER | INSTALLED_PASS | installed inventory: Office+Memory+Center ready, IM/ASR/TTS off | health UI click later |
| G3-COPY | INSTALLED_PASS | wizard did not claim nine live platforms; IM stayed off | |
| H1-CI | SOURCE_PASS | `.github/workflows/source-ci.yml` now runs integration/E2E/chaos/deps/licenses/build/pack/clean-clone | GitHub not triggered (no push) |
| H2-EVIDENCE | INSTALLED_PASS | `test:e2e:installed` from exact ARM64 DMG; identity PASS; verdict INCOMPLETE at API key | live Turn later |
| I1-IDENTITY | SOURCE_PASS | product/package/plugin/welcome/overlay/installer pins are 0.5.6; phase still UNFROZEN | |
| I2-ASSETS | TODO | local ARM64 DMG only; Intel/Windows + remaining metadata assets not built here | |
| I3-PROFILE | SOURCE_PASS | `verify:closure` and `verify:profile` PASS on darwin-aarch64 bound to the DMG source SHA | |
| J1-DMG | INSTALLED_PASS | `dist/Penglai_0.5.6_macos_aarch64.dmg` ad-hoc, not notarized; this Mac is Apple Silicon only | Intel/Windows OWNER_ACTION |
| J2-ISOLATED | INSTALLED_PASS | e2e used `.tmp-installed-e2e`; `dist/Penglai_0.5.5_macos_aarch64.dmg` left untouched | |
| J3-KEY | OWNER_ACTION_REQUIRED | no-echo TTY only; never paste into chat | |
| J4-MATRIX | INCOMPLETE | keyless wizard honest-stop at credential-v1; no nonce Turn | |
| J5-USER | OWNER_ACTION_REQUIRED | key / listen / speak / optional QR | |

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
