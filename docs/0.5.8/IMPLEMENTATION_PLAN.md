# Penglai 0.5.8 complete implementation and acceptance plan

> Planning status only. This plan preserves the owner-led 0.5.7 installed
> walkthrough and maps it onto the candidate next DSH architecture. It contains
> no claim that a listed root cause is repaired until the stated post-migration
> reproduction and acceptance evidence exists.

## 1. Product goal and first-principles test

0.5.8 is the stabilization release for the functions already present in 0.5.7.
The user should not need to understand DSH, profiles, client fibers, HTTP 502,
session UUIDs, model downloads, or channel resource APIs to know whether Penglai
is ready, listening, speaking, connected, working, recovering, or failed.

Every implementation decision must answer four first-principles questions:

1. Who owns the capability: official DSH, Penglai distribution shell, or one
   Penglai plugin?
2. What durable state proves the operation really succeeded?
3. What does the user see while it starts, waits, works, stops, fails, retries,
   or recovers?
4. Can the same failure recur after restart, concurrency, network loss, or an
   optional plugin failure without corrupting unrelated capabilities?

The adversarial rule is: do not accept the easiest explanation merely because
it fits one screenshot. Attempt to falsify it with process, inventory, route,
database, session, package, and native installed evidence.

## 2. Evidence levels

Each issue and release gate distinguishes:

- **Source**: the implementation exists and is reviewed.
- **Package**: the exact code and dependencies are in the target closure.
- **Native**: it builds and starts on the target OS/architecture.
- **Installed**: the shipped installer produces the intended local state.
- **Live**: the real provider/channel/model path completes end to end.
- **Public**: the exact accepted bytes and truthful documentation are published.

Evidence from a higher-looking UI state may not substitute for a lower-level
fact. For example, “已安装” is false when the official loader phase is still
`pending`, and a bot’s generic reply does not prove that an image reached the
model.

## 3. Consolidated 0.5.7 finding ledger

### P0-01: packaged DSH dies while the desktop helper remains alive

**Observed symptom**

- IM settings changed from usable to “无法读取 IM 状态.”
- ASR composer reported `penglaiAsrSettings/describe` HTTP 502.
- Stop reported `/api/session.cancel` HTTP 502.
- These failures appeared together during/after a high-concurrency conversation.

**Evidence and current root-cause hypothesis**

The Electron main process and `penglai-windows-host.exe` remained alive, while
the actual DSH Node process and its loopback listener were gone. Current Windows
helper behavior keeps the Job alive until stdin closes or a stop byte arrives.
The supervisor watches the helper process, so it can miss the death of the child
DSH Node process. The common 502 cluster is therefore one core-process failure,
not three independent ASR/IM/Stop bugs.

**0.5.8 action**

- redesign the packaged process contract so the monitored owner receives the
  real DSH child exit/health transition;
- preserve bounded redacted exit code, signal, last health, and component phase;
- close or rebind the proxy atomically;
- restart only within an explicit budget/backoff and expose `recovering`,
  `recovered`, or `manual action required`;
- keep optional-plugin crashes from killing core; and
- test crash, hang, port loss, helper exit, child exit, restart exhaustion,
  normal Stop, app quit, and orphan cleanup on native Windows.

**Do not** “fix” each 502 call separately or merely translate it to a friendlier
string.

### P0-02: Feishu image callback can destabilize the DSH host

**Observed symptom**

Feishu text worked, but sending an image produced no model-visible response and
was temporally associated with the later common 502/core-death state.

**Evidence and current root-cause hypothesis**

The Feishu callback accepts media, assigns `this.lastEnqueue =
this.ingestFile(...)`, and immediately returns accepted without attaching a
terminal rejection handler at the callback boundary. The download occurs before
the internal protected portion. A rejected resource download can therefore
escape as an unhandled asynchronous rejection. The old supervisor then loses
the exact DSH exit detail.

This is a high-confidence causal path, not yet a final native crash proof,
because the missing supervisor diagnostic discarded the precise exit reason.

**0.5.8 action**

