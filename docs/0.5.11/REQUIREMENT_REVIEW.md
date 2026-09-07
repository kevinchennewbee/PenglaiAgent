# Penglai 0.5.11 requirement-by-requirement review

This is a development-branch review of `TODO.md` against the current
`codex/0.5.11` worktree. It is **not** publication authorization and does not
replace `docs/0.5.10/ACCEPTANCE_DELTA.md`.

Checked on 2026-09-07.

- Branch: `codex/0.5.11`
- HEAD: `10ef5df4fc0fbccd2d119dfeecbc8436ccccff01`
- Public identity: **0.5.10** (`package.json`, `RELEASE`, `release-contract.json`)
- Working tree: dirty (111 paths), including owner `AGENTS.md` and
  `docs/0.5.7/RELEASE_RUNBOOK.md`
- Host: Darwin arm64 (Apple Silicon Mac Mini)

Evidence layers used below:

| Layer | Meaning |
| --- | --- |
| source | Tests and scripts against this tree |
| functional-probe | Local Office/Memory helper commands ran, then the official gate refused PASS |
| native | Matching-architecture packaged installer / installed app |
| live | Real model or IM account |
| public | Immutable GitHub Release bytes |

A source PASS never closes a native, live, or public row.

## Foundation

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| F01 | Branch created without reset/stash | source | Owner dirty files still uncommitted by design |
| F02 | `PLAN.md` / `TODO.md` exist | source | — |
| F03 | `UPSTREAM_DECISIONS.md` records retain/reject | source | Recheck at publication freeze |
| F04 | `COHORT_FREEZE.json` + `assertCohortFreeze` | source | Not a public freeze |
| F05 | Public identity kept at 0.5.10 | source | 0.5.11 retitle needs publication authorization |
| F06 | CONTRIBUTING Node/pnpm guidance updated; curator API recorded in `MEMORY_CURATOR.md` | source | Older ARCHITECTURE wording still describes a curator Agent; 0.5.11 source uses `ctx.llm.stream` |

## Security, scope and data integrity

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| A01 | Six SDK channels Owner-peer-gated before DSH | source | Live pairing unrun |
| A02 | Workspace membership required even with a foreign Agent | source | — |
| A03 | Office job ops require Workspace/Session | source | — |
| A04 | Ancestor/canonical deletion tests | source | — |
| A05 | Darwin data-root process cleanup; Windows executable-wide reap removed | source | Windows native helper unrun |
| A06 | Candidate policy before materialization; pending `decide` CAS across store handles | source | — |
| A07 | PDF/OOXML expansion budgets | source | — |
| A08 | Secret scanner URL/detector exemptions fixed | source | — |
| A09 | Digest bindings stay session-scoped | source | — |

## Transactions and lifecycle

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| B01 | Shared Center journal schema 2/3 | source | — |
| B02 | Latest last-good across interrupted txs | source | — |
| B03 | Committed update becomes CURRENT only when version matches/supersedes | source | — |
| B04 | NSIS `$INSTDIR.pending` then `$INSTDIR.previous`; `assertWindowsUpgradeStaging` | source | Not executed on Windows |
| B05 | Two brokers cannot consume one receipt | source | Cross-process native reservations unrun |
| B06 | Late bridge ops generation-gated | source | — |
| B07 | Logout clears credentials and in-flight connects | source | Live reconnect unrun |
| B08 | Telegram keys include chat/route | source | — |
| B09 | Blocked Weixin cursor not persisted; CDN 30s timeout | source | Live Weixin unrun |
| B10 | Newer signed remote preferred; activation hashes staged bytes | source | No live signed newer catalog artifact |
| B11 | Onboarding `resumeOnboardingCurrent` + retryable `lastError` | source | Installed Back/retry is V10 |
| B12 | TTS restore keeps wav, deletes `.part`, bounds ledger | source | Not native audio-device evidence |

