# Penglai 0.5.12 independent production review

Supersession (2026-09-08): Owner deferred packaged I05 PDF page-image
preview and bundled Poppler as **DEFERRED_BY_OWNER / OUT_OF_SCOPE**, not
PASS. Findings below about finishing Poppler packaging are historical and
do not authorize completing that optional component in 0.5.12.

Status: **source review of an in-progress dirty tree**. This is not native,
installed, live-account, or public-release evidence. It does not close any
`docs/0.5.12/TODO.md` row.

Reviewed: 2026-09-08.

- Repository: `origin` `kevinchennewbee/PenglaiAgent` on branch `codex/0.5.12`
- HEAD: `87f6aec04b2b77d45a5c2b280d1b75332a80eb33` (published `main`)
- Dirty in-scope work: Windows I01–I04 helpers/NSIS/verifier plus in-motion
  I05 PDF preview. Owner `AGENTS.md` / `docs/0.5.7/RELEASE_RUNBOOK.md` remain
  staged and were not read as product contract.
- Public identity in pins/`package.json` remains **0.5.11**. NSIS still
  titles 0.5.11. That is correct until F05.
- Native run `34151469696` (Defender `attempted=true, status=0, stdout=True`)
  remains **not** default-Windows proof for 0.5.12.

Method: re-read current files, hunt siblings, distinguish **confirmed**
defects from **suspicion**, and run the in-tree unit tests that exercise
those files. Source tests are not Windows-native evidence.

## Verdict

| ID | Adjudication | State on this tree |
| --- | --- | --- |
| I01 | **Confirmed partial** | Uninstaller effect is classified before deleting `Uninstall.exe`. PASS still does not list leftover names; parent aggregator still hard-codes `uninstallRemovedApp: true`. |
| I02 | **Confirmed partial** | `relaxWindowsInstallLocks` is gone. The verifier only observes Defender and still PASSes if realtime monitoring is already off. |
| I03 | **Confirmed partial** | `/PURGE`, backup existence checks, and honest restore-failed copy exist. Backup completeness is still `Penglai.exe` (+ optional `release-info.json`), not a full tree. Disk-full / lock / interrupt tests are unrun. |
| I04 | **Confirmed partial** | Image-name `/IM` kill is removed from NSIS and the upgrade verifier. NSIS `StartsWith($INSTDIR)` lacks a path boundary. `windows-host.test.ts` still requires `taskkill.exe` and **fails**. Data-root helper stop is not implemented. |
| I05 | **Confirmed open** | Repair is in motion (`publicPdfPreview`, limits, image tool parts). Poppler is not packaged. The new unit test **fails** because missing-raster copy does not match the required “not a page image” language. Three-target rasters are unproven. |
| I06 | **Confirmed partial** | Snapshot headers + D-068 exist. The 0.5.11 body still speaks in present tense as if unpublished. |
| I07 | **Confirmed open** | Office remote preview types `jobId` while the API requires `sessionId`/`workspaceId`. Workspace bind allows `workspace.id === agentId`. Several other confirmed siblings below. |

No I01–I07 row is closed.

## I01 — uninstall proof before cleanup

**Confirmed on published HEAD, repaired in part on this tree.**

Published verifier deleted the whole install tree after `_?=`, then claimed
`uninstallRemovedApp: true`. Current
`scripts/verify-upgrade-uninstall.mjs:302-312` classifies residue first and
fails when payload remains:

```302:312:scripts/verify-upgrade-uninstall.mjs
  const residue = classifyUninstallResidue(listInstallTreeFiles(app));
  if (!residue.payloadRemoved) {
    fail("Windows uninstaller left app payload", {
      leftover: residue.payload.slice(0, 40),
      defender: lastWindowsDefender,
    });
  }
  removeUninstallerResidualOnly(app, residue);
```

`scripts/lib/windows-uninstall-residue.mjs:35-58` treats only
`Uninstall.exe` / `uninstall.exe.nsis` / `uninstall.log` as allowed
uninstaller residue and refuses cleanup unless `payloadRemoved`.
`scripts/lib/installed-app.mjs:236-245` uses the same classifier in fixture
cleanup.

**Confirmed residual**

1. PASS evidence still does not list leftover names. The PASS blob at
   `scripts/verify-upgrade-uninstall.mjs:326-348` sets
   `uninstallRemovedApp: true` and a prose
   `uninstallResidualAllowed` string. Ticket: evidence must list leftover
   names even when the only leftover is `Uninstall.exe`.
