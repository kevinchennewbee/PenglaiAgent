# DSH 0.1.2-alpha.1 migration matrix

> Source baseline: `dsh-v0.1.2-alpha.1` at
> `cd5ef8148158c3a752a658978873241fdf8e2bbc`. Status values describe preview
> work, not release completion.

## Upstream seam mapping

| Area | 0.5.7 coupling | Fixed-source owner in alpha.1 | Penglai action now | Package-gated action | Acceptance |
| --- | --- | --- | --- | --- | --- |
| Application launch | Electron launches packaged DSH and applies profile/overlay | `dsh` CLI plus named profile and ordered bundles/patches | Characterize current launch, helper ownership, and profile inputs | Recompose exact official packages without a second launcher | Dumped config, first official Turn, restart, no parallel Host |
| Session create | `ctx.apiProxy.sessions.create` in `@penglai/dsh-bridge` | `@deepseek-ai/dsh-api-session-controller`, `ctx.remote.session.create` plus separate `rename` | Session owner port receives Workspace identity and requested title; rc.2 envelope isolated | Back the port with published create/rename Remotes and define failed-rename reconciliation without hiding the created ID | Create/adopt exact Workspace Session; reconnect and duplicate request tests |
| Model catalog | `ctx.apiProxy.sessions.models` | Session Controller `modelCatalog` plus official model-selection projection | Model directory is isolated behind the Session owner port | Compose published catalog and durable selection projection | Cold/resumed Session sees routable current model without local registry |
| Model select | `ctx.apiProxy.sessions.selectModel` | Session Controller `selectModel` | Selection is isolated behind the Session owner port; rc.2 envelope remains version-scoped | Back the port with published `selectModel` and typed failure/cancellation | Durable projected selection survives restart |
| Session list/title | Workspace `sessionIds` mapped to `{ id }` | Session Controller list plus Session projection | Bridge joins Workspace-owned membership/order to Session-owner titles with ID fallback | Back Session summaries with the published projection-bearing list Remote | IM chooser uses immutable ID plus official title; no log scraper |
| Cancel/Stop | Live Agent handle and old HTTP/API route assumptions | Session Controller `cancel` plus cooperative Agent/tool cancellation | Separate core-death from cancellation failures | Wire desktop and client Stop to official Remote | Text, tool, subagent, recovery, and dead-core cases terminate coherently |
| Workspace | Direct `workspaceRegistry` reads and old ApiProxy surface | Workspace Controller Remote and workspace registry | Freeze all 29 active/test/gate reference files and scope assumptions in the executable inventory | Migrate client/bridge callers | No current-window guessing or cross-Workspace state |
| Settings | Plugin-specific `@Remote` plus repeated client reads | Settings Controller, typed settings, shared mirror | Inventory every plugin reader and stale-state symptom | Mount through published mirror/client graph | One authoritative state; reconnect and locale changes converge |
| Remote transport | Penglai plugins already use Typert `@Remote`; old host BFF assumptions remain | API Gateway, API Remotes, owner `TypertRemoteService` controllers | Preserve plugin-owned Remotes; locate ApiProxy-only callers | Regenerate/validate exact client bundles and event allowlist | Typed failures, cancellation, reconnect, no compatibility ApiProxy |
| Client composition | Eight first-party plugins inject removed `dsh-client-runtime` | Session/Workspace controllers, Client Store, narrow UI packages, and typed slots | Freeze all eight manifests and eight packaging rows; keep source-owner mapping distinct from the unresolved published inject graph | Replace manifests after published package exports are known | Every expected client fiber reaches `ACTIVE`; absent/pending is failure |
| Branding/layout | Exact-hash Web/General/Conversation overlay | Brand, layout, conversation, settings, composer/message slots | 12-item executable map covers every patched file/asset; four narrow gaps are explicit | Prove official routes, then remove obsolete patches or authorize only residual gap overlays | No hidden official theme/locale/models/settings behavior |
| Plugin inventory | Desired profile plus official rc.2 inventory and polling | Host plugin inventory with pending/loading/active/failed/unloading phases | Preserve signed transaction journal and characterize convergence | Adapt exact inventory Remote/client payloads | Desired, effective, client-fiber, rollback, and terminal state agree |
| Image intake | Channel download plus current image store assumptions | Attachment service, local provider, Session attachment admission/projection | Callback containment, exact Feishu resource checklist, durable text-only degradation, and closed redacted request/stream/validation/admission/transcription diagnostics are executable | Hand validated bytes to official Attachment path and prove Owner permissions | Model-visible durable image fact, replay, compaction, and real model proof |
| Audio intake | Penglai ASR before a text Turn | No general DSH audio/video Turn support | Keep audio pipeline in ASR plugin; persist closed downloading/validating/transcoding/transcribing phases plus queued handoff, retain legacy `processing` recovery, and classify only typed codec/no-speech/duration/model/backpressure/cancel/deadline/engine causes | Rebind produced text through migrated Session path | Real Feishu voice becomes one official text Turn; no disguised attachment |
| IM support truth | One `live` boolean mixed visible entry, implementation, bundle, connection, validation, and release proof | DSH owns Agent/session and typed plugin composition; Penglai owns its channel adapters and evidence | Closed registry/Remote/UI model now separates entry, adapter mode, runtime bundle, dynamic connection, release evidence, and per-capability evidence; current rows are source-only | Reconcile package graph and gather installed/Owner-live/public evidence without strengthening source facts | One machine source drives UI and acceptance; no support claim exceeds its evidence class |
| Session/subagent projection | Memory curator used user-visible `origin: subagent` semantics | Official descriptor/projection plus one-shot `ctx.llm.stream`; alpha.1 Jobs are also owner/user-visible | Replaced curator Agent/Session creation with a bounded Memory-owned queue and direct official LLM request; optional Budget accounting, one transient retry, and digest-only audit are source-complete and executable | Reconcile published LLM declarations/runtime exports; do not move maintenance into visible Jobs; prove packaged restart/live isolation | Genuine subagents remain; one Turn creates at most one scoped curator call; no hierarchy pollution or orphan work |
| Locale | Penglai client strings plus built overlay assumptions | Third-party locale registration and typed client locale | ASR composer and TTS Read raw `mic`/`stop`/`read` labels are replaced with localized accessible lifecycle labels; remaining plugin copy stays inventoried | Reconcile exact published locale package and complete remaining client strings | Fresh Chinese, English, runtime switch, accessible labels |
| Browser authentication | Secure loopback proxy around existing DSH Web | One-time browser token and changed profile boot | Model token lifecycle and leakage tests | Adapt first navigation/refresh/deep-link to published behavior | Token absent from logs/evidence/renderer and restart recovers |
| Windows process tree | Electron supervises helper that can outlive child Node | Upstream has lower-level Windows helpers, not Penglai recovery policy | Fixed one-sided helper wait, dual-lifetime handshake, stale facade state, duplicate-owner risk, restart port drift, lost-listener/hang detection, failed-restart budgeting, redacted terminal diagnostics, and non-stranding exhaustion actions; native proof remains | Reconcile helper and authenticated health route after package closure | Child death detected, bounded restart, no orphan, coherent degraded/manual state |
| Identity/build | Pins copied across manifests, scripts, contracts, and runtime | Upstream package set not yet published | Strict verifier now derives product/toolchain/DSH/schema/publication/three-target expectations from sole `pins.ts` authority and checks every high-risk copy | Freeze exact npm integrities and closure in one commit | One authoritative source; all copies and public artifacts match |

