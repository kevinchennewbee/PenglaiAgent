# Penglai 0.5.8 complete implementation and acceptance plan

> Execution plan. This plan preserves the owner-led 0.5.7 installed walkthrough
> and maps it onto the fixed DSH `0.1.2-alpha.1` source architecture. Each source
> checkpoint is identified explicitly; no source result is promoted to package,
> native, installed, live, or public evidence.

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

**Preview source checkpoint, 2026-08-29**

The Windows native helper now waits on both the real DSH process handle and a
desktop-owner stdin watcher. A DSH exit therefore terminates the helper that
Electron observes; owner exit/Stop still closes the Job Object and reaps the
owned tree. The startup report carries explicit `childExitMonitored` and
`ownerStopMonitored` facts, and the TypeScript boundary rejects an older helper
that cannot prove both. The desktop facade now reads live state, health, port,
PID, and restart count from one reused inner supervisor rather than retaining a
one-time snapshot or creating a competing supervisor. Automatic restarts retain
the existing proxy-facing inner port so the loopback proxy does not remain
bound to a dead target.

A bounded continuous HTTP probe now detects both a lost listener and a server
that accepts a connection but never returns the official DSH document. The
first failure clears stale green health and exposes `degraded`; a good probe
recovers without restart, while three consecutive failures terminate the owned
tree with bounded escalation and reuse the existing restart budget and port.
Stop/process exit cancel the timer and any in-flight request, and Start during a
degraded interval cannot create a second owner. A real local child-process test
proves transient recovery, sustained-hang restart, a new PID, and the same
proxy-facing port. Local typecheck, all 34 focused runtime/supervisor tests, the
full 725-test unit suite, the full 82-test desktop E2E suite, and the composed
0.5.8 preview gate pass.

This closes the source-level one-sided-wait, hang, and port-loss detection paths.
The helper has not been compiled or executed on Windows in this checkpoint.
Alpha.1's authenticated browser boot may require a different steady-state probe
route once its official packages exist; redacted terminal diagnostics, restart
exhaustion UX, and native orphan proof also remain open.

**Terminal recovery source checkpoint, 2026-08-29**

The restart budget now covers failed restart readiness, not only the first
child exit. Three attempts inside the five-minute window end in the closed
`manual-action-required` state with both the initiating trigger, the last safe
failure class, and exit code;
an explicit owner retry starts a new budget. Recovery transitions are emitted
through the live desktop facade, and the desktop moves to its bilingual
recovery surface after exhaustion instead of leaving the official page on
repeated 502s. Retry, Quit, Open Logs/Data, and Copy Diagnostics handlers are
registered before runtime startup and accept calls only from that recovery
page, so an early startup failure cannot strand the user.

Clipboard and startup diagnostics now contain only bounded structured fields:
app/source identity, platform, DSH pin, phase duration, restart count, closed
recovery state, required-plugin booleans, exit code, and closed error codes.
Raw exception text is no longer inserted into the DOM or startup log. The
bounded DSH stderr excerpt redacts private roots and credential-shaped values.
A real child-process test proves transient recovery, restart failure, exactly
three attempts, owned-child cleanup, and the final manual state. This closes
the source-level diagnostic and exhaustion-UX items; alpha.1 authenticated
probe reconciliation and three-target installed/native proof remain open.

**Authenticated startup source checkpoint, 2026-08-29**

The supervisor now accepts both Web contracts without changing the active rc.2
package graph. An rc.2 process must still return the official document from its
open loopback root. For alpha.1, the supervisor accepts only the exact
`dsh web: http://127.0.0.1:<owned-port>/?token=<base64url>` readiness line,
withholds incomplete stdout lines so a token split across chunks cannot leak,
and exchanges the token inside Electron main-process ownership. It accepts only
a 303 redirect to `/`, an exact DSH browser-session cookie, and a subsequent
authenticated official document from the same authority.

The renderer never receives the launch token or DSH cookie. The existing outer
Penglai proxy strips its own `penglai_proxy` credential before forwarding and
injects the trusted DSH cookie into HTTP and WebSocket requests. Continuous
health checks use the same private cookie, and restart can reuse it only when the
same authority still accepts it. Wrong-authority launch URLs, malformed cookies,
missing cookie exchange, non-official pages, and hanging responses fail closed.
A real child-process fixture proves alpha-style startup and steady-state health;
focused proxy tests prove browser-supplied cookie replacement cannot override
the trusted inner session. This is source compatibility evidence only: the exact
published alpha.1 process and three native packages remain untested.

**Overlay source checkpoint, 2026-08-29**

