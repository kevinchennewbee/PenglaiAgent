# Penglai 0.6.0 delivery ledger

Status: active. `[x]` requires implementation and evidence. Unchecked items
remain in scope. Verification results and remaining limitations are appended
to the relevant row; no row is closed by intent or a matching version string.

Base: `origin/main` `c3ea3f08822386a0345e8c1900368041302a839c` on
`grok/0.6.0`. Worktree `/private/tmp/penglai-0.6.0`. Published v0.5.12
installer source `54a0ef30afa4e3d653e400a637d4aa8eb4abbb75`. Owner
`AGENTS.md` / `docs/0.5.7/RELEASE_RUNBOOK.md` stay uncommitted in the
public checkout.

## Foundation

- [x] F01 Verify repository/HEAD/branch/Owner changes; create `grok/0.6.0`
      without resetting or stashing. Evidence: public root remains
      `52306234` with staged blobs `42611ef4` / `7057aec4`; worktree HEAD
      `c3ea3f08`; PR #167 squash-merged.
- [x] F02 Write PLAN/TODO/ACCEPTANCE_DELTA and freeze historical 0.5.12
      as immutable public ruling. 0.6.0 ledger must not contradict
      published v0.5.12. Evidence: `docs/0.6.0/*`, D-070.
- [ ] F03 Refresh official upstream (DSH 0.1.5-alpha.1 cohort, DSH IM
      4.17.1, Node/Electron/Mnemon/production SDKs). Record every
      disposition with registry/source evidence. Do not assume package
      count 254 or 263.
- [ ] F04 Freeze the selected DSH/runtime/plugin cohort and
      Session V3 / Home migrate/rollback design; update constitution,
      D-070, pins and 0.6.0 acceptance delta atomically.
- [x] F05 Retitle product identity to 0.6.0 in package manifests,
      `release-contract.json` and installer names (four targets including
      `Penglai_0.6.0_uos_loong64.deb`). README/website download tables stay
      0.5.12 until public 0.6.0 bytes exist. Do not rewrite v0.5.10,
      v0.5.11, or v0.5.12.
- [ ] F06 Independent Grok 4.6 xhigh review of affected production code
      after repairs; fix findings; re-review.

## Live 0.5.12 repairs carried into 0.6.0

- [ ] L01 Custom-model image input: write official DeepSeek
      `llm-deepseek` `inputModalities`. Unknown/custom models default to
      text. No model-id regex. Settings UI toggle. Tests fail if vision is
      inferred from the id.
- [ ] L02 AUTH 401 / official `AUTH` turn failure is `UNAUTHORIZED` so
      the wizard shows `errorAuth`, not generic `INVALID_INPUT`.
- [ ] L03 Selecting a new workspace folder or existing workspace id
      clears the stale folder error before Continue/Retry.
- [x] L04 Bundled Node not on PATH: inspect against constitution
      (embedded runtime, no system PATH fallback). Adjudicated
      **contract-correct**, not a product defect. Agent discovering the
      bundled Node is the intended seam. No PATH fallback added.
- [ ] L05 Independent review of L01–L03, then source tests. Isolated
      candidate path/SHA for PM GUI retest. Do not claim PASS from source
      tests. Do not touch PM profile/app.

## Windows Defender-on class (reuse, do not weaken)