2. Parent aggregator `scripts/verify-upgrade-uninstall.mjs:219-225`
   hard-codes `uninstallRemovedApp: true` after child PASS, with no leftover
   array.
3. `listInstallTreeFiles` skips symlinks
   (`scripts/lib/windows-uninstall-residue.mjs:23`). A leftover symlink is
   invisible to the classifier. `waitRemoved` may still catch it; that is
   not the same as listing names.

**Suspicion:** `waitRemoved(app)` after cleanup can still manufacture a
clean tree for the final `removed` check. The payload-absence assertion now
runs first, so this is no longer the original I01 hole.

**How to test**

```bash
node --test scripts/lib/windows-uninstall-residue.test.mjs
```

Required native (unrun here): win32-x64 `verify:upgrade-uninstall` with
`_?=`, assert FAIL when `Penglai.exe` remains, PASS only after
`payloadRemoved` with `leftover: ["Uninstall.exe"]` (or equivalent) in the
JSON, and only then delete `Uninstall.exe`.

## I02 — Defender must stay default-on

**Confirmed on published HEAD, repaired in part on this tree.**

`relaxWindowsInstallLocks` (`Set-MpPreference -DisableRealtimeMonitoring`,
`Add-MpPreference -ExclusionPath`) is gone from
`scripts/verify-upgrade-uninstall.mjs`. Current
`observeWindowsDefender` at lines 132-153 only reads
`DisableRealtimeMonitoring` and always records `mutated: false`.

**Confirmed residual**

1. The verifier does not FAIL when `stdout` is `True`. Native run
   `34151469696` would still be accepted.
2. There is no before/after comparison, so a pre-disabled runner is
   indistinguishable from a default Windows box.
3. No other production script still disables Defender (grep of
   `*.mjs *.ts *.nsi *.ps1 *.yml`). Observation-only is not default-OS
   proof.

**How to test**

```bash
node --test scripts/lib/windows-process-scope.test.mjs
# asserts verifier text does not contain DisableRealtimeMonitoring $true
```

Required native (unrun): matching Windows x64 with realtime monitoring
**enabled** and **no** Penglai exclusion; record `Get-MpPreference` before
and after; FAIL the gate if monitoring is off or an exclusion was added.

## I03 — checked upgrade transaction / no mixed generation

**Confirmed on published HEAD, repaired in part on this tree.**

Current `scripts/nsis/Penglai.nsi`:

| Check | Lines | Verdict |
| --- | --- | --- |
| `CopyFiles` `IfErrors` → `upgrade_backup_failed` | 154-157, 176-182 | Confirmed present |
| Backup must contain `Penglai.exe` | 157 | Confirmed present |
| Optional `resources\release-info.json` echo | 158-160 | Confirmed present, not a full tree |
| robocopy `/PURGE` on both copy fallbacks | 137, 161 | Confirmed present |
| robocopy `$R4 >= 8` → activate-failed | 138, 162 | Confirmed (robocopy bit convention) |
| Restore verifies live `Penglai.exe`; failed restore has distinct copy | 187-201 | Confirmed present |
| Successful rename path does not `/PURGE` (whole pending tree becomes live) | 145-148 | Expected |

`packages/runtime/src/packaging.ts:211-218` and
`scripts/lib/windows-upgrade-transaction.mjs:54-75` encode those tokens.
`scripts/lib/windows-upgrade-transaction.test.mjs` proves a temp mixed
tree is rejected **by the JS helper**, not by executing NSIS.

**Confirmed residual**

1. Backup completeness is `Penglai.exe` plus optional `release-info.json`.
   A partial `CopyFiles` of `resources/runtime` can still pass.
2. Ticket-named tests (disk full, file lock, partial copy, activation
   failure, interrupt) are **unrun**. Current tests are string contracts
   plus a Node temp-dir policy helper that NSIS does not call.
3. `mixedGenerationResidue()` is test-only. Production purge is robocopy
   `/PURGE`. That is acceptable if `/PURGE` actually runs; it is not a
   checked post-copy file list.

**Suspicion:** NSIS `CopyFiles /SILENT "$INSTDIR\*.*" "$INSTDIR.previous"`
can succeed while skipping locked/hidden files without `IfErrors`.

**How to test**

```bash
node --test scripts/lib/windows-upgrade-transaction.test.mjs packages/runtime/src/leftover.test.ts
```

Required native (unrun): compile this `Penglai.nsi` on win32-x64; plant a
stale DLL in live INSTDIR; force the copy fallback; assert the stale DLL
is gone; force backup failure / activate failure / locked `Penglai.exe`
and assert the honest MessageBox plus `penglai-setup.log` phase.

