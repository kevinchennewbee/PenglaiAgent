# Penglai 0.5.8 master ToDo and delivery gates

> Owner authorization: 2026-08-30. Execution branch starts at
> `0.5.8-preview`. The authorized endpoint is a merged `main`, three native
> installers from one final SHA, immutable `v0.5.8` public bytes, public
> readback, and only then the README, bilingual website, release notes, and
> repository metadata update. A checked source box never promotes a package,
> native, installed, Owner-live, or public box.

## 0. Product invariant

- [x] DSH baseline is the official lightweight tag `dsh-v0.1.2-alpha.1` at
  `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- [x] DSH remains the sole Agent, Workspace, Session, Turn, tool, approval,
  model, and base Web UI core.
- [x] Penglai remains the desktop distribution, lifecycle owner, Plugin Center,
  and first-party plugin set; no second Host, gateway, or conversation engine.
- [x] WhatsApp remains absent from the current product, package, runtime,
  dependency, test, support, and roadmap surfaces.
- [ ] Every 0.5.7 defect is replayed on the migrated alpha.1 runtime before its
  fix is retained, removed, or adapted.
- [x] Office and Memory are active on a fresh install; IM, ASR, TTS, and
  Companion are bundled, optional, and default off.

## 1. Fixed-source supply chain (`SC-*`)

### SC-001 — machine-readable source contract

- [x] Record repository, tag, commit, tree, archive SHA-256, source version,
  Node range, pnpm version, build commands, release families, and transport
  policy in `DSH_SOURCE_CLOSURE.json`.
- [x] State that official npm is not required and Penglai never publishes into
  the official `@deepseek-ai` npm scope.
- [x] Preserve official package names and reject upstream source patches.
- [x] Keep the product on rc.2 until the executable closure passes; do not call
  an isolated source build a product integration.

### SC-002 — reproducible source acquisition

- [x] Clone or accept an explicit checkout only from the official repository.
- [x] Resolve the tag to the fixed commit and require the fixed tree.
- [x] recompute the `git archive` SHA-256.
- [x] reject tracked source modifications and a mismatched origin.
- [x] verify the source CLI identity, Node range, exact build Node, upstream
  `pnpm@11.7.0`, and deterministic archive `npm@10.9.7`.

### SC-003 — complete fixed-source product build and pack

- [x] Run the upstream frozen install with Corepack-selected pnpm.
- [x] Run the complete upstream Host, Client, CLI, and Web build with the
  source-supported Penglai distribution client environment and bind its
  218-artifact digest record.
- [x] Invoke upstream `release:pack --family vendor` and require 9 tarballs.
- [x] Import upstream DSH family membership, dependency order, tarball names,
  versions, and payload validators; pack the 241 DSH tarballs without invoking
  the official-npm-only client-profile assertion.
- [x] Build and pack the required Landlock entry package.
- [x] Run upstream `release:verify-packed-install` with all three exact directories.
- [x] Drive installed `@deepseek-ai/dsh --version` under plain Node.
- [x] Record all 251 package identities, versions, sizes, licenses, and SHA-256
  values: 9 vendor, 241 DSH, and the required Landlock entry package.
- [x] Canonicalize only generated `package.json` key order, repack with scripts
  disabled, and prove every payload path, byte, mode, and symlink is unchanged.
- [x] Run two consecutive full builds and prove the promoted closure and the
  second build are recursively byte-identical.
- [x] Reject missing/duplicate packages, workspace links, copied `lib/`, and
  publication attempts.

### SC-004 — legal and closure review

- [x] Audit the fixed source root and all 251 package license declarations and
  embedded license files: 250 MIT and 1 BSD-3-Clause.
- [x] Generate deterministic THIRD_PARTY_NOTICES and SBOM inputs from the exact
  source-built closure.
- [x] Confirm GPL/forbidden production identities remain absent.
- [ ] Record native optional packages per target without treating cross-build as
  target-native proof.

### SC-005 — CI and cache

- [ ] Cache only by source commit, archive digest, platform, Node, pnpm, and
  upstream lockfile digest.
- [x] Revalidate every promoted tarball identity, size, SHA-256, license, and
  regular-file status before use.
- [x] Add identity-only source and promoted-closure gates to normal Source CI.
- [x] Add the full build/pack/clean-install gate to package/native candidate CI.
- [x] Keep generated source checkouts, stores, and logs ignored; promote only
  the verified 8.1 MB, version-scoped tarball closure and its bounded manifest
  so frozen CI/install does not depend on an unpublished registry package.

## 2. Atomic Penglai integration (`INT-*`)

### INT-001 — dependency and identity switch

- [x] Generate a deterministic local-closure dependency map for every direct and
  transitive `@deepseek-ai/*` package Penglai consumes.
- [x] Change all direct DSH dependencies from `0.1.1-rc.2` to the fixed local
  alpha.1 tarballs in one reviewable commit.
- [x] Regenerate `pnpm-lock.yaml` only from the verified closure.
- [x] Update the authoritative release pin, profile identity, runtime closure,
  release-info copies, SBOM, notices, and package builders together.
- [x] Reject mixed rc.2/alpha.1 runtime packages and registry fallback.
- [x] Prove a clean Penglai install can be reproduced after deleting all local
  node_modules and generated closure output.

### INT-002 — DSH process and profile

- [x] Launch the source-built official CLI, not the source tree or a system PATH
  fallback.
- [x] Compose the official Web profile with Office, Memory, Plugin Center, and
  optional plugin bundles through official profile/patch ownership.
- [x] Complete one-time browser-token first navigation and cookie/proxy handoff.
- [ ] Prove startup, health, same-port recovery, restart exhaustion, Stop, quit,
  and no-orphan cleanup with the packaged runtime.
- [ ] Wire isolated rc.2-to-alpha.1 DSH Home migration, activation, rejection,
  rollback, and restart continuation.

### INT-003 — official owner Remotes

- [x] Remove the active rc.2 ApiProxy adapter.
- [ ] Bind Session list/create/rename/model/prompt/attachment/cancel/follow to
  alpha.1 generated Session Remotes.
- [ ] Bind Workspace membership/order/mutation/follow to Workspace Remotes.
- [ ] Bind Settings, Credentials, plugin inventory, and events to their official
  owners.
- [x] Preserve immutable IDs and use official projections for visible titles.
- [ ] Add reconnect, cancellation, timeout, and restart readback tests.

### INT-004 — client package and UI migration

- [x] Remove all eight `dsh-client-runtime` injections and packager rows.
- [x] Declare the exact narrow client modules, stores, controllers, locale,
  settings, conversation, and typed slots needed by each first-party plugin.
- [ ] Require every expected client fiber to reach `ACTIVE`; desired/present is
  not sufficient.
- [ ] Rebase four remaining overlay gaps onto official slots where possible and
  keep only version/checksum-gated minimal overlays when no slot exists.
- [ ] Preserve official theme, language, Models, Workspace, Session, approvals,
  tools, settings, and Web UI behavior.

## 3. Required product plane (`REQ-*`)

### REQ-001 — base DSH

- [ ] Fresh profile reaches official DSH Web UI and creates the first official
  model Turn.
- [ ] Restart/resume, Back/retry, invalid Workspace, credential failure recovery,
  model change, Stop, and cancellation work without a Penglai chat fallback.

### REQ-002 — Office

- [x] Loader inventory reports the bundled Office plugin `ACTIVE` on fresh install.
- [ ] Inspect/create/edit/preview/save/undo for DOCX, XLSX, PPTX, and PDF.
- [ ] Every write/export/return has action-bound Owner confirmation.
- [ ] Workspace/path/artifact scope and restart recovery remain fail-closed.

### REQ-003 — Memory

- [x] Loader inventory reports Memory `ACTIVE` on fresh install.
- [ ] Curator uses a bounded internal no-tools LLM operation and creates no false
  Agent, Session, subagent, or visible Job.
- [ ] Curate/recall/correct/forget/source revoke and restart pass.
- [ ] Workspace A cannot recall Workspace B; personal/global/SOP changes require
  the correct Owner confirmation.

## 4. Optional plugin isolation (`OPT-*`)

For every optional plugin, test absent, bundled-disabled, enabling, pending,
active, degraded, failed, cancelling, disabled, rollback, restart, and uninstall.
At every state, base chat, Office, and Memory remain usable.

### OPT-001 — IM

- [ ] Package the seven current platform adapters under the single IM plugin.
- [ ] Reconcile entry, adapter, runtime, connection, release, and per-capability
  facts against actual installed evidence.
- [ ] Bind exact official Workspace/Session and use official Session titles.
- [ ] Complete bind/rebind/remove, text, reconnect, expiry, duplicate delivery,
  outbound retry, and app-exit cleanup.
- [ ] Route supported images through official Attachment admission.
- [ ] Keep files/audio on scoped Penglai artifacts until an official DSH seam
  exists; never disguise them as image attachments.

### OPT-002 — Feishu media and voice

- [ ] Verify exact app scopes, event subscriptions, resource route, and
  same-conversation identity with an Owner account.
- [ ] Prove one real non-empty image download reaches the official model
  attachment path without destabilising DSH.
- [ ] Prove one real voice download passes validation/transcoding/ASR and becomes
  exactly one official text Turn.
- [ ] Preserve durable redacted phase/cause/retry evidence and text-only
  degradation after media failure.

### OPT-003 — desktop ASR

- [ ] Install/import/download the pinned model with digest and disk checks.
- [ ] Prove native permission, record/timer/stop/transcribe/no-speech/error,
  cancellation, restart, and microphone-track release.
- [ ] Verify Chinese/English labels and accessibility on the installed Web UI.

### OPT-004 — TTS

- [ ] Install/import/download the pinned MOSS runtime and weights.
- [ ] Prove prewarm, cold retry, Read, Stop, supersession, playback cleanup,
  stall/error handling, and concurrent requests.
- [ ] Measure native first-sound latency on each supported target; do not infer it
  from complete-WAV source timing.

### OPT-005 — Companion

- [ ] Reconcile alpha.1 inventory events and client fibers.
- [ ] Complete install/enable/bind/quiet-hours/budget/cancel/disable/rollback.
- [ ] Pending must converge to active or a closed safe failure cause.
- [ ] No unattended tools or high-impact actions are allowed.

## 5. 0.5.7 differential defects (`BUG-*`)

- [ ] BUG-001 packaged DSH death/helper survival: retain, adapt, or delete only
  after a real packaged alpha.1 death/recovery run.
- [ ] BUG-002 Feishu async image rejection: prove host survival on installed
  alpha.1.
- [ ] BUG-003 Feishu media permission/download: prove real permission and bytes.
- [ ] BUG-004 voice-to-ASR: prove one official text Turn.
- [ ] BUG-005 Memory false subagents: prove real subagents remain accurate under
  Memory load.
- [ ] BUG-006 Companion pending: prove activation or rollback convergence.
- [ ] BUG-007 stale ASR state and missing recording feedback: prove installed UI.
- [ ] BUG-008 TTS first sound: measure supported native devices.
- [ ] BUG-009 hidden IM connection result/raw internals: reproduce real failures
  and verify restart-safe recovery copy.
- [ ] BUG-010 UUID session chooser: prove official titles with immutable IDs.
- [ ] BUG-011 locale/error consistency: inspect all Penglai settings and controls.
- [ ] BUG-012 resource/concurrency amplification: stress real subagents, Memory,
  Remote requests, tools, workers, open files, cancellation, and core crash.

Each closed bug records symptom, owner, source change, regression, package
inclusion, installed/native target, Owner-live result when required, recovery,
privacy review, and remaining limitation.

## 6. Candidate and native acceptance (`QA-*`)

### QA-001 — source and package gates

- [x] format, typecheck, unit, contract, integration, E2E, security, chaos,
  versions, identity, contracts, dependencies, licenses, secrets, profile,
  closure, build, plugin pack, and clean clone pass.
- [x] source-built DSH identity, tarball, packed install, SBOM, notices, and
  no-registry-fallback gates pass.
- [x] No generated evidence promotes source results into native/installed/live.

### QA-002 — one frozen candidate

- [ ] Freeze one clean candidate SHA after all source/package work.
- [ ] Generate the public export from that exact Git tree.
- [ ] Do not amend, rebuild, or reuse stale installers after native jobs start.

### QA-003 — three native targets

- [ ] `darwin-aarch64` installer build and installed acceptance.
- [ ] `darwin-x86_64` installer build and installed acceptance on native Intel.
- [ ] `win32-x86_64` installer build and installed acceptance on native Windows.
- [ ] Confirm architecture, embedded Node/Electron/DSH identity, signatures,
  fuses, process tree, ACL/modes, no PATH fallback, and no orphan processes.
- [ ] Run fresh install, restart, Back/retry, invalid Workspace, credential
  failure, first Turn, 0.5.7 upgrade, rollback, uninstall, and data choices.

### QA-004 — Owner-live and adversarial walks

- [ ] Office real operations and Memory real isolation.
- [ ] Feishu image and voice, Weixin text/diagnostic path, desktop ASR/TTS.
- [ ] Network loss, malformed media, disk pressure, process kill, optional plugin
  crash, restart exhaustion, and combined multi-agent/Memory/media load.
- [ ] Redact credentials, accounts, QR codes, chat content, private paths, media,
  and signing material from evidence.

## 7. PR, merge, release, and public narrative (`REL-*`)

### REL-001 — product PR and merge

- [x] Push coherent checkpoints only to `origin/0.5.8-preview` and read back CI.
- [ ] Open the product PR only after source/package and required acceptance gates.
- [ ] Review the complete diff against `main`, resolve all required checks, and
  merge without bypassing branch protection.
- [ ] Confirm local final SHA, GitHub `main`, and the candidate source SHA agree.

### REL-002 — 0.5.8 release contract and assets

- [x] Update the authoritative product/DSH/toolchain identity and exact target
  filenames for 0.5.8.
- [ ] Build all three installers from the same final main SHA.
- [ ] Assemble only the exact contract assets: installers, signed update
  metadata, release manifest, SBOM, notices, SHA256SUMS, and public-export
  manifest.
- [ ] Obtain the required Owner release inspection and publish immutable
  `v0.5.8` bytes; never replace an uploaded installer with rebuilt bytes.
- [ ] Run public readback: tag/source, exact asset set, sizes, SHA-256, updater
  signatures, release identity, target mapping, and public-export binding.

### REL-003 — README and release notes after readback

- [ ] Keep root README and current website on truthful 0.5.7 wording throughout
  preview development and native candidate construction.
- [ ] After `v0.5.8` readback PASS, update README English first then Chinese with
  the observed source SHA, DSH source provenance, exact asset links, sizes,
  hashes, support matrix, screenshots, and honest trust limitations.
- [ ] Update bilingual release notes and publication manifest from observed
  public bytes, not predicted filenames or local candidates.
- [ ] Do not use screenshots containing accounts, QR codes, chats, private paths,
  media, or credentials.

### REL-004 — website and repository metadata after readback

- [ ] Update `website/index.html` and `website/en/index.html` from the same
  observed facts as README; Chinese root and English `/en/` remain complete.
- [ ] Preserve the Penglai ink-wash visual language; do not redesign the site as
  an unrelated release task.
- [ ] Update the website deployment workflow to require `v0.5.8` and successful
  0.5.8 public readback.
- [ ] Merge the public-narrative change, deploy `website/` to `gh-pages`, and
  verify both languages plus every installer link over public HTTP.
- [ ] Search the live pages for stale 0.5.7/rc.2/download claims and for claims
  stronger than native/installed/Owner-live evidence.
- [ ] Only after the live site passes, update repository description/homepage/
  topics if needed and read them back from GitHub.

## 8. Final completion statement

0.5.8 is complete only when all applicable boxes above are backed by their own
evidence plane and the following identities agree:

1. local final source SHA;
2. GitHub `main` and `v0.5.8` source SHA;
3. all three native installer release manifests;
4. signed update metadata and SHA256SUMS;
5. immutable GitHub Release bytes;
6. README and release notes observed values;
7. Chinese and English live website download links.

Official npm publication is not item 8. If it appears later, record a separate
source/package reconciliation without rewriting the already verified Penglai
release provenance.
