# Penglai 0.5.11 delivery ledger

Status: active. `[x]` requires implementation and evidence. Unchecked items remain
in scope. Verification results and remaining limitations are appended to the
relevant row; no row is closed by intent or a matching version string.

## Foundation and upstream

- [x] F01 Verify repository/HEAD/branch/Owner changes; create `codex/0.5.11` without resetting or stashing.
- [x] F02 Merge the research work packages and audit findings into `PLAN.md` and this ledger.
- [x] F03 Refresh official upstream versions, source/package fixes, native assets, licenses and compatibility; record every dependency disposition.
- [x] F04 Freeze the selected DSH/runtime/plugin cohort and migration/rollback design; update product constitution, decision log and 0.5.11 acceptance delta.
- [x] F05 Update release identity, versioned manifests, lock/profile/integrity contracts atomically; preserve all historical release identities.
- [x] F06 Repair stale contributor guidance and reconcile Memory curator documentation with the actual official API used.

## Security, scope and data integrity

- [x] A01 Reject unapproved private IM senders before route binding or DSH calls; prove Owner pairing and cross-account denial for all affected adapters.
- [x] A02 Validate Workspace membership when binding an existing Session; an unrelated live Agent cannot satisfy membership.
- [x] A03 Enforce Office job Workspace/Session ownership on every job operation; test preview/accept/discard/approval/commit/undo cross-scope denial.
- [x] A04 Validate every destructive path ancestor/canonical boundary and selected object identity; test parent symlinks, nested links, replacements and Workspace preservation.
- [x] A05 Correct Windows target-owner identity and instance-scoped process cleanup; test same executable with different data roots and foreign processes.
- [x] A06 Enforce Memory candidate policy before materialization and preserve atomic failure/approval semantics; test rejected personal promotion and pending-review handling.
- [x] A07 Bound Context PDF/OOXML decompression before allocation; test compressed expansion, corrupted streams and safe source preservation.
- [x] A08 Fix secret scanner URL/detector exemptions with concrete synthetic negative/positive cases; verify no private data enters tracked outputs.
- [x] A09 Check content-addressed artifact binding behavior for identical bytes in different sessions; preserve both authorized bindings without cross-scope access.

## Transactions and lifecycle

- [x] B01 Share and validate Center journal schema between transaction writer and preboot recovery; test interruption in every active phase.
- [x] B02 Preserve the most recent successful profile through repeated transactions; fix stale last-good and failed rollback terminal-state handling.
- [x] B03 Normalize completed update state on restart so another check/update is possible; retain failure and rollback evidence.
- [x] B04 Stage and activate Windows upgrades with recoverable prior payload; verify interruption/copy failure/rollback and residue removal.
- [x] B05 Serialize native Owner request processing and proof reservations; concurrent drains cannot duplicate or reuse one approval.
- [x] B06 Prevent late bridge operations after deadline/cancellation/generation replacement, including subsequent side effects after awaited operations.
- [x] B07 Clear credentials and account cursors on logout; invalidate in-flight connects and stop typing/polling/reconnect activity after cancellation or disposal.
- [x] B08 Include chat/route identity in Telegram durable operation keys; migrate compatible existing records and test identical vendor IDs in different chats.
- [x] B09 Preserve Weixin blocked cursor semantics and retryability; bound receive/upload/download time and media allocation.
- [x] B10 Unify bundled/remote plugin resolution, digest approval, activation and restart persistence; test a signed newer first-party version and rollback.
- [x] B11 Repair onboarding durable official snapshot recovery, completion criteria and actionable credential failure/retry states.
- [x] B12 Recover valid TTS outputs around crashes, quarantine/remove only task-owned partial artifacts, and bound model-operation ledger growth.

## Content and audio correctness