## I04 — instance-scoped process stop

**Confirmed on published HEAD, repaired in part on this tree.**

Removed `/IM Penglai.exe` and `/IM "Penglai Helper.exe"` from NSIS (install
retry + uninstall) and from `reapWindowsInstallTree` /
`verify-upgrade-uninstall.mjs` boot leftover. Current stop:

- NSIS `PenglaiStopScoped` at `scripts/nsis/Penglai.nsi:44-46`
- JS `selectProcessesUnderInstallRoot` + `taskkill /PID` at
  `scripts/lib/installed-app.mjs:56-73` and
  `scripts/lib/windows-process-scope.mjs:11-16`

The JS matcher is boundary-safe (`exe === root || exe.startsWith(root + "\\")`).
The unit test uses two roots
(`Penglai\app\0.5` vs `Penglai-other\app\0.5`) and drops empty
`ExecutablePath` rows.

**Confirmed residual**

1. NSIS PowerShell uses `ExecutablePath.StartsWith($root)` **without** a
   trailing separator (`scripts/nsis/Penglai.nsi:45`).
   `C:\...\app\0.5` matches `C:\...\app\0.50\Penglai.exe` and
   `C:\...\app\0.5-old\Penglai.exe`. The JS helper does not have this bug.
2. `packages/runtime/src/windows-host.test.ts:306` still
   `assert.match(script, /taskkill\.exe/)`. Observed FAIL on this tree.
   `leftover.test.ts` was updated; this sibling was not.
3. Ticket also requires data-root-scoped helpers.
   `commandLineMentionsRoot` is unused.
   `packages/runtime/src/process.ts:119-122` `listDshCandidates` returns
   `[]` on `win32`. `reapDshOrphans` is Darwin-only
   (`process.ts:168-171`). Same executable / different data roots is still
   the 0.5.11 A05 Windows gap.
4. Tests do not spawn two live processes. They use a process-list fixture
   plus regex that a dangerous `/IM` command is **absent**. That is better
   than the old “regex that the dangerous command exists”, but it is not
   two-instance native proof.

**Suspicion:** `leftoversByCommand` (`scripts/lib/installed-app.mjs:76-90`)
still substring-matches command lines. It is no longer the Windows reap
path; it is still used for install-failure lockers and macOS leftover
wait. `Stop-Process -ErrorAction SilentlyContinue` hides access-denied
helpers. Processes with empty `ExecutablePath` are skipped.

**How to test**

```bash
node --test scripts/lib/windows-process-scope.test.mjs packages/runtime/src/windows-host.test.ts apps/desktop/src/installed-walk.test.ts
```

Required native (unrun): two INSTDIR copies, both running `Penglai.exe`;
run upgrade/uninstall against one; assert the foreign PID survives; assert
`0.5` stop does not kill `0.50`.

## I05 — digest-bound, user-visible PDF page images

**Confirmed open.** Repair is in motion and incomplete.

Current `packages/office/src/pdf-preview.ts` no longer uses PATH
`which pdftoppm`. It has page/byte/timeout limits (`PDF_PREVIEW_LIMITS`
lines 9-15), PNG magic checks, explicit `rasterStatus`, and
`publicPdfPreview` (lines 105-138). Conversation tools now keep rasters
and emit `type: "image"` parts (`packages/office/src/tools.ts:199-238`).
Settings copy at `packages/office/src/dsh-client.js:96,112,241` says text
is not a picture.

**Confirmed remaining**

1. `locatePdfRenderer` (`pdf-preview.ts:140-146`) looks next to
   `process.execPath` for `poppler/pdftoppm[.exe]`. No packager, payload,
   or closure script copies Poppler. On this Darwin host the new unit test
   **failed**:

   - test: `packages/office/src/pdf-preview.test.ts:39-57`
   - actual reason: `no bundled pdftoppm; page images are not claimed from text`
   - expected: `/not a page image|unavailable|failed|timeout/i`

   `publicPdfPreview` keeps the engine reason instead of the
   “text is not a page image” fallback when `rasterReason` is already set
   (`pdf-preview.ts:117-123`). The test and the production string disagree.
2. Settings UI still does not **show** rasters. It is a caption
   (`data-penglai-office-pdf-preview`). Ticket: keep rasters and show them
   to the user.