- make every vendor callback terminally catch and persist asynchronous failure;
- never allow inbound media failure to reject outside the channel boundary;
- download with exact tenant/app/message/file identity and size/type limits;
- admit successful images to the official new DSH Attachment path;
- persist one terminal inbox state and safe retry classification;
- reply with a bounded useful failure only when policy permits; and
- add a native installed crash probe that proves the host remains healthy after
  corrupt, unauthorized, missing, oversized, slow, and duplicate media.

### P0-03: Feishu media permissions and resource download are incomplete

**Observed symptom**

Feishu connection and text conversation succeeded, while images and voice did
not complete their media path.

**Evidence and current root-cause hypothesis**

The configured app demonstrated message receive/send capability, but media
requires a separate official resource-download API and permission set. The
adapter currently collapses the detailed vendor failure into a generic transient
delivery class, so the user cannot distinguish missing scope, wrong resource
identity, expired credential, network failure, or size/type rejection.

**0.5.8 action**

- publish an exact Feishu capability/scope checklist in the connection flow;
- verify required event subscriptions and resource permissions before reporting
  media support;
- preserve a redacted vendor code, request phase, retryability, and corrective
  action in diagnostics;
- expose text-only degraded state when text works but media does not; and
- run live text, image, file boundary, voice, reconnect, and credential-expiry
  tests using the official app path.

### P0-04: Feishu voice never reaches ASR

**Observed symptom**

A real two-second Feishu voice message was received, but produced no
transcription/Agent response.

**Evidence and current root-cause hypothesis**

The inbound voice claim was persisted and ended in retryable
`DELIVERY_TRANSIENT`. Available evidence places failure before ASR invocation,
at resource download/transport. DSH’s candidate attachment work does not add
audio support, so this remains a Penglai channel-plus-ASR pipeline.

**0.5.8 action**

- separate and observe `received -> claimed -> downloading -> validated ->
  transcoding(if needed) -> transcribing -> official text Turn -> replied`;
- preserve operation identity and cancellation across those phases;
- use fixed bundled codecs/engines only, never system PATH fallback;
- make no-speech, unsupported codec, duration, permission, model-not-ready, and
  network errors distinct; and
- prove one real Feishu voice message becomes a real official DSH text Turn.

### P0-05: Memory curator pollutes the official subagent list

**Observed symptom**

Ordinary conversation showed five unexpected memory-curator agents. Under a
separate real multi-agent scan, the header showed 17 subagents: six intended
scan agents plus eleven curator sessions. Curators showed “会话记录损坏.”

**Evidence and current root-cause hypothesis**

The curator sessions were structurally readable; there was no evidence of torn
session frames. The problem is semantic: a Memory maintenance operation is
being represented as an official `origin: subagent` session without the true
descriptor/lifecycle expected for a user-visible DSH subagent. New DSH subagent
projection will make identity more explicit but will not legitimize invalid
curator semantics.

**0.5.8 action**

- remove curator work from the user-visible subagent hierarchy;
- retain the official DSH/LLM boundary with tools disabled and closed output
  validation;
- run it as a bounded internal Memory job with exact Workspace/Turn scope;
- keep a separate redacted Memory audit ledger and retry policy;
- prevent curator failure from blocking or changing the user Turn; and
- prove no cross-Workspace recall, duplicate curator, subagent-count pollution,
  or orphan job after restart.

### P0-06: Companion install/enable stops at `pending`

**Observed symptom**

“蓬莱主动陪伴” installation failed with a postcondition such as expected
`present=true enabled=true`, observed `pending`.

**Evidence and current root-cause hypothesis**

The current transaction writes desired profile state, polls for a bounded fixed
period, observes `pending`, and rolls back when DSH becomes unavailable or the
postcondition is not reached. The UI result is honest, but not diagnostic: it
does not identify bundle activation, dependency injection, client fiber,
required service, timeout, or host death. The new upstream inventory adds phase
visibility but no complete Penglai transaction history.

**0.5.8 action**

- migrate the package/client graph first;
- journal desired state, official inventory phases, loader error, client-fiber
  state, timeout, rollback, and final readback;