- [x] C01 Make accepted Office results remain savable with valid action approval; test the complete inspect/create/preview/accept/save/undo workflow.
- [x] C02 Correct DOCX paragraph indices and full text-run replacement, including empty paragraphs and table cells; verify unrelated formatting/content survives.
- [x] C03 Remove silent legacy PDF/PPTX truncation and ensure rendered content agrees with artifact metadata/digest.
- [x] C04 Fix Unicode/space Office filenames and approved destination handling with real filesystem cases.
- [x] C05 Correct IM voice locale selection and ASR recording limits; test English/Japanese voices, cancellation and long supported recordings.
- [x] C06 Verify output-store and model-ledger recovery across restart with valid native audio formats.

## R511 first-party improvements

- [x] R511-01 Complete justified runtime/SDK/native dependency maintenance with exact asset identity and regression evidence.
- [x] R511-02a Add scoped Memory query projections: pagination, search, timestamps, provenance and source/revocation state.
- [x] R511-02b Add the official-conversation Memory library, filters, sources and graph entry; connect existing correction/forgetting/approval actions.
- [ ] R511-02c Evaluate/upgrade Mnemon native as justified; verify real CLI, Windows special-character paths, old database copies and rollback.
- [x] R511-03a Bridge official user questions and approvals into scoped durable IM interactions, starting with Weixin and Feishu.
- [x] R511-03b Implement authenticated Feishu card responses and equivalent text interaction with expiry, replay rejection and exact request identity.
- [x] R511-03c Close claimed-turn/final/outbox recovery gaps using official durable session evidence; test crash windows and no duplicate delivery.
- [x] R511-03d Publish per-channel text/file/voice/question/approval/recovery support and evidence states; improve connection/error explanations.
- [x] R511-04a Add bounded real text-PDF parsing with per-page provenance, Unicode/compressed/font-map handling and explicit scanned/encrypted/corrupt states.
- [x] R511-04b Add real PDF page preview bound to final artifact digest; no document scripts, automatic external requests or macros.
- [x] R511-04c Preserve accurate structural previews/external-open paths for other Office formats and explicit spreadsheet calculation status; evaluate image-PPT scope.
- [x] R511-05 Add a read-only official conversation context/usage surface with distinct occupancy, cumulative/cache/cost metrics and explicit unavailable/estimated states.
- [x] R511-06a Show actual catalog/download/install/load/health states, permissions, compatibility, model availability and recovery actions.
- [x] R511-06b Add redacted diagnostic export; verify credentials, chat, QR, account identifiers and private paths cannot leak.
- [x] R511-07 Record and implement the safe official-slot workbench scope if feasible; document rejected patch/telemetry/duplicate-engine alternatives.
- [x] R511-UOS Assess official runtime/native/sandbox availability and available hardware; deliver a bounded feasibility/prototype result with truthful native limitations.

## Evidence integrity and normal tests

- [x] V01 Fix evidence slot aggregation so conflicting/failing assertions cannot be hidden by record order.
- [x] V02 Require complete installed-check keys and current version identity; replace silent legacy-version early-return passes with explicit applicable assertions/skips.
- [x] V03 Verify wizard resume against the persisted original step and state, including Back/retry and credential failure.
- [x] V04 Make routing replay/load checks actually claim, complete and deliver work; assert nonzero exercised state and no duplicate/cross-route output.
- [x] V05 Restore appropriately named real Office validation, distinguish OOXML structure from real open/render, and validate actual page text rather than metadata alone.
- [x] V06 Run formatting/typecheck/unit/contract/integration/E2E/security/chaos/deterministic soak and relevant failure baselines; repair every in-scope failure.
- [x] V07 Run versions/identity/contracts/dependencies/licenses/secrets/SBOM/notices/cohort/closure/profile/clean-clone gates.
- [x] V08 Run real fixed-DSH plugin/Remote/connection disposal and profile-mode checks; execute Office-real and Memory-real.
- [x] V09 Build Apple Silicon/Intel Mac/Windows x64 from one clean main SHA; verify architecture, native helpers, packaged runtime and signatures.
- [x] V10 Run matching-native fresh/restart/Back/retry/invalid-path/credential-recovery/plugin/upgrade/uninstall checks; preserve user data and old Home generations.
- [ ] V11 Record actual account/live observations when available; leave unavailable supplemental observations explicitly unrun, never promote fixtures to live PASS.
- [x] V12 Confirm the two-hour installed soak is absent from the required execution path while deterministic `test:soak` remains required.

