# Penglai 0.5.8 DSH upgrade review

> Review snapshot: 2026-08-28. Recheck all upstream and npm facts immediately
> before implementation. The official DSH repository and published packages are
> authoritative; this document is a Penglai integration review, not an upstream
> specification.

## 1. Executive decision

Penglai must not implement 0.5.8 by first fixing every observed problem against
DSH `0.1.1-rc.2` and then upgrading DSH. That order would produce obsolete
patches, duplicate new upstream capability, and make failures harder to assign.

The correct order is:

1. wait for a complete consumable official DSH package set;
2. create a minimal new-DSH Penglai compatibility skeleton;
3. migrate all removed host and client seams;
4. reproduce every 0.5.7 finding on that skeleton; and
5. fix only the failures still owned by Penglai.

This resolves the apparent “both/and” requirement: 0.5.8 both preserves and
stabilizes the 0.5.7 product functions, and adopts the newest DSH, without
pretending the two DSH architectures are interchangeable.

## 2. Exact upstream state at the review snapshot

| Item | Observed state |
| --- | --- |
| Penglai 0.5.7 DSH | `dsh-v0.1.1-rc.2` |
| Old DSH commit | `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| Candidate source tag | `dsh-v0.1.2-alpha.1` |
| Candidate commit | `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| GitHub release state | prerelease, not draft; published 2026-08-27 |
| Uploaded GitHub assets | none; generated source archives are not npm closure |
| GitHub compare | 1,079 commits ahead of `dsh-v0.1.1-rc.2` |
| npm `@deepseek-ai/dsh` `latest` | `0.1.1-rc.2` |
| npm `@deepseek-ai/dsh` `next` | `0.1.1-rc.2` |
| npm `0.1.2-alpha.1` | not published |

Official references:

- [DSH `0.1.2-alpha.1` prerelease](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.2-alpha.1)
- [DSH old/new comparison](https://github.com/deepseek-ai/deepseek-harness/compare/dsh-v0.1.1-rc.2...dsh-v0.1.2-alpha.1)

The comparison is a platform migration, not a routine dependency patch. Exact
package availability, generated client artifacts, integrity values, and the
final tag must be checked again after the formal package publication.

## 3. Current Penglai coupling that must be retired or migrated

The current tree remains intentionally correct for 0.5.7, but is not directly
compatible with the candidate DSH architecture:

- release identity, build scripts, tests, package manifests, evidence scripts,
  catalog compatibility checks, and the lockfile pin `0.1.1-rc.2` throughout;
- `@penglai/im` declares the old `apiProxy` service;
- `@penglai/dsh-bridge` calls `ctx.apiProxy.sessions.create`, `models`, and
  `selectModel`;
- the closure builder expects `@deepseek-ai/dsh-host-apiproxy`;
- at least ASR, Budget, Companion, IM, Memory, MOSS-TTS, Office, and Plugin
  Center declare/inject the deleted `@deepseek-ai/dsh-client-runtime` facade;
- plugin packaging repeats the old client-runtime injection graph; and
- the 0.5.7 overlay patches exact built Web frontend, Models settings,
  Conversation, and General settings bytes.

The 0.5.8 migration must make these dependencies explicit and remove obsolete
seams; it must not mechanically replace version strings until the new package
graph and product behavior are proven.

The review also found that product, DSH, Node, and Electron identity values are
copied from the release-identity pins into runtime, bridge, registry, package,
and contract surfaces. Package manifests and the release contract still need
machine-readable values, but hand-maintained runtime copies are drift hazards.
0.5.8 must generate or import derived values from one authoritative pin source
and fail a cross-package equality gate when any required copy diverges.

## 4. Upstream architectural changes and Penglai consequences

### 4.1 ApiProxy removal and Remote ownership

The broad legacy ApiProxy is removed. Unary operations move to typed Remote
services owned by the relevant business controller. Remote events use the same
owned service boundary and event allowlist.

Penglai consequence:

- replace session creation, model catalog, model selection, settings, workspace,
  and plugin-inventory ApiProxy calls with their official owner Remote;
- preserve typed errors and reconnect semantics;
- remove `apiProxy` from plugin dependency declarations and closure probes; and
- do not create a Penglai “compatibility ApiProxy,” because that would become a
  permanent second control plane.

### 4.2 Client runtime facade removal

The general `@deepseek-ai/dsh-client-runtime` facade is deleted. Session,
Workspace, conversation, store, rendering, and slot responsibilities are split
into narrower packages and client modules.

Penglai consequence:

- rewrite each first-party client entry against the narrow official package it
  actually needs;
- regenerate and validate each `dsh.client` bundle and explicit injection graph;
- require every expected client fiber to reach `ACTIVE` at boot; and
- reject “package installed but UI fiber pending/absent” as a pass.

### 4.3 Official slots and plugin-owned settings

The candidate adds typed brand, settings, conversation hero/composer/message,
image, attachment, and related slots. A plugin-owned settings namespace can
expose its own settings surface. A shared settings mirror reduces repeated
`settings.describe` readers.

Penglai consequence:

- re-express product branding, hero, settings groups, plugin cards, ASR/TTS
  controls, and IM surfaces through official slots;
- remove exact-hash built-JavaScript overlays wherever an official extension
  seam exists;
- use one settings mirror rather than independent plugin polling; and
- retain a minimal overlay only if a proven product requirement still lacks an
  upstream seam, with a new ADR, digest gate, and regression evidence.

### 4.4 Session projections and titles

The candidate makes session projection the owner of title, selected model,
agent preset, and subagent identity/timing observations. `session.list` exposes
title/projection information.

Penglai consequence:

- IM `/会话` must consume the official projection title;
- remove the current bridge behavior that maps Workspace session IDs to only
  `{ id }`;
- do not scan logs, infer a title from conversation text, or build a parallel
  session-title database; and
- specify a safe display fallback only when the official title is empty.

### 4.5 Durable image attachments

The candidate adds a durable Attachment lifecycle, normalized image admission,
model-provider projection, request-version consistency, provider budgets,
compaction accounting, and conversation/trajectory display.

Penglai consequence:

- channel adapters download and validate vendor bytes, then call the official
  DSH Attachment admission path;
- DSH owns image normalization, storage, model request projection, and display;
- Penglai keeps its Artifact Service for Office/non-image responsibilities
  without inventing a second image Turn representation; and
- acceptance must prove the model received a real image attachment, not merely
  that Feishu displayed an image or that the bot replied generically.

### 4.6 Audio remains outside the new DSH attachment scope

The candidate explicitly does not provide general audio/video Turn support.

Penglai consequence:

- desktop microphone, local ASR, local TTS, Feishu/Weixin voice download, audio
  validation, transcription, playback, and channel delivery remain Penglai
  plugin responsibilities;
- inbound channel voice becomes text through Penglai ASR before it enters the
  official DSH Turn; and
- no audio blob may be disguised as a DSH image/file attachment.

### 4.7 Cancellation

The candidate improves cooperative cancellation, tool cancellation, and
finalization of the already-produced stream prefix.

Penglai consequence:

- migrate the Stop action to the official new Session Controller seam;
- do not patch the old `/api/session.cancel` route;
- separately fix Penglai process-death detection and recovery, because upstream
  cancellation cannot cancel a DSH process that has already died; and
- retest cancellation during text generation, tool execution, subagents,
  channel routing, and process recovery.

### 4.8 Subagent projection and diagnostics

The candidate strengthens official subagent identity projection and bounded
failure diagnostics. It expects a true subagent session to have valid subagent
descriptor semantics.

Penglai consequence:

- preserve genuine user/task subagents in the official hierarchy;
- stop representing a Memory curator maintenance operation as an official
  user-visible subagent session;
- run the curator as a bounded internal job or approved auxiliary official LLM
  operation with its own memory audit ledger; and
- never “fix” the UI by merely hiding curator sessions after creating them with
  invalid semantics.

### 4.9 Plugin inventory and lifecycle

The candidate inventory exposes entry identity, module, effective enabled state,
and phases such as `pending`, `loading`, `active`, `failed`, and `unloading`.
The snapshot does not by itself preserve transaction history or explain every
pending state.

Penglai consequence:

- use official inventory as installed/active truth;
- retain Penglai-owned transaction journal, rollback evidence, timeout reason,
  and owner-facing diagnosis for Plugin Center and Companion;
- do not equate a desired profile write with installation success; and
- do not assume the upstream preset-health work automatically repairs arbitrary
  first-party plugin transactions.

### 4.10 Localization

The candidate has typed locale infrastructure and supports third-party language
registration. Some permission preset labels remain intentionally English in
official source, including `Read Only`, `Workspace Write`, and `Full access`.

Penglai consequence:

- raw Penglai labels such as `mic`, `stop`, and `read` are Penglai localization
  bugs and must use official third-party locale registration;
- official English permission preset labels are not evidence of a broken Penglai
  locale overlay;
- Penglai must not patch DSH built UI to translate them; and
- if complete Chinese preset labels are a product requirement, propose an
  upstream extension/translation or record an explicit owner decision.

### 4.11 Browser authentication and profiles

The candidate adds one-time browser-token authentication and changes profile
launch/composition behavior.

Penglai consequence:

- update the secure loopback proxy, first navigation, refresh, recovery, and
  deep-link tests around the one-time token;
- preserve private DSH_HOME and exact profile composition;
- ensure optional plugin failure never blocks core/Office/Memory; and
- test restart without leaking token material into URLs, logs, renderer state,
  evidence, or diagnostics.

### 4.12 Windows process helpers

The candidate includes lower-level Windows process helpers, but it does not
provide a general Penglai desktop supervisor that owns the packaged Node/DSH
process tree and its user-facing recovery.

Penglai consequence:

- retain ownership of Electron-to-helper-to-Node supervision;
- detect the real DSH Node exit even if `penglai-windows-host.exe` remains alive;
- capture bounded redacted exit diagnostics and restart according to policy;
- make Stop/ASR/IM settings fail with one coherent “core unavailable/recovering”
  state rather than unrelated 502 messages; and
- test orphan-free shutdown and crash loops on native Windows.

### 4.13 IM capability truth is not one boolean

The 0.5.7 tree has conflicting machine meanings for channel availability. Its
live-channel registry admits only Weixin and Feishu, while most channel
manifests expose `live: true`; guided adapters can still report runtime health
as false and reject send. The current settings client consumes the manifest
boolean when describing connector availability. That ambiguity can make an
entry card, bundled adapter, configured account, active connection, tested
capability, and release claim look like the same fact.

Penglai consequence:

- replace the overloaded `live` flag with a closed truth model covering entry
  availability, adapter mode (`native`, `guided`, or `unavailable`), bundled
  runtime, connection state, and release-evidence state;
- record capabilities such as authentication, inbound text, outbound text,
  image, voice, reconnect, and exit separately where they differ;
- derive UI and public support claims from the same authoritative state rather
  than a permissive manifest default; and
- permanently remove WhatsApp instead of representing it as unavailable,
  experimental, disabled, guided, community, or future roadmap.

### 4.14 Repository history is not active product scope

Several scripts, evidence schemas, overlays, and compatibility wrappers have
few or no ordinary imports. That fact alone does not prove they are dead: some
are release hard gates, native/operator verifiers, package entry points,
migration adapters, fixtures, or historical provenance. Conversely, keeping an
active product adapter merely “for history” is unnecessary because Git already
preserves history.

Penglai consequence:

- classify each candidate as release gate, operator tool, native verifier,
  migration compatibility, fixture, active product code, or historical record
  before retaining, relocating, or removing it;
- require an owner, invocation path, supported versions, and retirement rule for
  retained compatibility/evidence assets;
- do not mass-delete on zero-reference search results and do not keep forbidden
  WhatsApp product/runtime code solely as historical evidence; and
- extract supervisor/health boundaries while repairing P0 lifecycle ownership,
  and split profile/migration boundaries when those seams are migrated, without
  a broad line-count refactor that mixes behavior change with architecture work.

## 5. Ownership classification for observed 0.5.7 findings

### A. Use the new official capability; do not duplicate it

- session list titles and projections;
- durable image attachment normalization/model projection;
- Session Controller cancellation semantics;
- typed settings and client slots;
- locale registration infrastructure;
- official subagent identity and bounded diagnostic projection; and
- Remote transport/reconnect behavior.

### B. Old implementation is structurally obsolete

- ApiProxy session/model/settings/plugin calls;
- `dsh-client-runtime` injection;
- old generated Remote assumptions;
- exact-hash rc.2 Web/Conversation/Settings overlays;
- old image admission assumptions; and
- old profile/client-bundle wiring.

### C. Still owned by Penglai after the upgrade

- packaged DSH process supervision and recovery;
- Feishu resource permissions, download, error mapping, async rejection safety,
  voice-to-ASR, and channel capability truth;
- desktop ASR status/recording UX and local TTS first-sound latency;
- QR connection dialog and action feedback;
- Memory curator lifecycle and scope isolation;
- Companion install/enable transaction diagnosis;
- user-facing error translation and one coherent degraded state; and
- exact channel capability truth and permanent WhatsApp absence; and
- native packaging, upgrade, uninstall, privacy, and three-target evidence.

### D. Reproduce after migration before deciding the fix

- Stop during a long multi-agent run;
- IM/ASR settings returning 502;
- 17 visible “subagents” in the affected conversation;
- IM session titles;
- plugin activation `pending`;
- localization parity; and
- all stress failures involving many concurrent subagents and memory jobs.

## 6. Anti-duplication rules

0.5.8 must not add:

- a Penglai session-title index or log scraper;
- a compatibility ApiProxy service;
- a second image normalizer/provider projector;
- an old-route `/api/session.cancel` patch;
- DOM or minified-bundle translation patches;
- per-plugin settings polling when the official mirror is available;
- a hidden second Agent/session system for Memory, Companion, or IM;
- a rule that treats timeout, missing plugin UI, or disappeared errors as PASS;
- a source-tag dependency presented as a reproducible npm release; or
- a rebase of old exact-hash overlays before checking official new slots;
- an overloaded `live` boolean used as entry, runtime, connection, evidence, and
  public-support truth;
- a mass deletion justified only by zero in-repository references;
- a broad refactor justified only by file length; or
- any WhatsApp card, channel identity, adapter/runtime, dependency, packaging
  path, test-matrix entry, support statement, or roadmap placeholder.

## 7. Dependency freeze checklist

Before changing `package.json` or `pnpm-lock.yaml`, record and verify:

- exact official release tag and commit;
- exact npm versions and integrity for DSH plus all referenced packages;
- mutually consistent package publication times and dependencies;
- no missing Remote/client bundle generated artifacts;
- fresh `pnpm install --frozen-lockfile` from a clean clone;
- package licenses and notices;
- source/package provenance and closure graph;
- one authoritative product/DSH/Node/Electron pin source plus a cross-package
  equality gate for every required generated or manifest copy;
- absence of WhatsApp from the active dependency graph, lockfile, catalog,
  package closure, SBOM, notices, and installer contents;
- Node/Electron/platform constraints; and
- a rollback path to the 0.5.7 pin for development only, not as silent runtime
  fallback.