- use event/state-driven convergence with a bounded deadline, not blind fixed
  polling as proof;
- keep required and optional plugin failures isolated; and
- show one owner-facing cause and next action without raw internal protocol text.

### P1-01: new-conversation ASR state is stale and misleading

**Observed symptom**

The new-conversation composer showed ASR unavailable or “asr model downloading”
after installation, while an entered conversation exposed microphone and Read
controls. The screen did not converge automatically.

**Evidence and current root-cause hypothesis**

The current client describes ASR around component setup rather than subscribing
to a durable shared model state. Model download/ready transitions can therefore
remain stale until remount. The later 502 state is a separate core-death symptom
and must not be conflated with this stale-state defect.

**0.5.8 action**

- use the official new settings/state mirror or a typed ASR Remote event;
- define `not installed`, `downloading`, `verifying`, `loading`, `ready`,
  `recording`, `transcribing`, `no speech`, `failed`, and `core unavailable`;
- keep new-conversation and in-session composers consistent; and
- provide retry/cancel/progress without blocking text conversation.

### P1-02: microphone interaction has no usable recording feedback

**Observed symptom**

The button displays raw `mic`, changes to raw `stop`, and produces text only
after Stop. There is no obvious listening state, timer, level, permission state,
or “processing” transition, leaving the user unsure whether Penglai heard them.

**Root cause**

The current control is a minimal text button around the capture lifecycle. It
does not present the lifecycle as a user interaction, and its strings bypass the
product locale surface.

**0.5.8 action**

- use localized icon plus accessible label;
- show permission request, listening animation/level, elapsed time, Stop,
  transcribing, result, no-speech, and error;
- support keyboard/accessibility and safe cancellation;
- avoid decorative animation that falsely claims audio level; and
- prove capture resources and temporary media are released on every terminal
  path.

### P1-03: Read/TTS first sound is too slow

**Observed symptom**

Read eventually plays, but the user waits a long time with little useful
feedback. The control displays raw `read`/`stop`.

**Evidence and current root-cause hypothesis**

The current path waits for complete synthesis/output read and then begins
playback. It lacks prewarm/streaming-first-audio behavior and does not separate
queue, model load, synthesis, decode, and playback latency.

**0.5.8 action**

- measure click-to-request, model-ready, first synthesized chunk/segment,
  first playable audio, and playback start;
- prewarm safely after explicit model enable, or synthesize bounded segments;
- play the earliest valid segment while later work continues where engine
  semantics allow;
- expose preparing/playing/stopped/ended/error/stalled states;
- share one cancellation/resource controller between preview and Read; and
- set and test a product first-sound latency budget on supported native devices.

### P1-04: connection actions hide the result and lack immediate feedback

**Observed symptom**

Clicking “连接” appeared to do nothing. The QR/result was rendered far below
the clicked plugin card, requiring the user to discover it by scrolling. Weixin
later exposed `BOUNDED_HTTP_MIME` instead of a useful explanation.

**Root cause**

The connection lifecycle is presented inside the long settings surface instead
of a focused operation dialog. Progress/error/result is spatially disconnected
from the user action. The raw bounded-HTTP error leaks an internal policy code
and does not prove whether the upstream payload, content type, proxy, or response
body caused the failure.

**0.5.8 action**

- open an accessible modal/sheet next to the action;
- show starting, QR/instructions, expiry countdown, refresh, verification,
  connected, failed, cancel, and retry;
- preserve true platform-specific connection methods and never fabricate QR;
- map bounded HTTP failures to a safe explanation plus diagnostic reference;
- reproduce Weixin MIME failure with redacted response status/content-type and
  fixture tests before deciding whether the defect is adapter, upstream, proxy,
  or environment; and
- close/update the modal only after official channel state readback.

### P1-05: IM session chooser exposes UUIDs instead of names

**Observed symptom**

Feishu `/会话` listed values such as `session-...` and UUIDs, while the desktop
sidebar displayed meaningful Chinese titles.

**Confirmed source cause**