## Direct Penglai DSH consumers

The current source has these direct package-level couplings:

| Penglai package | Direct official packages | Primary migration risk |
| --- | --- | --- |
| `@penglai/desktop` | `@deepseek-ai/dsh` | packaged launcher/profile/auth/runtime closure |
| `@penglai/dsh-bridge` | DSH CLI, Agent, Session, Workspace, LLM, Credentials, Inventory, Typert, client locale/theme/primitives | ApiProxy removal, Session controller types, package graph |
| `@penglai/memory-sources` | Agent, Tools, Workspace, Typert | scoped model-visible input and Workspace ownership |
| `@penglai/im` | Credentials, Typert, Cordis | client-runtime removal, Remote graph, channel state truth |
| `@penglai/plugin-center` | LLM, Typert, Cordis | inventory transaction state and client composition |
| `@penglai/asr` | Typert, Cordis | settings mirror, composer slot, cancellation |
| `@penglai/moss-tts` | Typert, Cordis | message/control slots and cancellation |
| `@penglai/memory` | Typert, Cordis | curator lifecycle, internal job, Workspace scope |
| `@penglai/office` | Typert, Cordis | owner confirmation, artifact return, client slot |
| `@penglai/budget` | Typert, Cordis | settings/state mirror and model accounting |
| `@penglai/companion` | Typert, Cordis | schedule/job ownership and activation diagnosis |