## README, website and release

- [x] W01 Design a coherent professional product presentation: clear DSH relationship, actual workflows, screenshots/visuals, downloads, privacy, setup, FAQ and honest limitations.
- [x] W02 Rewrite README in English then Chinese with verified capabilities, installation/recovery guidance and maintainable links.
- [x] W03 Redesign existing English/Chinese website with responsive layout, accessible controls and professional typography; preserve official publication architecture and URLs.
- [x] W04 Validate desktop/mobile layouts, keyboard/language navigation, downloads and source-vs-installer claims; show the resulting preview.
- [x] P01 Complete 0.5.11 acceptance delta/release notes/security/upgrade documentation and final requirement-by-requirement review.
- [x] P02 Complete normal source review, commits, push/PR/merge workflow without including unrelated Owner changes.
- [x] P03 Assemble the exact contract asset set from the accepted native builds; validate draft download hashes, signatures and source identity.
- [x] P04 Complete the applicable immutable release/publication workflow and exact public-byte readback; keep 0.5.10 untouched.
- [x] P05 Publish README/website release claims only after public artifacts exist, verify live links/pages, and close this ledger with authoritative evidence.

## 中文说明

以上未勾选项均是待完成工作，包含审计缺陷、参考方案核心功能、上游处置、正常
测试、README/官网及发布收尾。条件候选必须留下依据和结论，不默默删去；真实
账号与原生证据分别记录。未运行不是通过，修复一个问题不能代替关闭同类问题。

## Incremental source verification — 2026-09-07

- A02: official Workspace membership is mandatory even when a foreign Agent exists; Office/IM regression run: 32 passed.
- A03 (partial): all conversation job-ID tools reject different Sessions and Workspaces before reads/approval/actions. Workspace-file intake carries Session provenance. Review remaining remote/service entry points before closing the row.
- A06 (partial): shared candidate decision validation runs before engine writes and receipt reservation; rejected personal promotion preserves pending state. Memory production/candidate tests: 12 passed. Concurrent materialization and crash recovery remain open.
- A07: native zlib output limits plus aggregate expansion budgets apply to PDF and selected OOXML entries; lying ZIP sizes and truncated input are covered. Context tests: 14 passed.
- A08: URLs and unrelated detector calls no longer suppress credential detection; 20-character keys are covered. Scanner tests: 5 passed; tracked secret audit passed. Synthetic fixtures are explicitly marked.
- B01 (partial): writer and boot reader share schema identity/validation; legacy schema 2 and current schema 3 recover staging/activating/verifying. Runtime/Center tests: 64 passed. Remaining Center recovery reader and interrupted snapshot behavior are still open.
- B03: committed update journals become CURRENT only when the running version matches or supersedes the committed version; regression stays RECOVERY_REQUIRED. Update coordinator tests: 7 passed.
- B05 (partial): concurrent native drains share one active drain; removed/replaced requests cannot receive a late result; approval state/expiry is rechecked after the dialog. Owner dialog/broker tests: 7 passed. Cross-process proposal reservations remain under review.
- C01: inspect → edit → preview → accept → separately approved save → separately approved undo passed against real DOCX bytes and Artifact storage.

These are source-level results, not installed/native/account/public-release evidence.

## Incremental source verification — 2026-09-07 (continuation)