## Content and audio

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| C01 | inspect → preview → accept → separately approved save/undo | source | — |
| C02 | DOCX empty paragraphs and table cells | source | — |
| C03 | PDF body no longer silently truncated | source | — |
| C04 | Unicode/space filenames | source | — |
| C05 | moss-en/ja locale; ASR 180s cap unchanged | source | Live voice unrun |
| C06 | TTS output restore | source | Native audio formats unrun |

## First-party 0.5.11 workflows

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| R511-01 | Cohort retain recorded | source | — |
| R511-02a/b | `queryLibrary` + Memory library UI | source | Live conversation library unrun |
| R511-02c | **Open.** Evaluate retain 0.2.4; see `MNEMON.md` | functional-probe | Windows special-character paths, old DB copies, rollback, three-target assets |
| R511-03a/b | Official Weixin/Feishu request identity | source | Live Weixin/Feishu unrun |
| R511-03c | `recoverOfficialTurnDelivery` from snapshotEvents | source | Live crash-window unrun |
| R511-03d | Per-channel capability matrix + `connectionHint` | source | Live proof unrun |
| R511-04a/b | Inflate+ToUnicode inspect; digest-bound PDF preview | source | — |
| R511-04c | Structural preview; spreadsheet `stored-formulas`; image-PPT not-supported | source | — |
| R511-05 | Read-only usage projection; Budget not enabled | source | — |
| R511-06a/b | Catalog/health + redacted diagnostics | source | Live catalog install unrun |
| R511-07 | Workbench deferred; official slots only | record | — |
| R511-UOS | Not a fourth target | record | No UOS hardware |

## Evidence integrity and normal tests

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| V01 | Worst-status slot aggregation FAIL>STALE>NOT_RUN>PASS | source | — |
| V02 | Installed-check version must equal package.json | source | — |
| V03 | Wizard resume writes `status.current` and `lastError` | source | Installed Back/retry is V10 |
| V04 | Official recovery claims/completes/delivers once | source | — |
| V05 | Structural preview asserts document text | source | — |
| V06 | format/typecheck/unit/contract/integration/E2E/security/chaos/soak | source | Last captured: unit 905/1 skip |
| V07 | versions/identity/contracts/deps/licenses/secrets/SBOM/notices/cohort | mixed | closure/profile STALE vs HEAD; clean-clone FAIL on dirty tree |
| V08 | Closed on clean SHA `d7f20c7e` (darwin-aarch64) | functional + packaged | Intel Mac and Windows still V09/V10 |
| V09 | **Open.** No 0.5.11 native builds | — | Needs one clean main SHA on three hosts |
| V10 | **Open.** No matching-native install lifecycle | — | Depends on V09 |
| V11 | **Open.** No live credentials in this session | — | Leave unrun, never fixture PASS |
| V12 | Two-hour soak absent; `test:soak` executed | source | — |

## README, website and release

| Row | Development status | Layer | Remaining gap |
| --- | --- | --- | --- |
| W01–W04 | Bilingual README/`website/` redesigned; downloads remain 0.5.10 | source | Headed browser screenshot capture not required for this record |
| P01 | This review plus `RELEASE_NOTES.md`, `SECURITY.md`, `UPGRADE.md` | source | Not a public 0.5.11 announcement |
| P02 | **Open.** No commit/push/PR authorization | — | Must exclude owner `AGENTS.md` / 0.5.7 runbook |
| P03 | **Open.** No 0.5.11 contract assets | — | Depends on V09 |
| P04 | **Open.** No publication authorization | — | 0.5.10 tags/assets stay immutable |
| P05 | **Open.** Public copy must not claim 0.5.11 downloads | — | After P04 |

## 中文

这是 `codex/0.5.11` 开发分支对照 `TODO.md` 的逐条审查，不是 0.5.11 公开发布授权。
公开产品身份仍是 0.5.10。源码测试不能代替三端安装包、已安装生命周期、真实账号
或 GitHub Release 字节。当前脏工作区禁止官方 Office/Memory PASS、禁止 `package:mac`，
也禁止把缺失的 Intel/Windows/live/publish 写成通过。
