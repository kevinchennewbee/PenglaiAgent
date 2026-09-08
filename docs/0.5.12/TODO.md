# Penglai 0.5.12 delivery ledger

Status: active. `[x]` requires implementation and evidence. Unchecked items
remain in scope. Verification results and remaining limitations are appended
to the relevant row; no row is closed by intent or a matching version string.

Base: `origin/main` `87f6aec04b2b77d45a5c2b280d1b75332a80eb33` on
`codex/0.5.12`. Published v0.5.11 installer source
`77e7105773b4d43abb7315ea6e83abe17e646cb4`. Owner `AGENTS.md` /
`docs/0.5.7/RELEASE_RUNBOOK.md` stay uncommitted.

## Foundation

- [ ] F01 Verify repository/HEAD/branch/Owner changes; create `codex/0.5.12`
      without resetting or stashing.
- [ ] F02 Write PLAN/TODO/ACCEPTANCE_DELTA and freeze historical 0.5.11
      snapshots with a final published ruling.
- [ ] F03 Refresh official upstream versions (DSH alpha.2 cohort, Node,
      Electron, Mnemon, Feishu/DingTalk/sherpa/onnxruntime and other
      production deps); record every disposition with registry/source
      evidence. Do not assume package count 254.
- [ ] F04 Freeze the selected DSH/runtime/plugin cohort and
      migration/rollback design; update constitution, D-068, pins and
      0.5.12 acceptance delta atomically.
- [ ] F05 Retitle product identity to 0.5.12 in package manifests,
      `release-contract.json` and installer names. README/website download
      tables stay 0.5.11 until public 0.5.12 bytes exist. Do not rewrite
      v0.5.10 or v0.5.11.
- [ ] F06 Independent Grok 4.6 xhigh review of affected production code
      after repairs; fix findings; re-review.

## Independent audit repairs (must reproduce / adjudicate / fix)

- [ ] I01 `scripts/verify-upgrade-uninstall.mjs` must prove uninstaller
      effect before test cleanup. `removeTreeNoFollow(app)` after `_?=`
      must not delete the whole tree to manufacture `uninstallRemovedApp`.
      A leftover `Uninstall.exe` may be removed as test cleanup only after
      the payload-absence assertion. Evidence must list leftover names.
- [ ] I02 Do not disable Windows Defender realtime monitoring or add
      exclusions to pass native upgrade. Re-verify under a normal security
      configuration. Native run 34151469696 (`defender attempted=true,
      status=0, stdout=True`) is not default-Windows proof.
- [ ] I03 NSIS upgrade copy fallback must be a checked transaction:
      backup success, no mixed-generation tree after copy (purge files not
      in the staged payload), activation/rollback success checks, honest
      failure text. Tests: disk full, file lock, partial copy, activation
      failure, interrupt.
- [ ] I04 Stop only processes whose executable path is under the target
      install root (and data-root-scoped helpers). `/IM Penglai.exe` /
      `/IM "Penglai Helper.exe"` must not kill a foreign instance. Tests
      must use process lists / two roots, not only regex that a dangerous
      command exists.
- [ ] I05 PDF page preview: keep rasters, show them to the user, bind the
      reviewed digest, work on all three packaged targets without system
      PATH `pdftoppm`, enforce timeout/page/byte limits, explicit
      missing/failure. Text must not be treated as image proof.
- [ ] I06 Keep immutable 0.5.11 history. Mark development-tree
      ACCEPTANCE_DELTA/TODO statements as snapshots plus the published
      ruling. 0.5.12 ledger must not contradict published v0.5.11.
- [ ] I07 Full review of 0.5.11 remaining rows and affected first-party
      production code: permissions, Workspace/Session/account/job/action
      ownership, cross-instance cleanup, transaction recovery, IM
      question/approval replay, Memory policy/source/correct/delete,
      Office content integrity, plugin install/select/restart/rollback,
      evidence chain. Repair then re-review.

## Upstream (0.5.12)

- [ ] U01 Official DSH at the latest consumable npm/tag (re-check at
      freeze). 2026-09-08 probe: dist-tags `alpha=0.1.3-alpha.2`,
      `latest=next=0.1.2-rc.1`; GitHub tag `dsh-v0.1.3-alpha.2`
      `82a5fd61a7cf5c293cec4bdff68f455398d685e9`; 242/254 rc.1 names
      exist at `0.1.3-alpha.2`; remaining 12 are vendor/landlock at
      independent versions (still on registry); extra
      `@deepseek-ai/dsh-http-proxy`. Reconstruct the actual graph with
      exact integrity. Do not keep rc.1 only because it is easier.
      A blocker needs evidence and a resolution.
- [ ] U02 Adapt SessionHandle, async `agentLoop.create`, session lock,
      session log v2, persona prefix/suffix, subprocess handle without
      pid, disconnect recovery, long-session behavior. Re-verify first-party
      plugins, Remote, IM, Memory, session projections, Home generation,
      old-session migrate/rollback.
- [ ] U03 Node current 22.22.2 vs official 22.23.2 security release.
      Assess and upgrade if compatible.