- [x] I02 Collect one existing-public-installer verification of the
      merged workflow on hosted `windows-2022`/`windows-2025` (run
      `34315546804`). Both jobs SUCCESS. Evidence: RTM on,
      `DisableRealtimeMonitoring=false`, no `C:\`/`D:\` or Penglai
      exclusions, `mutated=false`, payload-absence with leftover
      `Uninstall.exe` only, exact public 0.5.12 SHA
      `5d926a884ca2b93c43f8ee8d8e8897df636585d449f1810d25ab4bffae3159da`.
      This is hosted restore-to-qualifying, not stock-OEM Windows. Reuse
      the class for 0.6 Windows native. Never
      `DisableRealtimeMonitoring $true` or `Add-MpPreference -ExclusionPath`.

## Upstream (0.6.0)

- [ ] U01 Official DSH `0.1.5-alpha.1` complete npm cohort with
      integrity. Tag `dsh-v0.1.5-alpha.1` commit
      `5dda764ed3aa172535a7967b06ff95d9cbfe536a`. Reconstruct the graph.
- [ ] U02 Session V3: preserve original logs, write new V3 logs, refuse
      silent discard and refuse downgrade. Re-verify first-party plugins,
      Remote, IM, Memory, session projections, Home generation,
      old-session migrate/rollback.
- [ ] U03 Remove `ctx.agent`; pass Agent explicitly. Inbox via
      `agent.inbox`. Re-evidence plugin APIs.
- [ ] U04 DSH IM 4.17.1 (`464c0a91762ebd0befc2d179f036eaae4864fb0e`,
      MIT, tarball SHA-256
      `607a775b29e1355ab3f2953e45fb217f1102685202e0eca9f121d59abb138fec`).
      Port Connection `/api` management for unmodified 0.1.5-alpha.1.
      Do not vendor runtime, `cordis.patch.yml`, WhatsApp, or Office
      replacement.
- [x] U05 Node 22.23.2 (keep). Electron 43.6.0 for the three existing
      targets (keep; do not jump to 44). onnxruntime-node 1.23.2 (keep;
      1.29.0 drops darwin-x64; no loong64 native). Mnemon 0.2.8 kept;
      linux-loong64 is an architecture build of the same commit.
- [ ] U06 Privacy/log/test/doc audit of new 0.6 surfaces. No secrets,
      personal paths, or chat media in public docs.

## Loongson UnionTech UOS (`linux-loong64`)

- [x] S01 unofficial-builds Node 22.23.2 loong64 tar.gz hashed
      `36d02422…` / 57692301 bytes. ELF is **new-world**
      (`ld-linux-loongarch-lp64d.so.1`, GNU/Linux 5.19.0, GLIBC 2.38) —
      **not** the UOS 20 client Node. tar.xz local copy truncated; do
      not pin. See `NODE_LOONG64.json`.
- [x] S02 Loongson Electron **31.7.7** zip hashed and ELF-read (old-world
      `/lib64/ld.so.1`, GNU/Linux 4.15.0, GLIBC ≤2.28, Chrome
      126.0.6478.234). Compact provenance:
      `docs/0.6.0/ELECTRON_31_7_7_PROVENANCE.md`. **PM option B
      selected (2026-09-09):** ship with Chromium 126 / unproven
      maintenance disclosure; no security parity. 22.3.27 is not the
      default. darkyzhou 43.x remains new-world-only.
- [ ] S03 Linux generation layout (XDG) and `releaseTarget`/`linux-loong64`
      landed with tests rejecting linux-x64/arm64. Process supervision,
      secrets (libsecret or 0600 file class), and Landlock/seccomp
      mapping remain open.
- [ ] S04 `.deb` packaging class: `scripts/package-linux-deb.mjs` stages
      `/opt/Penglai`, desktop file, UOS `Architecture: loongarch64`,
      required Office+Memory, chrome-sandbox kept, installer name
      `Penglai_0.6.0_uos_loong64.deb` (in `release-contract.json` after
      F05). CLI packager requires old-world Node + DSH CLI + glibc flock.
      Native launch/uninstall remain S06; this is not native UOS PASS.
- [x] S05 Native addons: old-world flock, pty, koffi, sharp/libvips, and
      Mnemon 0.2.8 architecture build (`docs/0.6.0/UOS20_ADDONS.md`,
      `docs/0.6.0/MNEMON_LOONG64.md`). npm
      `@koromix/koffi-linux-loong64@3.1.6` is new-world `GLIBC_2.36` —
      not embedded. require-builtin native is optional internals,
      unpublished on loong64; do not fabricate it. Memory stays required.
      MOSS ONNX is not enableable (`docs/0.6.0/MOSS_LOONG64.md`).
- [ ] S06 UOS native install/startup/function: **Owner post-publication
      acceptance** (2026-09-09). Not a pre-publication blocker. Do not
      request remote access. Label `OWNER_POST_RELEASE`, never PASS.
      Cross-build and QEMU are not native proof.

## Evidence and normal tests

- [ ] V01 Source gates: format, typecheck, unit, contract, integration,
      E2E, security, chaos, `test:soak`. No two-hour installed soak.
- [ ] V02 versions/identity/contracts/dependencies/licenses/secrets/SBOM/
      notices/cohort/closure/profile/clean-clone.
- [ ] V03 Office-real and Memory-real on a clean tree.
- [ ] V04 Four-target native from one clean `main` SHA after merge.
- [ ] V05 Matching-native fresh/restart/Back/retry/invalid-path/
      credential-recovery/plugin/upgrade/uninstall. Windows without
      Defender weakening; uninstall payload-absence before cleanup.
- [ ] V06 Live model/IM: run when credentials exist; otherwise
      `LIVE_NOT_RUN`. Fixtures are not live PASS. PM owns GUI retest.

## README, website, installers and release

- [x] D01 README: English then Chinese; four-target download cards bound
      to public v0.6.0 bytes after readback. Honest UOS limits retained.
- [ ] D02 `website/` + gh-pages/pages.dev: desktop 1280 and mobile 390,
      reduced-motion, keyboard, live origin readback after publish.
      Downloads now bind v0.6.0 public bytes; live origin readback is P05.
- [ ] D03 macOS DMG presentation (both Mac targets).
- [ ] D04 Windows NSIS install/upgrade UI.
- [ ] D05 Electron first-run wizard, including UOS/linux once packaged.
- [ ] D06 UOS `.deb` / desktop presentation on real UOS, not a mock.

- [ ] P01 Acceptance delta, release notes, security, upgrade docs.
- [ ] P02 Commits, push, PR, merge; exclude Owner files and private
      `.grok` / `pdf-page-preview.png`.
- [x] P03 Exact contract asset set from freeze `7dd68b4a` (four
      installers + seven metadata files). GitHub aggregate job on run
      34376799819 remains FAILED (collector path), not waived.
- [x] P04 Immutable publication and public-byte readback of `v0.6.0`.
      v0.5.10, v0.5.11, and v0.5.12 were not rewritten.
- [ ] P05 Live penglai.pages.dev and GitHub Pages readback for 0.6.0.

## Notes

PDF page preview / Poppler remains D-069 / OUT_OF_SCOPE.
WhatsApp remains permanently rejected.
Bundled Node not on PATH is the product contract unless L04 finds a spawn
failure of the embedded binary.
