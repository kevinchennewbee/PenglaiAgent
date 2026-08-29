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
requires the separate official message-resource download API. Re-review of the
official pinned SDK and current documentation does not establish another named
media scope: the documented preconditions are bot capability plus the bot and
original message being in the same conversation. The exact original
`message_id`, `file_key`, and resource `type` are then required. The adapter
previously collapsed detailed vendor failure into a generic transient delivery
class, so the user could not distinguish missing scope, wrong resource identity,
expired credential, network failure, or size/type rejection.

**0.5.8 action**

- publish an exact Feishu capability/scope checklist in the connection flow;
- verify required event subscriptions and resource permissions before reporting
  media support;
- preserve a redacted vendor code, request phase, retryability, and corrective
  action in diagnostics;
- expose text-only degraded state when text works but media does not; and
- run live text, image, file boundary, voice, reconnect, and credential-expiry
  tests using the official app path.

**Source diagnostics checkpoint, 2026-08-29**

The Feishu media path no longer collapses every request, stream, validation,
admission, and transcription failure into one undifferentiated transient code.
A closed diagnostic model now records only a phase and reason: credential,
permission, resource identity/not-found, rate, network/server, cancellation,
size/empty/type, unavailable client, or unknown. HTTP-like 400/401/403/404/429
and network/server classes map to stable product causes; raw vendor messages,
tokens, resource keys, response bodies, and URLs are never persisted.

Both acknowledged image/file callbacks and durable voice jobs retain the closed
diagnostic beside the existing retry classification. Runtime validation drops
any out-of-vocabulary phase/reason instead of writing arbitrary caller text to
the audit ledger. The preview gate and focused fixtures freeze this behavior.
This improves diagnosis and retry correctness only; it does not claim that the
Owner app has the required permission or that any real media download passed.

**Capability verification and degradation checkpoint, 2026-08-29**

The connection checklist now publishes the two exact text scopes, the exact
message event, the official message-resource route, and its same-conversation
precondition. Doctor results fail closed when any fact is absent; a configured
or text-connected app is no longer treated as media-capable merely because no
check was supplied.

A failed resource request or stream now durably records a closed media
capability state. While the WebSocket/text connection remains healthy, the IM
overview reports `degraded` for credential, permission, rate, network, server,
client, or otherwise unclassified resource failure. Resource identity/not-found
and local content rejection do not downgrade the whole capability. Only a real,
non-empty `message.resource.get` stream changes the state to `available` and
restores `connected`; source fixtures cannot promote release evidence beyond
`source-only`. Stored state and audit contain only the closed state/reason, never
message IDs, file keys, URLs, response bodies, or credentials. Owner-live media
proof remains open.

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

**Durable phase source checkpoint, 2026-08-29**

The Feishu voice job now persists each Penglai-owned pre-Turn phase as a closed
state: `downloading`, `validating`, `transcoding`, and `transcribing`. A
successful official DSH enqueue terminates the preprocessing job as `queued`;
all active phases remain restart candidates, and the legacy 0.5.7 `processing`
state remains readable so an upgrade cannot strand existing rows. Phase changes
also emit a digest-free closed audit record, and illegal skipped or arbitrary
runtime phase values fail closed.

The transcript and its voice metadata become a `queued` handoff atomically
before the DSH call. If the process dies or the result is uncertain after that
point, channel code no longer rewrites the durable input as a terminal voice
failure; the existing ID-stable queued-inbound recovery path owns the retry and
checks the official inbox before replay.

Focused persistence, routing, and Feishu fixtures prove the exact phase order
and terminal state in source. This checkpoint does not prove Feishu resource
permission, real vendor download, a live ASR model, or an Owner voice message;
those remain live acceptance work.

**Closed voice-cause source checkpoint, 2026-08-29**

Voice failures now retain the durable phase that actually owned the operation
instead of assigning every post-download error to transcription. Codec decode
or normalization rejection is `resource-validation/unsupported-codec`; an ASR
result that explicitly reports no speech is `transcription/no-speech`; and an
available capability descriptor whose model state is not `ready` is
`transcription/model-not-ready`. Other ASR `DSH_UNAVAILABLE` errors remain the
weaker `client-unavailable` class rather than being guessed from error text.