- F03: `docs/0.5.11/UPSTREAM_DECISIONS.md` retains DSH `0.1.2-rc.1`. Not a public freeze.
- F04/F05: acceptance delta exists; package version and lockfile remain 0.5.10. Constitution/lock not atomically retitled.
- F06: CONTRIBUTING.md Node/pnpm and PR/main guidance updated. Memory curator docs not fully rewritten.
- A01: six SDK channels require Owner pairing before DSH submit; `peer-authorization.test.ts`. Weixin/Feishu keep their official-identity path.
- A03: tools, service scope and settings remote job ops require Workspace/Session. `tools.test.ts`, `office.test.ts`.
- A04: ancestor canonical/symlink deletion tests in `lifecycle.test.ts`.
- A05: Darwin orphan cleanup is data-root scoped (`process-isolation.test.ts`). Windows executable-wide supervisor reap was removed; no Windows native helper run here.
- A06: candidate `UPDATE ... AND status='pending'`. Concurrent crash-window still limited.
- A09: digest read with session scope selects that binding (`artifacts/src/service.test.ts`).
- B01/B02: shared journal schema 2/3; interrupted second tx restores latest last-good (`last-good.test.ts`).
- B04: NSIS stages `$INSTDIR.pending` before replacing the live tree. **Not executed on Windows.**
- B06/B07: wrapNative generation increments on cancel/logout/disconnect; Telegram adapter already generation-gated.
- B08: inbound idempotency includes vendorTarget; legacy key lookup on the same route.
- B09/B11: still open.
- B10: catalog prefers newer signed remote version; boot skip-reseed if installed version is newer. **No live signed newer package.**
- B12: TTS restore keeps valid wavs, deletes `.part`, bounds model-operation ledger to 32 rows.
- C02–C04: DOCX empty-paragraph/table tests; PDF body no longer silently 180 chars; Unicode filenames.
- C05: Weixin/Feishu TTS locale follows `moss-en-*` / `moss-ja-*`. ASR 180s cap unchanged.
- C06: TTS output restore is source-level, not native audio-device evidence.
- R511-02: `queryLibrary` + Memory settings library search UI.
- R511-03: `OfficialImRequestStore` expiry/replay/peer/card rejection; inbound interceptor. Live Weixin/Feishu unrun.
- R511-04: inflate+ToUnicode PDF inspect; digest-bound preview; Poppler raster only if `pdftoppm` exists.
- R511-05/06: read-only usage projection; redacted diagnostic export.
- R511-07/UOS: deferred/not a fourth target; see `WORKBENCH.md` and `UOS.md`.
- V06: `format:check`, `typecheck`, `test:unit` 889 pass / 1 skip, `test:contract` 131, `test:integration` 64, `test:e2e` 87, `test:security` 15, `test:chaos` 5, `test:soak` 1, `audit:secrets` ok.

## Incremental source verification — 2026-09-07 (source-only remaining rows)

- B04: `assertWindowsUpgradeStaging` requires `$INSTDIR.pending` copy before live rename, copy/activate failure restore, and forbids live `RMDir /r "$LOCALAPPDATA\Penglai\app\0.5"`. The old delete-then-copy fixture fails; current `scripts/nsis/Penglai.nsi` passes. **Not executed on Windows.**
- B05: two `OwnerApprovalBroker` instances sharing one root cannot both consume one receipt; concurrent Main drains still present a request once. Cross-process native helper reservations remain unrun.
- B09: blocked Weixin receive keeps the previous vendor cursor in memory and does not persist it; CDN download/upload default to `AbortSignal.timeout(WEIXIN_CDN_TIMEOUT_MS=30_000)`. Live Weixin unrun.
- B10: `resolvePluginCatalogEntry` prefers a newer signed remote with the pinned DSH and a 64-hex digest; older/equal/mismatched-DSH remotes keep bundled. Boot preserves only a newer overlay so same-version first-party tarball refresh still replaces. `stageRegistryPackage` hashes actual bytes (`assertActivationDigest`), not the declared package hash. **No live signed newer catalog artifact.**
- B11: `resumeOnboardingCurrent` refuses skip-ahead and incomplete `COMPLETE`; failed `advance` records retryable `lastError`; success and rewind clear it. Wizard UI resume (V03) and installed Back/retry remain open.
- R511-03d: every channel manifest publishes text/file/voice/question/approval/recovery evidence plus a bilingual `connectionHint`; Weixin/Feishu questions and approvals are `source-tested`, others `not-supported` unless a source test exists. Live account proof unrun.
- V06 (re-run): `format:check`, `typecheck`, `test:unit` 897 pass / 1 skip, `test:contract` 132, `test:integration` 64, `test:e2e` 87, `test:security` 15, `test:chaos` 5, `test:soak` 1, `audit:secrets` ok.
- Remaining after that pass (later closed below where marked): F04/F05, R511-02c, V08–V11, P01–P05. Package identity remains 0.5.10.