The rc.2 Web/Models/Conversation/Settings overlay is now decomposed into 12
machine-checked dispositions covering all four patched files and all five
brand assets. Title, brand, onboarding suppression, and a Penglai-owned
settings composite have alpha source routes; serializer-only differences and
the redundant patched welcome copy are marked for deletion. IM voice-row
projection, hero copy, hero background, and identity-safe TTS text resolution
remain explicit upstream gaps. No alpha build output or speculative overlay
rebase entered the product closure, and the active DSH pin remains rc.2.

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

**Preview source checkpoint, 2026-08-29**

The fixed alpha.1 source and the still-active rc.2 declarations both expose a
hand-built `ctx.llm.stream` request and the official immutable user-message
factory. Memory now uses that one-shot path directly, with an empty tool list,
a 1,200-output-token cap, host-side closed JSON validation, and no Agent or
Session creation. Alpha.1's `purpose` union still contains only compaction and
session-title, so this checkpoint does not invent a private purpose value.

The alpha.1 Jobs service was reviewed and deliberately rejected for this
maintenance path. Its owned jobs are Agent-visible and its unowned jobs are
visible to every caller; moving the curator there would relocate, not remove,
the product pollution. Penglai instead owns a single-flight internal queue with
an eight-job active-plus-pending limit, a 45-second abort deadline, bounded
duplicate history, overload fail-open behavior, and teardown cancellation.
Every key binds Workspace, Session, and Turn; Workspace ownership is rechecked
before both execution and commit.

Focused tests prove queue capacity, deduplication, timeout advance, teardown
cancellation, one official LLM request with no tools or Session identity, and a
real `turn/start -> user/message -> assistant/message -> turn/end` source path
that creates one Workspace candidate and suppresses a duplicate Turn. Static
and executable inventory gates refuse reintroduction of `agents.create`,
`origin: "subagent"`, or the old curator-session prefix.

This closes the source-level false-subagent lifecycle. It does not yet close
P0-05 as a packaged capability: optional Budget accounting for this auxiliary
model call, bounded redacted failure/retry diagnostics, published alpha.1
declaration/runtime reconciliation, installed restart cleanup, and live
privacy-safe Workspace isolation evidence remain open.

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

### P0-07: IM support truth has conflicting machine sources

**Observed symptom**

The settings surface can describe a connector as included or available while
its runtime is guided-only, health is false, send is rejected, no account is
connected, or no live release evidence exists. In 0.5.7 WhatsApp was shown as an
unavailable compatibility card even though its runtime was intentionally
excluded; the Owner has now permanently rejected WhatsApp from 0.5.8 onward.

**Confirmed source cause**

The current live-channel registry admits only Weixin and Feishu, while most
channel manifests set `live: true`. Host and bridge APIs expose that manifest
field and the settings client consumes it for connector copy. One boolean is
therefore overloaded across product entry, adapter implementation, bundled
runtime, account connection, capability validation, and release evidence.

**0.5.8 action**

- define one authoritative closed model with `entryAvailable`, `adapterMode`,
  `runtimeBundled`, `connectionState`, and `releaseEvidence` rather than one
  ambiguous `live` flag;
- describe authentication, inbound/outbound text, image, voice, reconnect, and
  exit capability evidence independently where necessary;
- derive registry, Remote payload, settings UI, acceptance matrix, README, site,
  and release notes from that same source;
- remove WhatsApp from active manifests, channel IDs, cards, routes,
  adapters/runtimes, dependencies, packaging, tests, and roadmap claims while
  preserving immutable 0.5.7 release history; and
- reject a release if any user-facing support statement is stronger than its
  installed and live evidence.

## 4. Implementation phases and gates

### Gate S0: fixed-source preparation — OPEN

Exit criteria:

- exact official tag/commit selected by Owner;
- tag, commit, tree, and source archive digest recorded;
- clean upstream frozen-lock installation and full source build pass;
- source package/API/slot inventory is refreshed against the exact commit;
- active and historical scripts, overlays, evidence schemas, fixtures, and
  compatibility wrappers have an owner and classification; and
- the permanent WhatsApp-removal and single-source identity gates are accepted
  as part of the migration, not postponed as release cleanup.

State on 2026-08-29: the Owner fixed `dsh-v0.1.2-alpha.1` at
`cd5ef8148158c3a752a658978873241fdf8e2bbc`; isolated install and full source
build pass. Repository classification remains a living ledger rather than a
reason to keep this gate closed.

### Phase 0: source preparation and independent repairs — IN PROGRESS

Allowed now:

- source-level Remote, client, profile, attachment, inventory, cancellation,
  subagent, locale, and one-time-token mapping;
- characterization tests and disposable source-built probes that never enter a
  product package or release claim;
- preview branch protection and evidence-class gates;
- permanent removal of active WhatsApp source, identity, dependencies, package
  graph, tests, and current-product surfaces; and
- Penglai-owned fixes that do not depend on the unpublished DSH package graph,
  beginning with terminal containment of asynchronous channel callbacks.

Not allowed now:

- changing DSH versions in product manifests or `pnpm-lock.yaml`;
- consuming DSH through a Git URL, source checkout, private tarball, or vendored
  generated artifacts;
- rebasing built-frontend overlays before the published client packages exist;
- claiming package, native, installed, live, or public 0.1.2 integration; or
- merging to `main`, tagging, publishing, or deploying.

#### Phase 0 dependency order from first principles

Work before npm publication follows this order. A later stream may start only
when it does not assume an unproven result from an earlier stream.

1. **Survival plane:** make startup, authentication, process ownership, user-data
   isolation, upgrade activation, failure rollback, and redacted recovery correct
   before migrating feature calls. A feature-complete build that cannot start or
   safely open an existing 0.5.7 home is unusable.
2. **Official ownership plane:** freeze the exact Session, Workspace, Settings,
   Credentials, Attachment, inventory, locale, and slot owners from the fixed
   source. Build Penglai-side ports and fixtures, but do not copy generated
   clients or create a compatibility ApiProxy.
3. **Required product plane:** adapt Office and Memory first and prove that base
   chat plus both required plugins can boot, restart, and preserve Workspace
   boundaries. They define the minimum usable Penglai product.
4. **Optional isolation plane:** adapt IM, ASR, TTS, and Companion independently.
   For every optional plugin, absent, disabled, pending, failed, and degraded
   states must leave the core and required plugins usable.
5. **Observed-defect plane:** re-run every 0.5.7 symptom against the migrated
   architecture. Keep upstream-owned fixes upstream, retain Penglai-owned class
   fixes, and reject screenshot-specific or old-route patches.
6. **Package and native plane:** when npm appears, reconcile source and package
   bytes, switch the dependency graph atomically, then prove clean install,
   0.5.7 upgrade, rollback, uninstall, and the three native targets from one SHA.

The immediate next survival-plane checkpoint is DSH-home upgrade isolation. The
alpha process must never be allowed to make the only rc.2 home irreversible.
Preparation therefore includes a privacy-safe rc.2 corpus replay, disk-space and
file-type preflight, private copy-on-write staging, an atomic active-home pointer,
one-writer migration, and rollback to the untouched rc.2 home. No dual write and
no silent runtime fallback are allowed. The new alpha browser-session credential
must be written only to the staged alpha home until activation succeeds.

The preview source now implements that data-generation primitive without
changing the active rc.2 runtime path. It hashes and copies the complete stopped
rc.2 working Home into a private alpha staging generation, preserves owner-only
permissions, rejects symlinks/special objects/concurrent writers, checks free
space before copying, and proves that the source did not change during the copy
or validation window. The target Home may evolve during alpha validation,
including the official credential-document conversion and browser-session
record, while the rc.2 Home remains byte-identical. The active pointer is the
last atomic activation write and requires exact alpha health plus active Office
and Memory evidence. Failed pre-activation validation deletes only the
disposable target; post-activation rollback selects the untouched rc.2 Home and
retains the alpha generation for diagnosis. A manual fixed-source verifier also
proves that alpha.1 retains all 48 rc.2 known session event types and can inspect
and load a privacy-safe physical rc.2 JSONL log, including legacy message
identity normalization and `todo/write`. Runtime wiring, the complete installed
0.5.7 corpus, native disk/ACL behavior, and real rollback remain package/native
gates; this source layer is deliberately dormant while the product pin is rc.2.

The official-ownership preparation now has an executable Penglai boundary as
well. The bridge composes separate Agent, Workspace, and Session owner ports;
the historical rc.2 ApiProxy request envelopes are confined to a version-named
adapter instead of leaking through the bridge or plugin composition layer.
Workspace remains the authority for membership and manual order, while the
Session owner enriches those immutable IDs with official projected titles and
owns create/model operations. A fixed-source verifier proves that alpha.1 owns
`list`, `create`, `rename`, `modelCatalog`, and `selectModel` under
`remote.session`, owns
Workspace mutation/follow under `remote.workspace`, and contains no ApiProxy
path in its API tree. The active rc.2 adapter and package pins remain unchanged;
the generated alpha Remote adapter is still correctly blocked on official npm
artifacts.