These values are closed, redacted, and fixture-proven. No source result
substitutes for the real Owner voice acceptance case.

**Typed ASR failure source checkpoint, 2026-08-29**

The ASR service now emits a closed failure reason contract for backpressure,
cancellation, deadline expiry, engine unavailability, and a model-readiness
race. Feishu maps that type directly to the transcription diagnostic and never
parses a provider or worker message. An invalid vendor duration is acknowledged
but persisted as `media-admission/duration-rejected`, so it no longer disappears
as an unclassified synchronous callback rejection.

The remaining `unknown` reason is intentional for errors that do not yet carry
a trustworthy typed cause. Live vendor transport, real model execution, and
Owner-account cancellation evidence remain open.

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

The optional Budget service now reserves 4,000 tokens before each auxiliary
call, settles the exact official usage event, and durably releases an unsettled
reservation. Only closed transient provider failures and the queue deadline can
retry, with a global two-attempt cap and a fresh abort signal. Output/schema,
protocol, Workspace, Budget, and terminal-provider failures do not retry.
Memory keeps at most 256 audit rows containing only a SHA-256 operation digest,
closed outcome/code, attempt, and timestamp; prompt text, candidate content,
provider messages, and raw exceptions are never stored there.

This closes the source-level false-subagent, Budget, bounded-retry, and redacted
audit work. P0-05 remains open as a packaged capability until published
alpha.1 declarations/runtime exports are reconciled and installed restart,
hierarchy, live-provider, and privacy-safe Workspace-isolation evidence exists.

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

**Closed activation-diagnostic source checkpoint, 2026-08-29**

The Plugin Center transaction journal now binds the desired present/enabled
state to a bounded sequence of closed official-inventory observations:
`missing`, `pending`, `active`, `disabled`, `failed`, or `unknown`. It retains
at most 32 state changes plus the final activation and rollback readbacks,
records whether convergence verified, timed out, or failed, and emits one of
six closed failure codes. Arbitrary loader phases and exception text are not
written into this trace or rendered by the settings client.

After a failed operation the settings surface refreshes actual state and shows
localized cause-specific recovery copy for activation timeout, runtime outage,
package rejection, damaged profile, rejected action, or rollback failure. A
timeout still restores the last known-good profile; it never turns `pending`
into success or extends the deadline to manufacture a pass.

The rc.2 inventory surface has no verified subscription or separate alpha
client-fiber/loader-error contract, so convergence still uses bounded inventory
sampling. Exact event-driven alpha activation, generated client-fiber fields,
and packaged Companion proof remain blocked on the official npm reconciliation.

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

**Composer ASR lifecycle source checkpoint, 2026-08-29**

The conversation microphone now consumes the typed ASR capability description
on mount and every two seconds, so a new-conversation composer converges after
model download, verification, load, failure, or core recovery without requiring
a remount. This is a bounded typed-Remote refresh, not proof of the unpublished
alpha.1 client event graph or an installed application.

The control exposes closed `idle`, `permission`, `recording`, `transcribing`,
`result`, `no-speech`, and `error` UI phases. Chinese and English accessible
labels replace raw `mic`/`stop`; recording shows an elapsed timer based on wall
time and an explicit Stop action. It deliberately shows no simulated level
meter because this implementation does not measure input amplitude.

Microphone tracks are released after Stop, recorder error, setup failure, and
component teardown. Conversion/transcription failure and no-speech are separate
terminal states, and no-speech never writes an empty composer draft. Source
fixtures prove phase order, localized accessible labels, draft handoff, and
track release. Native permission UI, real hardware capture, installed locale
switching, and model execution remain open acceptance evidence.

### P1-03: Read/TTS first sound is too slow

**Observed symptom**

Read eventually plays, but the user waits a long time with little useful
feedback. The control displays raw `read`/`stop`.

**Evidence and current root-cause hypothesis**

The prior path waited for complete synthesis/output read and then began
playback. The shipped MOSS runtime exposed a real `warmup()` lifecycle, but the
Penglai worker never invoked it, so session creation and warmup were paid only
after the first user request. The path still does not stream playable audio to
the renderer or separate every native latency boundary.

**0.5.8 action**

- measure click-to-request, model-ready, first synthesized chunk/segment,
  first playable audio, and playback start;