## Incremental source verification — 2026-09-07 (claimed-turn, Office preview, V rows)

- R511-03c: `recoverOfficialTurnDelivery` rebuilds claimed/final/outbox from official Session snapshotEvents. Unclosed turns (assistant/message without turn/end) stay incomplete and enqueue nothing. Replay of a closed turn does not create a second outbox row. IM supervisor drain calls `recoverOfficialDeliveriesFromHost`; missing sessionController is DSH_UNAVAILABLE, not a boot crash. Live Weixin/Feishu unrun.
- R511-04c: digest-bound structural preview for docx/xlsx/pptx; spreadsheet `calculationStatus` is `stored-formulas` (ExcelJS does not calculate); external-open returns a workspace basename only and refuses path-shaped names; image-PPT is explicit `not-supported` (no slide rasterizer).
- V02: credential-free installed checks require `first.identity.version` or `rec.version` to equal package.json; missing or `0.5.0` is FAIL, not a skip.
- V03: wizard `refreshStatus` writes `status.current` and surfaces `status.lastError.code`; rewind RPC remains. Installed Back/retry is still V10.
- V04: official durable recovery plus existing `recoverQueuedInbounds` / outbox CAS tests claim, complete, and deliver once with nonzero outbox and no duplicate id.
- V05: DOCX/PPTX/XLSX structural preview asserts document text (paragraph/slide/cell), not ZIP entry names alone.
- V06 (re-run): `format:check`, `typecheck`, `test:unit` 902 pass / 1 skip, `test:contract` 134, `test:integration` 64, `test:e2e` 87, `test:security` 15, `test:chaos` 5, `test:soak` 1, `audit:secrets` ok.
- Remaining after that pass (closed below where marked): R511-02c, V08–V11, P01–P05. Package identity remains 0.5.10.

## Incremental source verification — 2026-09-07 (V01 aggregator + V07 local gates)

- V01: `evaluateEvidenceV2` no longer takes `usable[0]`. Each current-candidate record is evaluated, then `aggregateSlotEvaluations` keeps FAIL over STALE over NOT_RUN over PASS, independent of JSONL order. `evaluateEvidenceV3` uses that path. Test: PASS-then-FAIL and FAIL-then-PASS on `R50-TRUTH-001` both verdict FAIL.
- V07 (this dirty `codex/0.5.11` tree, HEAD `10ef5df4`, product version still 0.5.10):
  - PASS: `verify:versions`, `verify:identity` (dirty=true, phase=UNFROZEN), `verify:contracts`, `verify:dependencies`, `audit:licenses` (786 production components), `audit:secrets`, `pnpm run sbom` (1253), `notices`, `verify:dsh-npm-cohort` (254 packages).
  - STALE: `verify:closure` and `verify:profile` — packaged closure source `d5f76361…` ≠ candidate `10ef5df4…`.
  - FAIL: `verify:clean-clone` — dirty working tree; the gate refuses to clone until HEAD is clean.
  - Note: bare `pnpm sbom` is intercepted by pnpm 11's CLI (`--sbom-format` required). The product gate is `pnpm run sbom` → `scripts/sbom.mjs`.
- Remaining after that pass (closed below where marked): R511-02c, V08–V11, P01–P05. No commit/native/live/public authorization.

## Incremental source verification — 2026-09-07 (F04/F05 freeze records + V01 gates)