### Gate P0: published-package reconciliation — BLOCKED

Exit criteria:

- a complete synchronized official npm package set exists for the fixed source
  baseline;
- every required package version, integrity, dependency, license, and
  publication time is recorded;
- generated Remote/client artifacts are present and match the fixed source;
- npm dist-tags and versions are not partial, retracted, or tag-moved;
- a clean Penglai frozen-lock installation is reproducible; and
- the source migration matrix is reconciled against the published tarballs.

This gate is checked manually when the official packages appear. It is not an
automated monitor.

### Phase 1: compatibility spike (estimated 3–5 engineering days)

Objective: prove the new DSH can run inside the Penglai shell without pretending
all plugins work.

Work:

- install the exact reconciled official closure on `0.5.8-preview`;
- launch official DSH through the Penglai desktop shell;
- authenticate first navigation with the new one-time token;
- map old ApiProxy calls to owner Remotes;
- map every first-party client module to the new package/injection graph;
- inventory old overlays against official slots;
- classify release gates, operator tools, native verifiers, migrations,
  fixtures, compatibility wrappers, and historical records before removal;
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
6. Identity/build migration: make release identity the single authoritative
   source for product, DSH, Node, and Electron pins; generate or verify required
   manifest/contract copies; migrate lockfile, closure, catalog, SBOM, notices,
   evidence scripts, contract tests, and package builders.
7. IM truth migration: replace the overloaded `live` flag with the closed
   channel state/capability model and permanently remove WhatsApp from active
   product, source, dependency, packaging, test, and roadmap surfaces.
8. Bounded decomposition: extract process supervisor/health ownership while
   repairing P0-01 and split profile/migration seams when they are migrated;
   avoid an unrelated broad refactor based only on file length.

Exit criteria:

- no runtime `apiProxy` dependency;
- no `dsh-client-runtime` injection;
- no obsolete `dsh-host-apiproxy` closure dependency;
- no unjustified rc.2 built-file overlay;
- one authoritative pin source passes cross-package equality checks;
- no ambiguous IM `live` support flag remains;
- no WhatsApp identity, card, route, adapter/runtime, dependency, lockfile
  entry, bundle content, or current-product claim remains;
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
- absence checks proving WhatsApp has no UI entry, manifest/channel identity,
  runtime/dependency, package bytes, support claim, or roadmap placeholder;
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
4. **Optional plugins one at a time:** IM and each supported adapter, Feishu
   text, Feishu image, Feishu voice+ASR, desktop ASR, TTS, Companion. WhatsApp is
   an absence gate, not an adapter test target.
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
- “the WhatsApp card is disabled” therefore WhatsApp has been removed; or
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

### Repository asset classification

Before deleting or relocating a low-reference script, overlay, evidence schema,
fixture, or compatibility wrapper, record its category, owner, actual invocation
path, supported versions, replacement, and retirement condition. Zero ordinary
imports are a review trigger, not deletion proof. Release and native verifiers
may be external entry points; schema versions may form a compatibility chain.
Active WhatsApp product/runtime code is the opposite case: Git preserves its
history, so it must not remain wired into 0.5.8 merely for provenance.

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

For one primary engineer this is roughly 6–10 weeks of total work at the old
starting point. Phase 0 now removes source discovery, retirement, test-design,
and independent-fix work from the post-publication critical path. The estimate
must be recalibrated after published-package reconciliation; native QA on
Windows and both Mac architectures does not reduce the evidence required.

## 9. Definition of ready, done, and released

**Ready for source preparation** means Gate S0 is satisfied and the Owner has
approved the exact source baseline. This state is current.

**Ready for DSH dependency integration** means Gate P0 is satisfied. This state
is not current while the official npm closure is absent.

**Done in source** means all migration and issue acceptance tests pass in a
clean tree, with no forbidden architecture and no unassigned high-severity
finding. Product/DSH/Node/Electron identity has one authoritative source, IM
support truth is unambiguous, and the WhatsApp absence gate passes across source,
dependencies, lockfile, catalog, package closure, SBOM, installer, UI, and
current documentation.

**Release candidate** means exact packages from one source commit pass all three
native installed walks and required live paths with privacy-safe evidence.

**Released** means the owner authorizes publication, the exact accepted assets
are public, their immutable bytes read back successfully, and README/site/release
notes state support and limitations honestly in English first and Chinese
second.

Until all four statements are true at their respective level, the product must
not flatten planning, source, package, native, installed, live, or public state
into “0.5.8 completed.”