- [ ] U04 Electron 43.4.0 vs 43.6.0 (same major) vs 44.2.0. Assess
      security/stability and pick a justified branch.
- [ ] U05 Mnemon 0.2.4 → 0.2.8 (0.2.7 Windows special-character SQLite
      URI). Exact three-target assets, space/CJK/`#`/`%` paths, old-db
      copies, rollback. Mnemon native verification may use existing CI
      Windows runners.
- [ ] U06 Feishu SDK 1.73.0 → 1.73.3, sherpa-onnx 1.13.5 → 1.13.7,
      onnxruntime-node 1.23.2 → 1.29.0, DingTalk and every other production
      dependency: upgrade when compatibility/security justifies it.

## Evidence and normal tests

- [ ] V01 Source gates: format, typecheck, unit, contract, integration,
      E2E, security, chaos, `test:soak`. No two-hour installed soak.
- [ ] V02 versions/identity/contracts/dependencies/licenses/secrets/SBOM/
      notices/cohort/closure/profile/clean-clone.
- [ ] V03 Office-real and Memory-real on a clean tree.
- [ ] V04 Three-target native from one clean `main` SHA after merge.
- [ ] V05 Matching-native fresh/restart/Back/retry/invalid-path/
      credential-recovery/plugin/upgrade/uninstall. Windows upgrade sources
      without Defender weakening; uninstall payload-absence before cleanup.
- [ ] V06 Live model/IM: run when credentials exist; otherwise
      `LIVE_NOT_RUN`. Fixtures are not live PASS.

## README, website, installers and release

Art direction is recorded in `DESIGN.md`. Design is decided here, not by
Owner picking a template. Iterate until visual QA of the real render
passes. Closing a row requires screenshots of the shipped files, not a
mock.

- [ ] D01 README full redesign: English then Chinese; rich product
      narrative; real workflows; official DSH relationship; plugins;
      privacy; install/upgrade/recovery; FAQ; honest limits; real
      screenshots/diagrams; clean three-target download cards. GitHub
      Markdown only. No 0.5.12 download hashes before public bytes.
      Acceptance: GitHub-flavoured render, no overflow of tables on
      common widths, no broken links, before/after capture.
- [ ] D02 `website/` + gh-pages/pages.dev full redesign: mature visual
      direction, real product frames, typography/colour/space, responsive
      desktop and mobile, visible restrained motion (scroll/entrance/
      background) with `prefers-reduced-motion` off-ramp, keyboard
      access, contrast, performance. Preserve official URLs. Downloads
      stay on published v0.5.11 until v0.5.12 readback.
      Acceptance: desktop 1280 and mobile 390 screenshots, keyboard pass,
      reduced-motion pass, no overflow/broken links, live origin
      readback after publish.
- [ ] D03 macOS DMG presentation: window layout, background, icon
      placement, bilingual drag-to-Applications copy. Real
      `package:mac` / `build-local-dmg` output, not a Figma board.
- [ ] D04 Windows NSIS install/upgrade UI: bilingual pages, branding,
      progress, failure copy. Must not regress scoped process stop,
      checked backup/purge/restore, or user-data preservation.
- [ ] D05 Electron first-run wizard: welcome, folder, credentials,
      progress, success, error recovery, Back/retry. Consistent with
      website/README. No leaked technical enums; no skipped Owner
      approvals; no second Agent core.
- [ ] D06 Independent visual QA (Grok 4.6 xhigh general-purpose): if
      presentation is thin, iterate. Do not mark D01–D05 complete on
      intent.

- [ ] W01 superseded by D01; keep this row pointing at D01 until D01
      evidence exists.
- [ ] W02 superseded by D02; keep this row pointing at D02 until D02
      evidence exists.
- [ ] P01 Acceptance delta, release notes, security, upgrade docs.
- [ ] P02 Commits, push, PR, merge; exclude Owner files.
- [ ] P03 Exact contract asset set from accepted native builds.
- [ ] P04 Immutable publication and public-byte readback. Do not rewrite
      v0.5.10 or v0.5.11.
- [ ] P05 Live penglai.pages.dev and GitHub Pages readback for 0.5.12.

## Incremental verification — 2026-09-08 (S1 local checkpoint)

- Git baseline still `codex/0.5.12` / `87f6aec04b2b77d45a5c2b280d1b75332a80eb33`. Owner `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md` remain staged and uncommitted. docs/0.5.11 dirty files stay historical snapshot + published ruling; not rewritten to pass 0.5.12 tests.
- Focused six-file rerun passed (public-docs 7/1 skip, adapter 8, identity 7, home-upgrade 18, leftover 16, license-inventory 2).
- Lock migration leftovers closed in tests/provenance: sherpa runtime `1.13.7` / git `917bed95` (onnxruntime-node remains `1.23.2`); Weixin bot_agent `Penglai/0.5.12`; QQ onboard User-Agent uses `RELEASE`. Electron/Feishu/sherpa already at 43.6.0 / 1.73.3 / 1.13.7 in lockfile.
- Session API on current tree: list/model projections without inspect; resume owned-error reuse/fail-closed; onboarding `snapshotEvents` + `agent/assistant-stream`; budget attempt-stream + message.usage. Replay/owner-remotes SHA is `82a5fd61…`.
- Office jobs bind Workspace/Session at create/edit/remote instead of mutating after insert.
- Poppler pin rewritten to conda-forge 26.09.0 for all three targets; Homebrew/oschwartz zip removed from identity. License exception remains mere-aggregation. Host `pdftoppm` is not three-target native evidence. PDF raster unit test skips unless the target `manifest.json.source` is the pinned conda-forge URL; it does not write `docs/` from a Homebrew keg. Closure dylibs outside the poppler conda package still need fetch-time assembly.
- This checkpoint does not close F03–F06, I01–I07, U01–U06, V01–V06, D01–D06, or P01–P05.