- prewarm safely after explicit model enable, or synthesize bounded segments;
- play the earliest valid segment while later work continues where engine
  semantics allow;
- expose preparing/playing/stopped/ended/error/stalled states;
- share one cancellation/resource controller between preview and Read; and
- set and test a product first-sound latency budget on supported native devices.

**TTS control and measurement source checkpoint, 2026-08-29**

The existing service-owned synthesis cancellation is now exposed through the
typed plugin Remote and is consumed by both settings preview and assistant
Read. A second synthesis releases the prior audio immediately, and Read remains
actionable during queueing, synthesis, buffering, and playback so Stop can
cancel the active operation rather than waiting for the complete WAV response.
Component teardown also cancels only its owned active generation.

The shared playback controller now retains closed synthesizing, buffering,
playing, completed, failed, stalled, stopping, and idle states instead of
collapsing terminal events immediately to idle. It marks playing only after the
browser playback promise resolves, revokes each object URL once, and ignores
stale generation events. Localized accessible labels replace the assistant
action's raw `read`/`stop` text.

Source-visible measurements now separate click/request time, complete-WAV
response time, engine first-chunk latency, total synthesis time, and accepted
playback-start time. They are diagnostic boundaries, not proof of the first
audible sample. The current Remote still waits for complete synthesis and WAV
readback, so segmentation/streaming, a native-device latency budget, and
installed first-sound measurements remain open.

**TTS model prewarm source checkpoint, 2026-08-29**

The MOSS worker now calls the attributed runtime's real `warmup()` after its
verified model manifest and ONNX sessions are configured. Successful explicit
model download/import awaits that one lifecycle before returning; synthesis
also awaits it as a cold-start fallback after application restart. Concurrent
callers share the same worker preparation, and synthesis admission is checked
again after it completes.

Warmup failure never promotes a half-initialized worker to ready: the engine is
disposed, the service retains only the independently verified model state, and
the next synthesis creates a clean engine and retries. Focused source tests
prove activation-before-synthesis order, one warmup per retained engine, and
clean retry. This reduces an identified source-owned first-request cost; it is
not native first-sound latency evidence and does not make the complete-WAV
Remote a streaming interface.

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

**Shared connection surface source checkpoint, 2026-08-29**

All eight connector cards now open their existing platform-owned connection
flow inside one page-level modal rather than appending the result below the
entire card grid. Weixin and Feishu retain their official QR operations;
DingTalk, WeCom, QQ, Slack, Telegram, and Discord retain their declared QR,
device-link, token, OAuth, or manifest methods. The wrapper supplies one
labelled dialog, an immediate focus target, Escape and explicit Close actions,
and bounded internal scrolling, while status, QR, expiry, verification,
cancel, retry, credential, and disconnect controls stay adjacent to the action.

The modal deliberately remains open across connection readback instead of
equating a click with success. Source tests prove one shared dialog contract and
the absence of nested dialog semantics. Native focus trapping/restoration,
screen-reader traversal, real QR expiry/retry, and the separate redacted Weixin
transport diagnostic described below were still open at this earlier checkpoint.

**Structured connection failure source checkpoint, 2026-08-29**

Native Weixin/Feishu QR begin and poll operations plus the six guided adapter
begin/poll operations now capture adapter failures at the IM host boundary.
The host persists one closed public failure and returns the same code, localized
message, recovery action, timestamp, and reference ID to the connection modal.
Native and guided overview readback now project that same durable record, so a
refresh does not discard or silently replace the diagnostic reference.

Bounded HTTP MIME, JSON, empty-body, size, and declared-length failures map to
the new `CHANNEL_PROTOCOL` class. The client renders only the localized public
message and reference ID and no longer renders caught exception strings or the
`BOUNDED_HTTP_MIME` implementation code. Transport failures that occur outside
an owned host operation remain generic and do not receive invented references.

The Weixin iLink transport now attaches a typed closed observation to response
failures: one allowlisted request phase, a validated numeric HTTP status, and a
lowercase parameter-free media type (`missing`/`invalid` when it cannot be
represented safely). The host persists that observation beside the same public
reference across refresh and migrates existing failure storage in place. It
never retains the response body, request URL, query, authorization header,
Content-Type parameters, or arbitrary headers. Typed auth, rate, protocol, and
delivery classification takes precedence over message parsing.