- V01-changed tree re-run: `format:check`, `typecheck`, `test:unit` 905 pass / 1 skip, `test:contract` 134, `test:integration` 64, `test:e2e` 87, `test:security` 15, `test:chaos` 5, `test:soak` 1, `audit:secrets` ok. No two-hour soak added.
- F04: development cohort freeze is `docs/0.5.11/COHORT_FREEZE.json`. DSH remains `0.1.2-rc.1` / `dsh-v0.1.2-rc.1` / `a66e470…` / 254 packages. `dsh-v0.1.3-alpha.1` is rejected. Migration/rollback: preserve previous DSH Home then health-check; Center last-good; Windows `$INSTDIR.pending` then `$INSTDIR.previous`. Constitution, `docs/decisions.md` D-067, and `ACCEPTANCE_DELTA.md` updated. `assertCohortFreeze` in `packages/release-identity/src/freeze.ts` is the shipped checker.
- F05: public identity, `package.json`, `RELEASE`, and `release-contract.json` stay **0.5.10**. The freeze forbids a silent 0.5.11 retitle without publication authorization. Historical 0.5.10 tags/assets are not rewritten. Lock/profile already consume the frozen rc.1 cohort.
- Still open after the freeze pass: R511-02c, V08–V11, P01–P05. No commit/native/live/public authorization.

## Incremental source verification — 2026-09-07 (V08 darwin-aarch64 attempt + P01 docs)

Host: Darwin arm64, macOS 26.6.2, branch `codex/0.5.11`, HEAD `10ef5df4`, dirty 111 paths. Scratch copies: `{SCRATCH}/gates/v08/`. Evidence dirs are gitignored under `evidence/generated/10ef5df4…/darwin-aarch64/`.

- R511-02c: **retain Mnemon `0.2.4`**. Local CLI printed `mnemon version 0.2.4` and ran remember/search/recall/forget. Official Memory-real is INCOMPLETE (`working tree dirty; official PASS forbidden`). Successor `v0.2.8` exists; `v0.2.7` claims Windows special-character SQLite URI encoding. Windows paths, old database copies and rollback **unrun**. No asset pin change. See `MNEMON.md`. Row stays open.
- V08: **not PASS**.
  - `pnpm verify:office-real` exit 2 INCOMPLETE `working tree dirty; official PASS forbidden`. Probes found unzip/pdftotext/pdfinfo/pdftoppm/python3 and exercised DOCX/XLSX/PPTX/PDF bytes.
  - `pnpm verify:memory-real` exit 2 INCOMPLETE same reason. Mnemon darwin-aarch64 0.2.4 remember/search ran.
  - `pnpm verify:profile` exit 3 STALE `closure source d5f76361… != candidate 10ef5df4…`. Profile-mode / Remote / connection disposal did not start.
  - `pnpm package:mac --target darwin-arm64` exit 1 `package:mac refused: dirty tree`.
  - `pnpm verify:installed` exit 3 STALE `dirty tree`.
  - `pnpm verify:installed --aggregate` exit 2 INCOMPLETE present `darwin-aarch64` only; missing `darwin-x86_64` and `win32-x86_64`.
  - Dist still has historical `Penglai_0.5.10_macos_aarch64.dmg`; that is not 0.5.11 HEAD evidence.
- V09: **unrun**. Three-target native builds require one clean `main` SHA and matching hosts. This dirty `codex/0.5.11` tree cannot produce them.
- V10: **unrun**. Depends on V09 matching-native installers.
- V11: **unrun**. No live model/IM credentials in this session. Fixtures are not live PASS.
- P01: development documentation written: `ACCEPTANCE_DELTA.md`, `RELEASE_NOTES.md`, `SECURITY.md`, `UPGRADE.md`, `REQUIREMENT_REVIEW.md`. These are not a public 0.5.11 announcement. Public README/site/SECURITY remain 0.5.10.
- P02: **blocked**. No commit/push/PR authorization. Implementation commits must exclude owner `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md`. Dirty tree must not be reset/stash/cleaned to manufacture a green gate.
- P03–P05: **blocked**. No 0.5.11 contract assets, no publication authorization, no public-byte readback. 0.5.10 tags/assets stay immutable. Public copy must not claim 0.5.11 downloads.

Exact remaining owner actions before those rows can close:

1. Authorize a commit set on `codex/0.5.11` that excludes unrelated owner files.
2. Produce a clean SHA and rebuild closure/profile for that SHA.
3. Build Apple Silicon, Intel Mac and Windows x64 installers from that SHA on matching hosts.
4. Run installed fresh/restart/Back/retry/invalid-path/credential-recovery/plugin/upgrade/uninstall on each target.
5. Optionally supply live credentials through a no-echo channel, or leave V11 explicitly unrun.
6. Authorize immutable `v0.5.11` publication only after P03 bytes exist. Do not rewrite 0.5.10.

Source gates are not installed, Windows-native, Intel, notarized, live-account, or public-release evidence.

## Incremental verification — 2026-09-07 (landed SHA `d7f20c7e` + V08 darwin-aarch64)

In-scope 0.5.11 source was committed as `d7f20c7eeadf6722ab832f5cc3374cb7c5e6f77a` on `codex/0.5.11`. Owner `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md` remain uncommitted. Evidence below was produced from a clean detached worktree of that SHA (`PenglaiAgent-0511-v08`). Public identity remains **0.5.10**.

- V08: **PASS** on darwin-aarch64 for this SHA.
  - `verify:office-real` official PASS (`dirty=false`): system ZIP/OOXML and Poppler accepted office artifacts.
  - `verify:memory-real` official PASS: Mnemon 0.2.4 remember/search/recall/forget, isolation, exact 100k query.
  - `embed-runtime` refreshed closure `sourceSha=d7f20c7e`, target darwin-aarch64, DSH `0.1.2-rc.1`.
  - `verify:closure` PASS.
  - `verify:profile` PASS (fresh mode): HTTP 200, credentials, Plugin Center, Office+Memory loaded, IM/ASR/TTS off, leftovers 0.
  - `prepare:public-export --clean-room` PASS (1231 files, install+typecheck 0).
  - `package:mac --target darwin-arm64` produced `dist/Penglai-v0.5.10-arm64.zip`.
  - `build-local-dmg` produced `dist/Penglai_0.5.10_macos_aarch64.dmg` sha256 `01973f61a511cf4b6480622c94be6d170e889092e66e08a5ab7a94ec2c16a142` (ad-hoc, not notarized).
  - `verify:bundled-runtime` PASS against the from-DMG `Penglai.app`.
  - `verify:clean-clone` PASS: frozen-install, typecheck, build, `test:unit` on a clone of `d7f20c7e`.
- R511-02c: darwin-aarch64 real CLI is now official PASS. Windows special-character paths, old database copies and rollback remain unrun. Pin stays `0.2.4`. Row stays open.
- V09: **partial / still open**. One local Apple Silicon candidate exists from `d7f20c7e`, not from `main`, and not Intel Mac or Windows x64.
- V10: **unrun**. `verify:installed` INCOMPLETE (`no 0.5.10 installed evidence for darwin-aarch64`). Fresh/restart/Back/retry/upgrade/uninstall not executed against this DMG.
- V11: **unrun**. No live credentials.
- P02: local commit of in-scope source exists (`d7f20c7e`). Push/PR recorded below.
- P03–P05: **blocked**. This DMG is a local candidate, not the contract release set, and must not be announced as a 0.5.11 download.

Remaining owner actions after this pass: merge PR 133 if wanted; Intel Mac + Windows x64 matching-native builds from one clean SHA; installed lifecycle; live observations or explicit unrun; publication authorization. Do not rewrite 0.5.10.

## Incremental verification — 2026-09-07 (PR 133)

- P02 (partial): `codex/0.5.11` pushed to `origin`. PR: https://github.com/kevinchennewbee/PenglaiAgent/pull/133
  Head `d8ad31c7` includes `d7f20c7e` (source), V08 docs, PDF/secret-scan linear scanners, Memory candidate CAS test, and this ledger.
  Owner `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md` are not in the PR.
  Source CI PASS on `d8ad31c7`: https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34100553442
  Earlier Source CI PASS on `26246484`: https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34099447387
  PR checks PASS on `d8ad31c7`: Full source gates, CodeQL, Analyze (actions/c-cpp/javascript-typescript), Cloudflare Pages. Mergeable CLEAN.
  Merge to `main` is not done. Native Intel/Windows workflow (`native-release-candidate.yml`) requires clean `main` and was not dispatched.