The current DSH bridge `listSessions(workspaceIdentity)` maps Workspace
`sessionIds` to `{ id }` and discards all title information. The IM layer has no
title to render. This is not caused by the multi-agent scan.

**0.5.8 action**

- migrate to the official new session list/projection Remote;
- return exact session ID plus official projected title and current marker;
- use a bounded localized fallback only when title is empty;
- keep selection bound to immutable ID even when title changes; and
- test duplicate titles, renamed sessions, deleted sessions, many sessions,
  Unicode, and reconnect.

### P1-06: language parity is inconsistent

**Observed symptom**

Penglai surfaces include raw English `mic`, `stop`, and `read`; the DSH
permission dropdown shows `Read Only`, `Workspace Write`, and `Full access` in a
Chinese UI.

**Ownership split**

- raw ASR/TTS strings are Penglai defects;
- official permission preset labels are currently official DSH source behavior;
- the new DSH locale system gives Penglai a supported path for its own strings,
  but does not automatically translate official labels.

**0.5.8 action**

- register all Penglai-owned copy through the official locale extension;
- test fresh Chinese default, English, runtime switching, theme, overflow, and
  accessibility;
- do not patch minified DSH UI; and
- raise an upstream translation/extension proposal if the owner requires fully
  localized official preset labels.

### P1-07: settings and operation errors expose unrelated raw internals

**Observed symptom**

The user sees HTTP 502 routes, `pending` postconditions, `BOUNDED_HTTP_MIME`,
and session UUIDs rather than a coherent explanation and next action.

**Root cause**

Backend, transport, plugin lifecycle, vendor, and user-message errors are
surfaced without a stable product error taxonomy. A single core death fans out
as unrelated component failures.

**0.5.8 action**

- define product-facing categories: core unavailable/recovering, plugin not
  active, model not ready, permission missing, connection expired, media not
  supported, network retryable, and user action required;
- preserve a redacted diagnostic reference and exact structured cause internally;
- deduplicate one outage into one recovery banner plus component state; and
- never hide failure or label degraded capability “connected.”

### P1-08: concurrency amplifies failures but is not proven to be the killer

**Observed symptom**

A requested multi-agent machine scan created six intended agents; Memory
curators inflated the visible count to 17. Stop later failed because DSH was
already unavailable.

**Adversarial conclusion**

Review found no destructive process-kill command from the scan agents. High
concurrency increased load and the number of curator jobs and may have amplified
an existing lifecycle defect, but current evidence does not prove the scan
directly killed IM or DSH. The plausible Feishu unhandled rejection and Windows
supervisor blind spot remain separate high-priority paths.

**0.5.8 action**

- create a bounded concurrency/resource-budget matrix;
- count true subagents, Memory jobs, tools, Remote requests, open files, worker
  processes, and queue depth separately;
- stress cancellation, optional plugin failure, process crash, and restart;
- prove one plugin/job failure cannot terminate the host; and
- retain the first fatal diagnostic so later 502 noise cannot overwrite cause.

## 4. Implementation phases and gates

### Gate 0: wait for a consumable DSH release

Exit criteria:

- exact official tag/commit selected by owner;
- complete synchronized npm package set exists;
- generated Remote/client artifacts are present;
- clean frozen-lockfile installation is reproducible;
- source/package license and provenance closure is reviewed; and
- this issue mapping is refreshed against the exact tag.

Allowed before exit: 0.5.7 reproduction, redacted diagnostic collection, test
design, and document updates. Not allowed: final dependency freeze or old-seam
product fixes that would be thrown away by migration.

### Phase 1: compatibility spike (estimated 3–5 engineering days)

Objective: prove the new DSH can run inside the Penglai shell without pretending
all plugins work.

Work:

- install the exact new closure on a disposable branch/worktree;
- launch official DSH through the Penglai desktop shell;
- authenticate first navigation with the new one-time token;
- map old ApiProxy calls to owner Remotes;
- map every first-party client module to the new package/injection graph;
- inventory old overlays against official slots;
- activate minimum Office and Memory skeletons; and
- perform basic native startup on Windows, Apple Silicon, and Intel macOS.

