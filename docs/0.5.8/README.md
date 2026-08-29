# Penglai 0.5.8 preview development baseline

> Status: source-preparation development branch. This directory records the
> product intent, fixed upstream source baseline, migration review, runtime
> findings, implementation order, work ledger, and acceptance gates for
> Penglai 0.5.8. It does not change the current 0.5.7 release contract and it is
> not package, native, installed, live, or public-release evidence.

## Branch purpose

- Branch: `0.5.8-preview`
- Base: public `kevinchennewbee/PenglaiAgent` `main`
- Base commit: `143482bf799b98734a70f74d38acb8932ed7864f`
- Created: 2026-08-28
- Development started: 2026-08-29
- Remote branch: `origin/0.5.8-preview` (continuous preview pushes authorized;
  no pull request opened)

This branch preserves the results of the owner-led 0.5.7 installed-product
walkthrough and the adversarial review of the next official DeepSeek Harness
(DSH) line. The branch exists so those observations remain reviewable and do
not depend on chat history or one local note.

## Owner intent for 0.5.8

0.5.8 is not a feature-expansion release. Its purpose is to take the functions
already promised or bundled in 0.5.7, exercise them as a normal user would,
find the real failures, repair them at their correct ownership boundary, and
ship a stable Penglai distribution whose official package closure matches the
Owner-fixed DSH `0.1.2-alpha.1` source baseline.

The governing principles are:

1. Official DSH remains the only Agent, Session, Workspace, Turn, tool,
   approval, model, and base Web UI core.
2. Penglai adapts to upstream; it does not fork DSH or build a parallel core.
3. A UI card, package file, QR, accepted callback, or passing source test is not
   proof that a capability is installed, active, usable, recovered, or live.
4. Bugs first observed on Penglai 0.5.7 must be reproduced again after the DSH
   migration before implementation, because the upstream architecture changed
   substantially.
5. The release fixes capability classes and lifecycle contracts, not individual
   screenshots, input strings, or timing coincidences.
6. No release claim is made without native installed evidence on Apple Silicon,
   Intel macOS, and Windows x64 from one clean source commit.
7. WhatsApp is permanently outside the Penglai product boundary. It is not a
   disabled, experimental, compatibility, or roadmap platform for 0.5.8 or any
   later release unless a future explicit Owner decision supersedes this rule.

## What is frozen and what is not

The following may be frozen now:

- the 0.5.8 product intent;
- the observed 0.5.7 bug and usability ledger;
- the no-parallel-core boundary;
- the migration-first implementation order;
- the differential and adversarial acceptance strategy; and
- the DSH source baseline: lightweight tag `dsh-v0.1.2-alpha.1`, commit
  `cd5ef8148158c3a752a658978873241fdf8e2bbc`;
- the rule that the eventual official npm closure must match that exact source;
- the permanent removal of WhatsApp from active product, source, dependency,
  packaging, test-matrix, and roadmap surfaces while preserving immutable 0.5.7
  release history.

The following cannot be frozen until official publication:

- the exact npm package set and each package integrity;
- the Penglai lockfile closure;
- whether every source-declared Remote/client package is published unchanged;
- the final compatibility matrix; or
- release dates and native package claims.

As of the verified snapshot on 2026-08-29, `dsh-v0.1.2-alpha.1` exists as an
official GitHub prerelease and source tag, but `@deepseek-ai/dsh` has not
published `0.1.2-alpha.1` to npm. Both npm `latest` and `next` still resolve to
`0.1.1-rc.2`. A source tag alone is not a consumable, reproducible Penglai
dependency closure.

## Documents

- [DSH_UPGRADE_REVIEW.md](./DSH_UPGRADE_REVIEW.md) records the old/new DSH
  comparison, the upstream ownership map, breaking seams, and anti-duplication
  decisions.
- [IMPLEMENTATION_PLAN.md](./IMPLEMENTATION_PLAN.md) records the installed
  symptoms, evidence-backed root causes, severity, planned remediation,
  implementation phases, gates, and native acceptance plan.
- [DSH_SOURCE_BASELINE.md](./DSH_SOURCE_BASELINE.md) binds the fixed tag to its
  commit, tree, clean source install/build result, and evidence limits.
- [MIGRATION_MATRIX.md](./MIGRATION_MATRIX.md) maps removed and new upstream
  seams to exact Penglai consumers and migration gates.
- [REPOSITORY_MIGRATION_INVENTORY.md](./REPOSITORY_MIGRATION_INVENTORY.md)
  classifies repository assets and assigns their migration or retirement path.
- [WORK_LEDGER.md](./WORK_LEDGER.md) is the branch-visible execution ledger.

## Split start-work gates

The source-preparation gate is open. The Owner selected the exact source, the
tag resolves to the recorded commit, a clean upstream frozen-lock install and
full source build pass, and the upstream contracts have been re-reviewed.
Allowed work now includes:

- exact source and package/API inventories;
- characterization and migration tests;
- preview-only safety gates and CI;
- retirement of active WhatsApp product/runtime/dependency surfaces; and
- Penglai-owned fixes whose contracts do not depend on the unpublished package
  graph, including asynchronous channel failure containment, desktop process
  recovery, the Memory curator's internal no-Session lifecycle, and the IM
  support-truth model that separates bundled source from connection and live
  release evidence; Feishu media failures also retain a closed redacted phase
  and cause, with an exact resource checklist and durable text-only degraded
  state until a real non-empty resource stream succeeds, while voice jobs
  durably expose downloading, validation, transcoding, transcription, queued
  handoff, and typed codec/no-speech/model
  readiness/duration/ASR operational causes without claiming Owner-live
  download or ASR success; the composer microphone also refreshes typed model
  state and exposes localized permission, recording/timer, transcription,
  result, no-speech, and error phases with terminal track release.
  TTS preview and Read now share cancellable synthesis/playback ownership,
  expose localized lifecycle feedback, and record source-level engine,
  complete-WAV, and playback-start timing boundaries without claiming native
  first-sound performance. All eight IM connection flows also open in one
  focused page-level modal while preserving each platform's real connection
  method; owned begin/poll failures now return durable localized causes and
  reference IDs without exposing bounded-HTTP implementation codes. Weixin
  protocol failures also retain only the closed request phase, numeric HTTP
  status, and normalized parameter-free media type; the primary failure surface
  remains compact while a default-collapsed Advanced section can read back that
  safe observation with an explicit non-root-cause label. Native accessibility,
  live QR, and Owner-live response evidence remain open.
- IM `/会话` and the desktop binding chooser now share the owner-bound
  Session title projection. Visible missing-title fallbacks are localized and
  ordinal; selection remains bound to immutable IDs. Alpha generated Remote,
  installed UI, and Owner-live command proof remain open.
- Penglai-owned ASR, TTS, IM, Office, Memory Sources, Plugin Center, update, and
  uninstall settings no longer render caught exception text. Voice model states
  and recovery copy are bilingual; failed ASR and TTS model operations now retain
  stable redacted diagnostic references across restart, and Plugin Center states
  the exact eight-channel registry. Full cross-component outage deduplication and
  official DSH permission-label localization remain open.
- MOSS-TTS now invokes the attributed runtime's real one-time model warmup after
  explicit verified model activation and before first synthesis after a cold
  restart. Failed warmup discards the engine so a later request retries from a
  clean instance. This is source lifecycle evidence, not a native first-sound
  measurement; the client Remote still waits for complete WAV readback.
- Plugin Center resource diagnostics now separate measured active and queued
  plugin work and read the same exact job-budget contract enforced by each
  service: ASR one active plus seven queued jobs, TTS one plus three, and
  Memory one plus seven. A closed backend result distinguishes within-budget,
  at-limit, over-budget, and unavailable states, and an actual breach is an
  explicit alert rather than arithmetic left to the user. Missing DSH core
  subagent, tool, Remote-request, and open-file evidence remains visibly
  unavailable instead of being reported as zero; native pressure/crash evidence
  remains open.
- Desktop recovery now keeps the first classified process or health failure as
  the primary diagnostic so later generic startup/gateway errors cannot replace
  the cause shown, copied, or written to the bounded local startup log.
- Plugin activation now journals bounded closed inventory transitions and exact
  activation/rollback readbacks. The Plugin Center turns only six closed
  failure codes into bilingual recovery guidance and shows a stable one-way
  diagnostic reference without exposing the private transaction identity;
  arbitrary loader errors stay private. Exact alpha event/client-fiber
  integration remains blocked on npm.
- Release identity verification now reads the sole `pins.ts` authority instead
  of declaring another expected version, then checks workspace manifests and
  the complete high-risk `release-info` product/toolchain/DSH/schema/publication
  and three-target copies. This is source consistency, not artifact evidence.
- The complete 59-script verifier/operator census is now executable and split
  across source, package, native, installed, Owner-live, public-byte, aggregate,
  and historical evidence planes. New or stale scripts, broken invocation
  ownership, and promotion of higher evidence into source PASS fail the preview
  invariant.

The package-integration gate remains closed until `@deepseek-ai/dsh` and every
required first-party package are published at a mutually compatible exact
version, generated artifacts are present, integrity and license closure is
reviewed, and a clean Penglai frozen-lock installation succeeds. Until then,
do not change DSH dependency pins or claim a 0.1.2 product build.

## Explicit preview boundaries

- no DSH dependency bump or source/Git-path dependency;
- no DSH source modification;
- no overlay rebase;
- product-code changes only when independent of the unpublished DSH package
  closure and recorded in the work ledger;
- source builds and tests are allowed; native release builds, package publish,
  release, tag, and deployment are not;
- no claim that an upstream capability automatically fixes Penglai integration;
- no WhatsApp compatibility card, experimental adapter, runtime, dependency,
  packaging path, support claim, or future-roadmap placeholder; and
- pushes only to `0.5.8-preview`; no pull request, `main` merge, or public release
  without separate Owner approval.