The primary failure surface still renders only the localized public message and
reference ID. A default-collapsed Advanced section may read back the same safe
observation beside that reference, explicitly labels it as not a root-cause
claim, and revalidates the closed phase/status/media-type shape in the client
before rendering it.

Persisted failure readback also treats the local database as untrusted. Only a
closed product failure code, a valid `MF-XXXXXXXX` reference, and a bounded
timestamp are accepted; localized copy and recovery action are reconstructed
from the product mapping instead of the stored text. Corrupt or legacy private
text therefore cannot re-enter the UI, and only Weixin rows may retain the
allowlisted iLink observation.

Fixture evidence proves this source boundary and legacy-store migration. A real
Owner-live failure has not been reproduced, so its actual status/media type and
whether the cause is platform, proxy, or environment remain open.

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

**Session title source checkpoint, 2026-08-29**

The existing owner-bound bridge now feeds the IM command menu and desktop
binding chooser from the same Workspace-membership plus Session-title
projection. Workspace order and immutable Session IDs remain the selection
authority, while visible labels use bounded official titles or localized
ordinal fallbacks and never fall back to an opaque Session ID. Duplicate titles
remain distinct numbered choices; a fresh owner read reflects renames,
deletions, Unicode titles, large lists, and reconnects.

The desktop binding summary now resolves the same projected names while keeping
the exact Workspace and Session IDs only as non-visible binding values. The
generated alpha Session list/projection Remote, installed UI readback, and live
Feishu `/会话` proof remain part of package/native/Owner-live reconciliation.

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

**Penglai-owned settings locale checkpoint, 2026-08-29**

ASR and TTS settings now localize the closed model lifecycle instead of showing
raw states such as `not_installed`, `downloading`, or `corrupt`. Their operation
and retry copy is bilingual, and the earlier composer/Read work already removes
the raw `mic`, `stop`, and `read` controls. The Plugin Center's IM summary now
also agrees with the closed registry at eight platforms rather than nine.

Official DSH permission-preset labels remain upstream-owned. Alpha locale-slot
integration, runtime switching, overflow/accessibility, and installed bilingual
readback remain open; Penglai does not patch the official minified UI.

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

**Penglai-owned settings error-boundary checkpoint, 2026-08-29**

ASR, TTS, IM, Office, Memory Sources, Plugin Center, update, and uninstall
settings no longer concatenate caught exception messages or catalog-inventory
error strings into visible copy. Each surface retains an explicit
failed/unavailable state and gives an operation-specific localized retry or
fail-closed next step; TTS playback rejection and IM native-probe operation
codes also stay behind the settings boundary.

This checkpoint does not claim the complete product taxonomy or cross-component
outage deduplication. Typed diagnostic references across every plugin lifecycle,
the single recovery banner, alpha locale integration, and native/installed
readback remain open.

**Plugin transaction reference source checkpoint, 2026-08-29**

The existing closed Plugin Center activation/rollback diagnostic now includes a
stable `PC-XXXXXXXXXXXX` reference derived one-way from the private transaction
identity, plugin identity, and action. The Remote never returns the private
operation UUID, package digest, paths, loader exception, or observation detail;
the advanced UI shows only this reference beside the existing closed failure
code and bounded activation/rollback readback.

This gives one real plugin lifecycle an operator-correlatable user reference
without parsing an exception or inventing a core outage. Other settings
lifecycles still need their own typed backend references, and cross-component
deduplication remains blocked on an authoritative common DSH health signal.

**Voice model operation reference source checkpoint, 2026-08-29**

ASR and TTS model download/import failures now persist a stable namespaced
`ASR-XXXXXXXXXXXX` or `TTS-XXXXXXXXXXXX` reference derived one-way from the
private operation identity and closed error class. Restart readback preserves
the same reference; a resumed operation clears the stale reference before new
work begins. The settings clients show it only for the failed operation and do
not receive the source URL, local path, or raw exception in the failure record;
the reference itself does not embed the operation ID.

The shared reference helper validates its namespace and bounded inputs. Both
operation ledgers validate closed error classes and reference shape when they
restore; the TTS ledger now rejects an unknown persisted error class instead of
accepting it as trusted state. This is source and persistence evidence only, not
an installed model failure reproduction or a common DSH outage signal.

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