Exit criteria:

- official DSH Web loads with no second chat/core;
- zero unexplained missing packages or generated clients;
- a written migration inventory assigns every broken seam;
- no old overlay is carried forward without a justified gap; and
- effort estimate is updated before full implementation.

Product bug fixes are intentionally deferred during the spike.

### Phase 2: architecture migration (estimated 8–12 engineering days)

Workstreams:

1. Remote/controller migration: Session, Workspace, model catalog/selection,
   settings, credentials, plugin inventory, events, reconnect.
2. Client migration: split packages, `dsh.client` bundles, explicit injection,
   slot registration, all expected fibers `ACTIVE`.
3. Profile/auth migration: one-time browser token, private DSH_HOME, required
   and optional plugin composition, recovery.
4. UI extension migration: brand, hero, settings, plugin cards, composer/Read
   controls through official slots; remove obsolete overlays.
5. Attachment migration: official image admission/projection and scoped channel
   adapter handoff.
6. Identity/build migration: version pins, lockfile, closure, catalog, SBOM,
   notices, evidence scripts, contract tests, package builders.

Exit criteria:

- no runtime `apiProxy` dependency;
- no `dsh-client-runtime` injection;
- no obsolete `dsh-host-apiproxy` closure dependency;
- no unjustified rc.2 built-file overlay;
- Office and Memory are truly active in official inventory;
- IM, ASR, TTS, and Companion remain optional/default off; and
- official text Turn, title projection, image attachment, and cancellation
  seams pass focused integration tests.

### Phase 3: Penglai P0 reliability (estimated 8–12 engineering days)

Priority order:

1. packaged DSH process supervision/recovery and fatal diagnostic retention;
2. Feishu async media rejection containment;
3. Feishu media permissions/download/error mapping;
4. Feishu voice-to-ASR pipeline;
5. Memory curator lifecycle and Workspace isolation; and
6. Companion/plugin transaction convergence and diagnosis.

Exit criteria:

- no tested optional plugin/media failure kills DSH;
- a real child death is detected and recovered or clearly exhausted;
- no orphan helper/Node/worker remains after stop/quit/crash;
- Memory creates no false subagents and cannot cross Workspace;
- one real Feishu image reaches the official model attachment path;
- one real Feishu voice reaches ASR and an official text Turn; and
- Companion succeeds or fails with exact safe cause and rollback.

### Phase 4: complete module UX and localization (estimated 6–10 engineering days)

Work:

- reactive ASR model state and consistent composer availability;
- accessible listening/transcribing interaction;
- TTS first-sound latency and observable playback controller;
- focused connection modal for every real platform method;
- official title projection in IM;
- Penglai locale registration and parity;
- unified error/recovery UX;
- model, disk, CPU, memory, queue, and concurrency budget visibility; and
- settings mirror use without duplicate polling storms.

Exit criteria:

- every control has idle/start/wait/success/fail/cancel/retry behavior;
- Chinese default and English are complete for Penglai-owned strings;
- no raw HTTP route/internal enum is the primary user explanation;
- text conversation remains usable when any optional plugin is disabled,
  downloading, failed, or recovering; and
- latency and resource budgets are measured, not described impressionistically.

### Phase 5: adversarial regression and release closure (estimated 8–13 engineering days)

Run the required source gates, then native installed and live acceptance on all
three targets from one clean commit. Follow the then-current release runbook and
release contract; 0.5.7 filenames and asset identity must not be reused blindly.

Required installed walks include:

- fresh install, invalid Workspace, Back/retry, credential failure recovery,
  first official model Turn, restart, update, rollback, uninstall, data choices;
- light/dark/system theme and Chinese/English switching;
- Office real read/write/export/return/undo with action-bound Owner approval;
- Memory real curate/recall/correct/forget/source revoke and isolation;
- IM bind/rebind/remove, text, title chooser, image, voice, reconnect, expiry,
  duplicate delivery, outbound retry, exit;