3. Page geometry is still hardcoded `612×792` (`pdf-preview.ts:75-76`).
4. `verify-office-real.mjs` still uses host PATH `pdftoppm`. That is
   Office-real evidence, not packaged three-target proof.
5. No Windows/Intel packaged run. `which` is gone, but bundled binary is
   also gone, so packaged preview is explicit-unavailable on every target.

**Suspicion:** `PENGLAI_PDF_RENDERER` reintroduces a PATH-like escape if a
test or profile points at a system binary. That is acceptable for
harness-only use if packaged runtime never sets it.

**How to test**

```bash
node --import tsx --test packages/office/src/pdf-preview.test.ts packages/office/src/tools.test.ts
```

Required: bundle a pinned Poppler for darwin-arm64, darwin-x64, win32-x64;
assert PNG magic; assert timeout/page/byte limits; assert missing engine
is explicit and never treated as image proof; screenshot the conversation
preview on all three packaged targets.

## I06 — immutable 0.5.11 history vs 0.5.12 ledger

**Confirmed partial.**

Present:

- `docs/0.5.11/ACCEPTANCE_DELTA.md:3-12` snapshot + published ruling
  (`v0.5.11` / `77e7105773b4d43abb7315ea6e83abe17e646cb4`)
- `docs/0.5.11/TODO.md:3-18` closed as publication ledger; leftover rows
  inherited as 0.5.12 / `LIVE_NOT_RUN`
- `docs/0.5.12/ACCEPTANCE_DELTA.md` does not claim 0.5.12 public bytes
- `docs/decisions.md` D-068
- `PRODUCT_CONSTITUTION.md` current-boundary retitle to 0.5.12 development
  with public downloads still 0.5.11

**Confirmed residual:** the 0.5.11 delta **body** still says, in present
tense, that public README/website downloads remain 0.5.10 and that merge /
GitHub Release authorization is absent (`docs/0.5.11/ACCEPTANCE_DELTA.md:18-19`,
`77-85`). The header tells a careful reader those sentences are snapshot
text. A careless reader, or a search hit that skips the header, still
sees “unpublished 0.5.11”.

**Not a product defect:** `leftover.test.ts` “R50-DIST” failed here with
`'0.5.10' !== '0.5.11'` because gitignored
`packages/contracts/dist/index.js` still exports `RELEASE = "0.5.10"`
while `packages/contracts/src/index.ts:27` is `"0.5.11"`. Rebuild dist
before treating that FAIL as an I06 ledger bug.

**How to test:** grep 0.5.11 docs for “unmerged”, “unauthorized”, “remain
0.5.10” **outside** the snapshot banner; compare
`docs/PUBLICATION_MANIFEST_0.5.11.md`. Public README/site must keep 0.5.11
bytes until v0.5.12 readback.

## I07 — remaining 0.5.11 production rows and siblings

Inherited open 0.5.11 rows, still honest:

- `R511-02c` Mnemon Windows special-character / old-db / rollback
- `V11` live accounts → `LIVE_NOT_RUN`

### Workspace / Session / job ownership — **confirmed**

| Location | Issue | Class |
| --- | --- | --- |
| `packages/office/src/tools.ts:31` | `workspaces.find(row => row.sessionIds?.includes(agentId) \|\| row.id === agentId)` binds a Workspace when `exec.agent.id` equals the **workspace id**, not a member Session. Same pattern: `packages/memory/src/tools.ts:31`, `packages/context/src/index.ts:66`. Budget (`packages/budget/src/index.ts:74`) and Memory turn pipeline (`packages/memory/src/turn-pipeline.ts:251`) correctly use membership only. | Confirmed |
| `packages/office/src/service.ts:78-79` | `assertJobScope` is a no-op when `scope` is omitted. | Confirmed |
| `packages/office/src/service.ts:425-429` | in-memory `commit(jobId, receipt)` calls `assertJobScope(record)` with no scope. | Confirmed |
| `packages/office/src/tools.ts:227-229` | tools check `boundJob` then call `svc.preview(jobId)` / `svc.diff(jobId)` **without** scope. Safe only if no other path mutates the job. | Suspicion |
| `packages/office/src/remote.ts:39-50,65-69,125-126` | remote `create`/`edit` do not bind Workspace/Session; remote `preview` then requires both. Jobs created via Remote cannot be previewed. | Confirmed |

**Office remote preview `jobId` vs `sessionId` — confirmed**