**Truthful pressure source checkpoint, 2026-08-29**

The Plugin Center now reports plugin resource pressure without treating the
legacy teardown `workers` counter as concurrency. ASR, TTS, and Memory expose
separately measured active and queued work only where the owning service has an
exact counter. A missing
or failed resource probe stays unavailable rather than becoming zero, and one
probe failure cannot remove the catalog or expose its internal exception text.

The current DSH package/runtime does not provide verifiable counts for true
subagents, active tool calls, plugin/core Remote requests, worker threads, child
processes, or open files. Those dimensions are therefore explicitly `null`
with `DSH_ALPHA_RUNTIME_EVIDENCE_REQUIRED`, not inferred from source objects or
plugin loader state. Native process/file-descriptor evidence, cancellation and
crash stress across the complete matrix, and retention of the first fatal
runtime diagnostic remain open.

**First-cause retention source checkpoint, 2026-08-29**

The desktop recovery boundary now retains the first supervisor diagnostic with
a classified causal trigger. An earlier unclassified startup failure may be
upgraded once by a later process-exit or health-check trigger, but subsequent
gateway/startup noise cannot replace that causal diagnostic in the recovery UI,
clipboard export, or bounded local startup log. The existing supervisor restart
test continues to prove process crash, hung HTTP recovery, exact three-attempt
budget exhaustion, same-port restart, and stop-cancels-restart behavior.

This source checkpoint does not turn a generic HTTP error into a root cause and
does not claim native Windows/macOS crash evidence. Cross-process timestamped
correlation and installed reproduction remain open.

**Executable Penglai job-budget checkpoint, 2026-08-29**

The exact Penglai-owned job ceilings are now one shared executable contract,
consumed by the owning services and surfaced by Plugin Center diagnostics:
ASR admits one active plus seven queued transcriptions, TTS admits one active
plus three queued syntheses, and Memory admits one active plus seven queued
curator jobs. The service admission check rejects the next job, so the matrix
cannot silently drift from the code that applies backpressure.

These are Penglai plugin job budgets only. They do not represent a DSH core
subagent, tool-call, Remote-request, worker-thread, child-process, or open-file
limit. Those DSH dimensions remain unavailable until the fixed alpha runtime
provides verifiable evidence. Native pressure and crash stress remain open.

The diagnostic contract also classifies each measured plugin as within budget,
at a configured dimension or total limit, over budget, unbudgeted, or
unavailable. The client renders that closed state directly and raises an alert
when any active, queued, or combined count exceeds its shared contract. It does
not infer safety from a user comparing two displayed numbers, and an invalid or
missing counter cannot become a false within-budget result.

### P0-07: IM support truth has conflicting machine sources

**Observed symptom**

The settings surface can describe a connector as included or available while
its runtime is guided-only, health is false, send is rejected, no account is
connected, or no live release evidence exists. In 0.5.7 WhatsApp was shown as an
unavailable compatibility card even though its runtime was intentionally
excluded; the Owner has now permanently rejected WhatsApp from 0.5.8 onward.

**Confirmed source cause**

The 0.5.7 live-channel registry admitted only Weixin and Feishu, while most
channel manifests set `live: true`. Host and bridge APIs exposed that manifest
field and the settings client consumed it for connector copy. One boolean was
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

**Source checkpoint, 2026-08-29**

The active eight-channel registry, channel adapters, IM Host Remote, and
settings client now use separate closed facts: `entryAvailable`,
`adapterMode`, `runtimeBundled`, dynamic `connection`, `releaseEvidence`, and
per-capability evidence. Every current registry row is deliberately
`source-only`; capability rows can say only `source-tested`, `not-proven`, or
`not-supported`. The settings client shows those distinctions and no longer
turns packaging or a visible entry into an installed/live support claim.

The old `live` property has also been removed from the six bundled sidecar
adapter contracts rather than hidden at the IM bridge. Their connection result
and health report connection and runtime packaging separately, while
unavailable operations use capability-specific closed failures. The composed
preview verifier rejects reintroduction of the ambiguous property or UI data
attribute. This is source evidence only: packaged, installed, Owner-live, and
public-release proof remain open and may not be inferred from this checkpoint.

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