- ASR install/download/permission/record/no-speech/cancel/retry/restart;
- TTS download/prewarm/Read/stop/stall/error/concurrent request/resource cleanup;
- Companion install/enable/binding/quiet hours/budget/cancel/rollback;
- genuine multi-agent load with Memory enabled, Stop, process crash, recovery;
  and
- network loss, disk pressure, process kill, malformed media, optional plugin
  failure, and restart exhaustion.

## 5. Differential acceptance order

To identify ownership instead of debugging the whole product at once:

1. **Official DSH alone:** titles, images, cancel, subagents, persistence,
   localization baseline, Remote reconnect.
2. **Penglai shell only:** startup, process ownership, proxy/token, brand,
   Workspace, first Turn, restart, update, uninstall.
3. **Required plugins:** Office and Memory activation, scope, real operations,
   restart, curator semantics.
4. **Optional plugins one at a time:** IM, Feishu text, Feishu image, Feishu
   voice+ASR, desktop ASR, TTS, Companion.
5. **Combined stress:** multi-agent, Memory jobs, media, cancellation, network
   loss, optional-plugin crash, host recovery.

No later layer may be used to conceal a failure in an earlier layer.

## 6. Fake-pass rejection checklist

Reject the candidate if any statement below is used as sole proof:

- “the bot replied” therefore the model saw the image;
- “the title is Chinese” therefore it came from official session projection;
- “no 502 is visible” therefore the backend recovered;
- “only six agents are visible” therefore Memory is healthy (Memory may simply
  be unloaded);
- “the card says installed” therefore loader and client fibers are active;
- “ASR returned text” therefore the real channel audio path worked;
- “TTS eventually made sound” therefore first-sound latency is acceptable;
- “channel connected” therefore media permissions exist;
- “TypeScript/build passed” therefore the client bundle reached `ACTIVE`;
- “GitHub tag builds from source” therefore npm closure is reproducible; or
- “the error disappeared after restart” therefore its lifecycle cause is fixed.

## 7. Test and evidence design

Each bug closure record should contain:

- issue ID and exact affected version/commit;
- sanitized reproduction steps;
- expected and observed state transition;
- owner boundary (DSH/shell/plugin/vendor/environment);
- source fix and focused regression test;
- package inclusion and inventory/client-fiber readback;
- native target and installed version identity;
- redacted live result where external service is required;
- recovery/restart/cancel result;
- privacy review; and
- remaining limitation.

Diagnostics may contain bounded codes, phases, durations, counts, and hashes.
They must not contain API secrets, QR payloads, private chat bodies, account
identity, local personal paths, filenames from private sources, raw media,
transcripts, or memory contents.

## 8. Estimated effort and scheduling truth

The earlier rough estimate of 25–40 person-days is optimistic after accounting
for ApiProxy removal, client-runtime deletion, new auth/profile composition,
attachment migration, and overlay retirement.

Current planning range:

| Work | Person-days |
| --- | ---: |
| Compatibility spike | 3–5 |
| Remote/client/profile/overlay migration | 8–12 |
| P0 reliability and channel/Memory/Companion fixes | 8–12 |
| ASR/TTS/IM/localization/resource UX | 6–10 |
| Three-target native/live regression and release closure | 8–13 |
| **Total planning range** | **33–52** |

For one primary engineer this is roughly 6–10 weeks after the consumable DSH
baseline exists. Parallel native QA on Windows and both Mac architectures can
reduce calendar time, but does not reduce the evidence required. The upstream
npm wait is not included.

## 9. Definition of ready, done, and released

**Ready to implement** means Gate 0 is satisfied and the owner approves the exact
DSH baseline.

**Done in source** means all migration and issue acceptance tests pass in a
clean tree, with no forbidden architecture and no unassigned high-severity
finding.

**Release candidate** means exact packages from one source commit pass all three
native installed walks and required live paths with privacy-safe evidence.

**Released** means the owner authorizes publication, the exact accepted assets
are public, their immutable bytes read back successfully, and README/site/release
notes state support and limitations honestly in English first and Chinese
second.

Until all four statements are true at their respective level, the product must
not flatten planning, source, package, native, installed, live, or public state
into “0.5.8 completed.”