## Incremental verification — 2026-09-08 (I07 scope + session API must-changes)

- Independent reviews reused: `REVIEW_PRODUCTION.md` (GP xhigh completed) and
  `REVIEW_SESSION_API.md` (GP xhigh wrote the file; later cancel did not
  delete it). Design GP was cancelled after editing README/website/wizard;
  `prefers-reduced-motion` exists in site + wizard CSS. Browser visual QA
  still unrun.
- I07: Office `assertJobScope` requires caller Workspace/Session; Remote
  preview/approve/commit declare those fields; tools no longer bind
  `workspace.id === agentId`; Memory/Context same. Tests: office tools +
  remote 22 passed.
- U02 started without falling back to rc.1: persona prefix/suffix
  neutralization; `assistant/attempt` in session fold/budget/onboarding;
  onboarding reads `snapshotEvents()`; listSessions trusts title
  projections; resume maps `SessionAlreadyOwnedError`. DSH source cloned
  at `82a5fd61…`. Pins/lockfile still rc.1 until the atomic cohort write.
- I05 still open for packaged rasters: no Poppler/pdfjs in the payload.
  Text is not treated as an image.

## Incremental verification — 2026-09-08 (Windows I01–I04 source + design addendum)

- Owner presentation addendum recorded as D01–D06 and `DESIGN.md`. Does not replace I/U/V/P rows.
- Independent reviewers relaunched as general-purpose. Child `summary.json` on this restart: model `grok-4.6`, `reasoning_effort=xhigh` for session API, production review, and website/README/wizard design agents.
- I03/I04 NSIS: `PenglaiStopScoped` (ExecutablePath/StartsWith), robocopy `/PURGE`, `upgrade_backup_failed`, verified restore / `upgrade_restore_failed`.
- I01/I02 verifier: `classifyUninstallResidue` before cleanup; no `removeTreeNoFollow(app)`; Defender observed only (`mutated: false`), no realtime disable/exclusions.
- Focused tests: 27 passed (process-scope, uninstall residue, upgrade transaction, installed-walk).
- U01 probe: alpha.2 is on npm; 242 DSH-named packages at `0.1.3-alpha.2`; vendor/landlock remain at independent versions.

## Incremental verification — 2026-09-08 (session start)

- F01: `origin` is `kevinchennewbee/PenglaiAgent`. HEAD was
  `87f6aec04b2b77d45a5c2b280d1b75332a80eb33` on `main`, matching Owner
  pin. Branch `codex/0.5.12` created from that SHA. Staged Owner files
  `AGENTS.md` and `docs/0.5.7/RELEASE_RUNBOOK.md` preserved, not committed.
- I01 reproduced: `scripts/verify-upgrade-uninstall.mjs` after a successful
  uninstaller calls `removeTreeNoFollow(app)` then sets
  `uninstallRemovedApp: true`.
- I02 reproduced: `relaxWindowsInstallLocks` runs
  `Set-MpPreference -DisableRealtimeMonitoring $true` and
  `Add-MpPreference -ExclusionPath`.
- I03 reproduced: NSIS `CopyFiles` backup has no success check; robocopy
  `/E` does not purge old files; activate-failed `RMDir`/`Rename` has no
  success check but claims restore.
- I04 reproduced: NSIS and verify scripts `taskkill /IM Penglai.exe` and
  `Penglai Helper.exe`. Tests in `leftover.test.ts` and
  `installed-walk.test.ts` require those `/IM` strings.
- I05 reproduced: `tools.ts` drops rasters; `pdf-preview.ts` uses
  `which pdftoppm` with no timeout/page cap; office settings UI does not
  show page images; pdf-preview tests only assert text.
- I06 reproduced: `docs/0.5.11/ACCEPTANCE_DELTA.md` still says unmerged /
  unauthorized / public downloads remain 0.5.10 after v0.5.11 publication.
- U01 GitHub: `v0.1.3-alpha.2` released 2026-09-07, short SHA `82a5fd6`;
  `v0.1.3-alpha.1` short SHA `d347e70`. npm graph probe in progress.

## 中文

未勾选项均待完成。历史 0.5.11 开发树文档另行快照+终裁，不在本账本当成
当前未发布状态。公开下载在 v0.5.12 字节回读前仍指向 0.5.11。