Cordis `4.0.1` is listed separately because it is a framework dependency, not a
DSH `0.1.2-alpha.1` version pin. Its final compatibility still belongs to the
published-package reconciliation.

## Immediate source-level decisions

1. Do not add a compatibility ApiProxy. The only ApiProxy bridge is deleted
   when official Session/Workspace/Settings/Inventory Remotes are integrated.
2. Do not replace every `@Remote` in Penglai. Plugin-owned typed Remotes remain a
   valid extension mechanism; only their BFF/client assembly must migrate.
3. Do not copy upstream generated clients or build output into this repository.
4. Do not rebase an rc.2 byte overlay speculatively. First map it to official
   slots; retain only a proven missing seam with a new digest and ADR.
5. Do not move audio into DSH Attachment. Images and audio keep different
   ownership and evidence.
6. Do not hide invalid Memory curator sessions in UI or move them into visible
   Jobs. The source path now uses one official no-tools LLM request inside a
   bounded Memory-owned queue; preserve that lifecycle through npm
   reconciliation.
7. Do not use source build success to alter the release identity or lockfile.
8. Do not derive IM connection, installed support, Owner-live proof, or public
   support from a bundled runtime or visible settings entry. The closed registry
   remains `source-only` until each stronger evidence plane is independently
   completed.

## Executable seam census

`DSH_MIGRATION_INVENTORY.json` is the machine-readable source census for the
fixed alpha.1 baseline. `scripts/verify-058-migration-inventory.mjs` compares
the recorded file set and literal reference counts with every tracked or
unignored code-graph file. The preview gate now fails when an ApiProxy,
`dsh-client-runtime`, or `workspaceRegistry` reference is added, removed, or
moved without updating the migration decision.

The current census contains:

- nine ApiProxy/host-apiproxy reference files, including the bridge caller,
  source commentary, injection expectations, closure probe, and tests;
- nine client-runtime reference files: eight first-party plugin manifests and
  the packager's eight generated-manifest rows;
- 29 Workspace-registry reference files across production, tests, and the
  packaged-runtime verifier; and
- one direct settings-provider consumer with eight reads/writes; and
- the five source and five test files that currently own desktop DSH process
  supervision evidence; and
- seven Memory-curator/Budget source files and seven focused test files whose gate
  requires a direct official no-tools LLM request and forbids Agent/Session
  creation; and
- the authoritative IM registry, Host Remote, client projection, bridge, and
  six sidecar adapter contracts whose gate rejects the old `live` support flag.

The census proves that the migration surface is enumerated. It does not prove
that unpublished package exports exist or that a native process tree has been
tested.

`OVERLAY_TO_SLOT_MAP.json` and `scripts/verify-058-overlay-map.mjs` provide the
same drift protection for the rc.2 UI overlay. The gate binds all four overlay
file ids and all five brand assets to 12 reviewed dispositions and fails if a
legacy anchor or coverage row changes without review.

## Published-package reconciliation rows

These rows remain deliberately unresolved until official npm publication:

| Question | Required evidence | Fail-closed condition |
| --- | --- | --- |
| Is `@deepseek-ai/dsh@0.1.2-alpha.1` official and immutable? | npm metadata, dist integrity, tarball digest, publish time | absent, republished, deprecated without explanation, or source mismatch |
| Are all direct official packages published? | complete manifest-derived list and successful exact-version resolution | any missing or mixed-version package |
| Are generated clients present? | tarball export/file inspection and clean consumer import probe | source-only file, missing export, or stale generated declaration |
| Is the Remote API identical to the fixed source? | declaration/generated artifact comparison plus focused runtime probe | namespace, method, event, error, or cancellation drift |
| Is the client graph consumable? | package `dsh.client` metadata, exports, clean build, fiber inventory | missing package, injection cycle failure, pending/absent fiber |
| Is the closure licensable and reproducible? | lock integrity, license/notice/SBOM, clean-clone build | unknown license, mutable source, Git/path fallback, or non-frozen install |

## Current status summary

- Source identity: **FIXED**
- Upstream clean source install/build: **PASS**
- ApiProxy/client-runtime/Workspace seam census: **FIXED AND GATED**
- Overlay-to-slot inventory: **FIXED AND GATED; FOUR SOURCE GAPS OPEN**
- Remaining repository/release inventory: **IN PROGRESS**
- Independent Penglai fixes: **AUTHORIZED ON PREVIEW**
- Official npm closure: **BLOCKED — NOT PUBLISHED**
- DSH dependency change: **NOT STARTED**
- Native/installed/live/public 0.5.8 evidence: **NOT RUN**