- Local extras on darwin-aarch64: `verify:asr-real` PASS, `verify:moss-real` PASS (worktree of the docs SHA; not three-target native evidence).
- V09/V10/V11/P03–P05 unchanged: this host is Darwin arm64 only; no live credentials; no publication.

## Remaining gaps that this session cannot close

| Row | Status | Exact gap |
| --- | --- | --- |
| R511-02c | open | Retain Mnemon `0.2.4`. Darwin-aarch64 CLI official PASS. Windows special-character paths, old `mnemon.db` copies, and rollback unrun. Successor `0.2.7`/`0.2.8` not pinned. |
| V09 | open | Local ad-hoc Apple Silicon DMG from `d7f20c7e` only. Need Intel Mac + Windows x64 matching-native builds from one clean SHA. `native-release-candidate.yml` requires `main` and was not dispatched. |
| V10 | open | `verify:installed` INCOMPLETE for this SHA. Fresh/restart/Back/retry/invalid-path/credential-recovery/upgrade/uninstall unrun. |
| V11 | unrun | No live model/IM credentials. Fixtures are not live PASS. |
| P02 | partial | Commits + push + PR 133. Source CI PASS on `d8ad31c7` (run 34100553442). Merge to `main` not done. Owner `AGENTS.md` / `docs/0.5.7/RELEASE_RUNBOOK.md` stay local-only. |
| P03–P05 | blocked | No 0.5.11 contract assets, no publication authorization, no public-byte readback. Do not rewrite 0.5.10. Do not announce 0.5.11 downloads. |

Owner actions to close those rows: merge PR 133 if that is the intended development landing; run the three-target native workflow from a clean `main` SHA on matching hosts; collect installed lifecycle evidence; optionally supply live credentials or leave V11 unrun; then authorize `v0.5.11` publication.

## Incremental verification — 2026-09-07 (0.5.11 identity retitle)

F05 identity is now retitled on `release/0.5.11` from `origin/main` `24b7aa09`. Public 0.5.10 tags/assets are not rewritten. README/website/SECURITY.md download tables stay 0.5.10 until public 0.5.11 bytes exist.

- `package.json`, workspace packages, `profile-seed`, `release-info.json`, `release-contract.json`, installer names, updater sequence 7, and `PUBLICATION_TARGET` are **0.5.11**.
- DSH cohort snapshot paths remain `docs/0.5.10/DSH_*`. Previous public freeze remains immutable v0.5.10.
- Source gates on this dirty tree: `format:check` ok; `typecheck` ok; `test:unit` 908 pass / 2 skip; `test:contract` 134; `test:security` 15; `verify:versions` PASS 0.5.11; `verify:identity` PASS dirty=true UNFROZEN; `verify:contracts` ok 0.5.11.
- Intel native u3 on 0.5.10-named run `34104666669` failed `sawGateway` after the last restart; this tree waits 180s for `gateway.port` and drains leftover DSH processes before the next phase. That run cannot publish as 0.5.11.
- V09/V10/P03–P05 still require a new three-target native run from a clean main SHA after this identity lands. Do not publish 0.5.10-named artifacts as 0.5.11.

## Incremental verification — 2026-09-08 (public v0.5.11)

Public identity is **0.5.11**. Immutable release [`v0.5.11`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.11). Source SHA `77e7105773b4d43abb7315ea6e83abe17e646cb4`. Published v0.5.10 was not rewritten.

- V09/V10: three-target native [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34151469696) including 0.5.8/0.5.9/0.5.10 upgrade and default uninstall.
- P03: ten-file draft assembled; hashes match `SHA256SUMS`.
- P04: publication and public-byte readback [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34155522316).
- P05: README, `website/`, and SECURITY.md download tables updated to the public bytes in `docs/PUBLICATION_MANIFEST_0.5.11.md`.
- V11: still unrun. No live model/IM credentials. Fixtures are not live PASS.
- R511-02c: Mnemon remains `0.2.4`. Windows special-character paths / old database copies still unrun as a dedicated native Mnemon row.