```65:69:packages/office/src/remote.ts
    async preview(input: { jobId: string; sessionId?: string; workspaceId?: string }) {
      if (!input.sessionId || !input.workspaceId) {
        throw new PenglaiError("UNAUTHORIZED", "office job is not bound to this Workspace and Session");
      }
      return impl.preview(input.jobId, { sessionId: input.sessionId, workspaceId: input.workspaceId });
```

```124:136:packages/office/src/remote.ts
  preview(input: { jobId: string }) {
    return createOfficeRemoteApi(this.impl).preview(input);
  }
  approve(input: { jobId: string }) {
    return createOfficeRemoteApi(this.impl).approve(input);
  }
  commit(input: { jobId: string; receipt: string }) {
    return createOfficeRemoteApi(this.impl).commit(input);
  }
```

The Typert method types drop `sessionId`/`workspaceId`. The API layer
rejects missing scope. `packages/office/src/office.test.ts:109` only
asserts that `preview({ jobId })` is rejected. There is no test that:

- matching `jobId` + `sessionId` + `workspaceId` succeeds
- a foreign Session is denied
- `jobId` is not accepted as `sessionId`

If Typert forwards extra fields at runtime, a well-formed client can
work. If it serializes only declared fields, every Remote preview is
`UNAUTHORIZED`. Either way the declared contract is wrong.

### IM question / approval replay — **source present, live unrun**

`packages/im/src/official-requests.ts:100-114` rejects answered replay,
expiry, foreign account/peer, and card mismatch. Sequential unit test:
`packages/im/src/official-requests.test.ts:11-104`.

`recoverOfficialTurnDelivery`
(`packages/dsh-bridge/src/plugin.ts:117-177`) plus
`packages/dsh-bridge/src/bridge.test.ts:585-618` prove a closed turn
replays to one outbox id.

**Suspicion:** `answer()` updates `WHERE state='open'` but does not check
`changes`. Two concurrent answers can both return success; only one row
wins. Live Weixin/Feishu remain `LIVE_NOT_RUN`.

### Memory policy / source / correct / delete — **source present, session gap**

Personal promotion is not inferred
(`packages/memory/src/v2/candidates.ts:272-277`,
`packages/memory/src/production-wiring.test.ts:76-100`). Pending CAS:
`packages/memory/src/v2/candidates.test.ts:274-297`. Accept / correct /
forget check **Workspace** (`packages/memory/src/index.ts:237-255`) and
do not check `sessionId` on correct/delete. Candidate digest includes
`sessionId` (`index.ts:186-195`).

**Suspicion:** a Session in the same Workspace can correct/forget another
Session’s memory object if it knows the id. Cross-Workspace is denied.

### Office content integrity — **source present except page images**

Digest mismatch throws (`pdf-preview.ts:47-54`,
`packages/office/src/jobs.ts` preview digest). Tools no longer drop
rasters. Integrity of “page image” is still unavailable without bundled
Poppler (I05). Structural preview still refuses to treat ZIP names as
content (`structural-preview.ts`).

### Plugin install / select / restart / rollback — **source present, live unrun**

`stageRegistryPackage` hashes opened bytes
(`packages/plugin-center/src/remotes.ts:477`). `rollbackLastGood`
(`packages/plugin-center/src/profile-tx.ts:915-958`) restores last-good
**profile**, then reapplies previous enabled/present. Owner proof is
required (`remotes.ts:803-804`). 0.5.11 B10 still holds: no live signed
newer catalog artifact; rollback of an actual newer first-party tarball
is unrun.

### Evidence aggregators — **status aggregation fixed; assertion id sibling remains**

`aggregateSlotEvaluations` ranks FAIL > STALE > NOT_RUN > PASS
(`packages/release-identity/src/evidence-v2.ts:165,193-198`). V2 no
longer takes `usable[0]`.

**Confirmed sibling:** when mixed slots exist, `evaluateEvidenceV2`
still attaches `firstPass.assertionId` to a FAIL/STALE id
(`evidence-v2.ts:350-357`). Status is not hidden; the evidence chain can
still point at a PASS assertion for a failed acceptance id.

### Cross-instance cleanup / transaction recovery

Darwin data-root orphan reap is tested
(`packages/runtime/src/process-isolation.test.ts`). Windows remains
Job-supervisor identity only; `listDshCandidates` is empty on win32
(I04/A05). Center last-good heal is unit-tested
(`packages/plugin-center/src/last-good.test.ts`). NSIS restore path is
source-only (I03).

## Observed unit results on this Darwin host

Command:

```bash
node --import tsx --test \
  scripts/lib/windows-process-scope.test.mjs \
  scripts/lib/windows-uninstall-residue.test.mjs \
  scripts/lib/windows-upgrade-transaction.test.mjs \
  packages/runtime/src/leftover.test.ts \
  packages/runtime/src/windows-host.test.ts \
  packages/office/src/pdf-preview.test.ts \
  packages/office/src/office.test.ts \
  packages/release-identity/src/evidence-v2.test.ts \
  apps/desktop/src/installed-walk.test.ts
```

76 tests: **73 pass / 3 fail**. Failures:

1. `PDF page text is never treated as a page image` —
   `packages/office/src/pdf-preview.test.ts:50` (I05 string mismatch).
2. `R50-DIST: packaged identity is Penglai 0.5.11...` —
   stale gitignored `packages/contracts/dist` still `RELEASE = "0.5.10"`.
   Not an I01–I04 source regression.
3. `NSIS script always preserves user data...` —
   `packages/runtime/src/windows-host.test.ts:306` still requires
   `taskkill.exe` (I04 sibling).

I01–I04 helper tests that were added to `package.json` `test:unit` passed.

## Must-fix before claiming I01–I07 source-complete

1. NSIS `StartsWith` must use a directory-boundary check, matching
   `executablePathUnderRoot`.
2. Update `windows-host.test.ts` (and any other leftover `taskkill.exe`
   token tests) so I04 does not fail the unit gate.
3. Uninstall PASS JSON must list leftover names; parent aggregator must
   not hard-code `uninstallRemovedApp`.
4. Verifier must FAIL when Defender realtime monitoring is off.
5. NSIS backup must verify more than `Penglai.exe`; add real negative
   tests for partial copy / lock / restore failure.
6. Bundle Poppler on three targets; align missing-raster copy with the
   test; show rasters in the user-visible preview, not caption-only.
7. Remote Office preview/approve/commit must declare and enforce
   `jobId` **and** Workspace/Session; add a foreign-session denial test.
8. Remove `row.id === agentId` from Office/Memory/Context tool binding,
   or prove Workspace ids cannot collide with Session ids.
9. Keep 0.5.11 body sentences from being readable as current unpublished
   state (snapshot is not enough if the body is still present-tense).
10. Do not treat native run `34151469696` or this Darwin unit run as
    Windows-default or three-target proof.

## How to re-test after repairs

Source (this Mac, after `pnpm` frozen install if needed):

```bash
pnpm test:unit
pnpm test:contract
pnpm test:e2e
# focused:
node --test scripts/lib/windows-process-scope.test.mjs \
  scripts/lib/windows-uninstall-residue.test.mjs \
  scripts/lib/windows-upgrade-transaction.test.mjs
node --import tsx --test packages/office/src/pdf-preview.test.ts \
  packages/office/src/office.test.ts packages/office/src/tools.test.ts \
  packages/runtime/src/windows-host.test.ts packages/runtime/src/leftover.test.ts
```

Windows x64 native (matching host, Defender default-on, two INSTDIR
roots): compile this NSIS, run `verify:upgrade-uninstall` with
`PENGLAI_LIFECYCLE_ALLOW_NATIVE=1`, prove payload-absence before cleanup,
prove `/PURGE`, prove foreign `Penglai.exe` survives.

Do not disable Defender, do not `/IM` kill, do not rewrite v0.5.10 or
v0.5.11, do not treat fixtures as live PASS.

## 中文摘要

这是 `codex/0.5.12` 脏树上的独立源码审查，不是三端原生或公开发布证据。
I01–I04 已部分落地：卸载先分类残留、不再关 Defender、robocopy `/PURGE`、
按 `ExecutablePath` 停进程。仍不能关账：PASS 证据不列残留名、Defender 已关闭
仍可通过、备份只看 `Penglai.exe`、NSIS `StartsWith` 无路径边界、
`windows-host.test.ts` 仍要求 `taskkill.exe`。I05 正在改但 Poppler 未打进包，
新单测失败。I06 有快照终裁，正文仍用现在时写“未发布”。I07 确认办公 Remote
预览只声明 `jobId`、工具绑定允许 `workspace.id === agentId`。Windows 默认安全
配置与双实例停进程仍未取证。

## Reviewer session identity

Quoted from this reviewer session
`/Users/agent/.grok/sessions/%2FVolumes%2FKevinSSD-in%2Fmacmini%2FPenglaiAgent/01a07fbc-0dd6-76d2-a570-615702d3f8fe/summary.json`:

- `current_model_id`: `grok-4.6`
- `reasoning_effort`: `xhigh`
