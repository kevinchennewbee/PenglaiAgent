# Penglai 0.5.12 independent DSH session-API review

Status: **source review of first-party usage against official DSH
`0.1.3-alpha.1` / `0.1.3-alpha.2`**. This is not native, installed,
live-account, or public-release evidence. It does not freeze a cohort and
does not close `docs/0.5.12/TODO.md` U01/U02.

Reviewed: 2026-09-08.

- Repository: `origin` `kevinchennewbee/PenglaiAgent` on branch `codex/0.5.12`
- HEAD: `87f6aec04b2b77d45a5c2b280d1b75332a80eb33` (published `main`)
- Current freeze still in pins: DSH npm `0.1.2-rc.1` /
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d`
- Public product identity remains **0.5.11** until F04/F05
- Owner `AGENTS.md` / `docs/0.5.7/RELEASE_RUNBOOK.md` were not read as
  product contract and were not edited

Method: search `packages/`, `apps/desktop`, `overlays/`, `profile-seed/`,
and `scripts/`; read the live first-party call sites; compare against
installed `0.1.2-rc.1` types and against GitHub tag sources
`dsh-v0.1.3-alpha.1` (`d347e703908d0406b7a7ef80e3a0e594d86b2215`) and
`dsh-v0.1.3-alpha.2` (`82a5fd61a7cf5c293cec4bdff68f455398d685e9`).

Naming trap: Penglai `packages/dsh-bridge/src/alpha2-owner-adapter.ts` is
the **0.1.2-rc.1 Session Controller** adapter. It is not the 0.1.3-alpha.2
API. Production IM loads that adapter via `hostFromAlpha2Cordis`.

## Upstream contracts used for classification

alpha.1 (`dsh-v0.1.3-alpha.1` release notes and
`packages/session/session-persistence/src/index.ts`,
`packages/core/agent-loop/src/index.ts`,
`packages/core/session/src/known-event-types.ts`):

- Persistence is handle-owned. `ctx.sessionPersistence` exposes
  `create` / `open` / `stat` / `list` / `flush`. `create`/`open` return
  `SessionHandle` (`read` / `append` / `flush` / `close`). There are no
  id-addressed `locate` / `inspect` / `load` / `append(id, events)`.
- `AgentLoop.create(id, options, meta)` is `async` and returns
  `Promise<Agent>`. Installed rc.1 is synchronous and returns `Agent`.
- Write ownership is exclusive. `open(id, 'write')` rejects with
  `SessionAlreadyOwnedError` when another handle (or process) holds the
  session.
- Session format v2. Known catalog **drops** `assistant/chunk` and **adds**
  `assistant/attempt`. Assistant streams settle by attempt; Web keeps
  incremental rendering. Adjacent-generation migration converts v0/v1.

alpha.2 (`dsh-v0.1.3-alpha.2` release notes and DSH
`packages/preset/persona/src/index.ts`,
`packages/core/system-prompt/src/index.ts`,
and DSH docs/subsystems/subprocess.md):

- Persona config splits into `prefix` / `suffix`. Section names become
  `deployment:persona-prefix` and `deployment:persona-suffix`. Installed
  rc.1 still uses `Config.text` and `deployment:persona`.
- Ordinary `SubprocessHandle` drops `pid`. Terminal handles keep `pid`.
- Web disconnect auto-recovery is a DSH client/connection fix.
- Long-session open/resume/continue uses less memory; callers that
  materialize the whole log fight that design.

`sessionController.inspect` still exists on alpha.1/alpha.2 and still
returns a full event prefix via `sessionQuery.observeSession`. That remote
is not the deleted persistence `inspect`.

## Verdict

First-party code does **not** call `ctx.agentLoop.create` or
`ctx.subprocess`. The breaks are the persistence script, fail-closed
session vocabulary, durable `assistant/chunk` readers, persona section
name, overlay hash lock, companion/IM write ownership after attach, and
full-log inspect/snapshot on every listed session.

| Theme | Class | Why |
| --- | --- | --- |
| Persistence `locate`/`inspect`/`load` | **must-change** | Only first-party caller is the alpha session-replay gate; those methods are gone. |
| `ctx.agents.create` / `resume` | **verify** | Public factory is already `Promise`. `agentLoop.create` itself has no first-party caller. |
| Session write lock | **must-change** (companion attach + IM resume) | Dedicated companion sessions are attached to the Workspace; IM resumes cold sessions. `SessionAlreadyOwnedError` is unhandled. |
| Session log v2 | **must-change** | Fail-closed `KNOWN_SESSION_EVENT_TYPES`; budget/onboarding still key `assistant/chunk`; onboarding durable path walks `session.events`, which rc.1 `Session` does not expose. |
| Persona prefix/suffix | **must-change** | Plugin Center identity still names `deployment:persona`. |
| Ordinary subprocess `pid` | **ignore** | No first-party `SubprocessHandle` consumer. Node `child.pid` / `process.pid` are not that seam. |
| Web disconnect recovery | **verify** | First-party pages already bind `connection.generation`. Overlay conversation bytes are hash-locked to `0.1.1-rc.2` and must be rebuilt for 0.1.3, but that is overlay identity, not a Penglai reconnect implementation. |
| Long-session memory | **must-change** (list/inspect) / **verify** (live snapshot) | `listSessions` inspects every cold log to fold title/model. Live `snapshotEvents()` still exists on rc.1 `Session`. |

## Usage table

Columns: **path** | **symbol** | **line** | **why** | **class**.

Class is one of `must-change` / `verify` / `ignore`.

### alpha.1 — SessionHandle / persistence

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `scripts/verify-dsh-alpha-session-replay.mjs` | `sessionPersistence.locate` | 81 | Writes a v0 JSONL through the deleted `locate(meta).path` seam. alpha.1 has no per-id location API; export is `SessionHandle.read`. | must-change |
| `scripts/verify-dsh-alpha-session-replay.mjs` | `sessionPersistence.inspect` | 110 | Deleted. Replacement is `open(id, 'read')` then `handle.read()`. | must-change |
| `scripts/verify-dsh-alpha-session-replay.mjs` | `sessionPersistence.load` | 111 | Deleted. Crash repair is no longer a persistence entry point; resume goes through a write handle. | must-change |
| `scripts/verify-dsh-alpha-session-replay.mjs` | `EXPECTED_ALPHA_SHA` | 8 | Still pinned to rc.1 `a66e4702…`. Cannot evidence 0.1.3-alpha.1/2. | must-change |
| `scripts/verify-dsh-alpha-owner-remotes.mjs` | `EXPECTED_ALPHA_SHA` | 8 | Same rc.1 SHA pin for Session Controller source tokens. | must-change |
| `packages/companion/src/index.ts` | `inject` `"sessionPersistence"` | 34 | Required Cordis inject of the persistence service. Service name is unchanged; companion never calls `locate`/`load`/`inspect`. | verify |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `AlphaSessionController.inspect` | 21 | This is Session Controller inspect, still present on alpha.1/2 via `sessionQuery`. Not persistence `inspect`. Re-evidence that the returned `events` are v2 logical records. | verify |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `controller.inspect` | 135 | Cold list title fold reads the complete prefix of every session. Handle/query still returns events, but full-prefix inspect is the long-session anti-pattern. | must-change |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `controller.inspect` | 165 | Same full-prefix inspect for model-selection fold. | must-change |
| `packages/plugin-center/src/onboarding.ts` | `OfficialSessionLog.events` | 8–11, 932 | Live rc.1 `Session` has `snapshotEvents()`, not `.events` (`session-snapshot.test.ts` asserts `"events" in session === false`). Durable onboarding recovery walks a non-official field. | must-change |
| `packages/plugin-center/src/onboarding.ts` | `session.flush` | 1089 | Optional `handle.agent.session.flush`. Durability barrier on alpha.1 is `SessionHandle.flush`. Confirm whether live `Session.flush` remains. | verify |
| `packages/dsh-bridge/src/rc2-owner-adapter.ts` | `hostFromRc2Cordis` | 43 | Historical 0.1.1-rc.2 ApiProxy. Production IM does not load it. | ignore |
| `scripts/verify-058-migration-inventory.mjs` | `alpha1-owner-adapter.ts` | 125 | 0.5.8 inventory still names a file that is now `alpha2-owner-adapter.ts`. Not a 0.1.3 session consumer. | ignore |

### alpha.1 — async `agentLoop.create`

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| *(none)* | `ctx.agentLoop.create` | — | No first-party caller of the factory that became async. | ignore |
| `packages/plugin-center/src/onboarding.ts` | `OfficialUsableCtx.agents.create` | 38–52 | Type is already `Promise<AgentHandle>`. Matches public `ctx.agents.create`. | verify |
| `packages/plugin-center/src/onboarding.ts` | `ctx.agents.create` | 1050 | Already `await`ed. Re-run wizard nonce/first-turn against async factory + write-handle acquire. | verify |
| `packages/companion/src/index.ts` | `CordisContextLike.agents.create` | 117–122 | Already typed `Promise<AgentHandleLike>`. | verify |
| `packages/companion/src/index.ts` | `agents.create` | 648 | Already `await`ed dedicated-session create. | verify |
| `packages/companion/src/index.ts` | `agents.resume` | 678 | Already `await`ed. Resume now takes a write handle first. | verify |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `agents.resume` | 119 | IM cold resume. Already async. | verify |
| `packages/dsh-bridge/src/index.ts` | `resumeAgent` | 272–276 | Wakes a non-live session before followup. | verify |

### alpha.1 — session lock

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/companion/src/index.ts` | `resumeDedicated` | 670–674 | Refuses an in-process live Agent it does not own. Does not catch `SessionAlreadyOwnedError` from persistence when Web already holds the write handle. | must-change |
| `packages/companion/src/index.ts` | `workspace.attachSession` | 839 | Enable attaches `penglai-companion-*` to the Workspace, so the Web sidebar can open the same session the companion process holds. | must-change |
| `packages/dsh-bridge/src/index.ts` | `this.host.resumeAgent` | 275–276 | IM followup resumes a cold session. If Desktop Web already owns that id, resume must fail honestly or reuse the live Agent. | must-change |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `resumeAgent` | 116–121 | Same resume path for production IM. | must-change |
| `packages/plugin-center/src/onboarding.ts` | `handle.dispose` | 1094 | Probe session is disposed after the turn; lock should release. Confirm dispose closes the write handle before wizard attach races Web. | verify |
| `apps/desktop/src/electron-main.ts` | `requestSingleInstanceLock` | 308 | Electron instance lock, not DSH session lock. | ignore |

### alpha.1 — session log v2

Installed rc.1 catalog includes `assistant/chunk`. alpha.1 catalog
replaces it with `assistant/attempt`. `SESSION_FORMAT_VERSION` on rc.1 is
`0`; v2 is a new on-disk generation.

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `KNOWN_SESSION_EVENT_TYPES.has` | 60 | Fail-closed. A required v2 `assistant/attempt` (or any new type) throws `DSH_CONTRACT_DRIFT` unless `ignorable === true`. | must-change |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `KNOWN_SESSION_EVENT_TYPES.has` | 87 | Same fail-closed title fold. | must-change |
| `packages/budget/src/index.ts` | `assistant/chunk` | 137 | Settles token usage from `chunk.type === "usage"` on durable/live `session/event`. v2 does not persist `assistant/chunk`. Live Web incremental is not a contract that this event type still fires. | must-change |
| `packages/plugin-center/src/onboarding.ts` | `durableFinalFromOfficialSession` | 936 | Assembles finals from durable `assistant/chunk` then `assistant/message`. Chunks are not in the v2 catalog. | must-change |
| `packages/plugin-center/src/onboarding.ts` | `viewOfficialSessionEvent` / `onEvent` | 1032 | Live firehose still concatenates `assistant/chunk`. Re-evidence whether Web incremental remains this event type. | verify |
| `packages/plugin-center/src/onboarding.ts` | `deriveMessages` | 946 | Fallback if `.events` is empty. Still valid if derivation reads settlements. | verify |
| `packages/dsh-bridge/src/plugin.ts` | `listenOfficialEvents` | 61–77 | Delivers IM finals from live `assistant/message` + `turn/end`. `assistant/message` remains in the v2 catalog. | verify |
| `packages/dsh-bridge/src/plugin.ts` | `recoverOfficialTurnDelivery` | 148–156 | Crash recovery keys durable `assistant/message` / `turn/end` / inbox splices. Must accept attempt settlements and ignore missing chunks. | verify |
| `packages/companion/src/index.ts` | `onSessionEvent` | 519–524 | Live `assistant/message` then `turn/end`. | verify |
| `packages/companion/src/index.ts` | `replay` | 589–603 | Replays `snapshotEvents()` for `turn/start`, `user/message`, `assistant/message`, `turn/end`. | verify |
| `packages/memory/src/index.ts` | `sessionEventParts` | 687 | Curator ingest uses `assistant/message` + `turn/end`. | verify |
| `packages/memory/src/turn-pipeline.ts` | `sessionEventParts` | 254–282 | Parses official `(session, event)` firehose. No chunk dependency. | verify |
| `packages/contracts/src/session-snapshot.ts` | `snapshotEvents` | 5–15 | Official live-session read. rc.1 `Session.snapshotEvents` still exists; confirm v2 live Session still exposes it (vs handle `read`). | verify |
| `packages/dsh-bridge/src/owner-ports.ts` | `DshAgentLike.session.snapshotEvents` | 7 | IM durable-message check. | verify |
| `packages/dsh-bridge/src/index.ts` | `hasDurableMessage` | 78–82 | Reads `agent/inbox/spliced` from snapshot. Type remains in v2 catalog. | verify |
| `packages/dsh-bridge/src/plugin.ts` | `recoverOfficialDeliveriesFromHost` | 199 | Snapshots every live session log at IM recover. | verify |
| `packages/budget/src/index.ts` | `reconcileClosedTurns` | 167 | Snapshots whole log to release turns. | verify |
| `packages/companion/src/index.ts` | `AgentLike.session.snapshotEvents` | 55 | Required on companion Agent. | verify |
| `packages/dsh-bridge/src/session-snapshot.test.ts` | `Session.create` / `snapshotEvents` | 6–16 | rc.1 contract test. Must be re-run on v2 `Session`. | verify |
| `scripts/verify-dsh-alpha-session-replay.mjs` | `meta.version` / `snapshot.meta.version` | 76, 113 | Asserts format version `0`. v2 migration must not keep this assertion. | must-change |
| `packages/runtime/src/dsh-home-upgrade.ts` | `DSH_HOME_TARGET_VERSION` | 23 | Copies `storages/sessions/*.jsonl` as opaque user state to `dsh-v0.1.2-rc.1`. Next generation pointer and replay gate must move with the frozen successor; Penglai must not rewrite logs. | must-change |
| `packages/runtime/src/generation-migrate.ts` | `migrateRc8UserData` | 267–326 | Historical rc.8 → rc.1 backup. Not a 0.1.3 consumer. | ignore |

### alpha.2 — persona prefix / suffix

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/plugin-center/src/identity.ts` | `PERSONA_SECTION_NAME` | 3 | Still `"deployment:persona"`. alpha.2 registers `deployment:persona-prefix` and `deployment:persona-suffix`. Placeholder neutralization never sees the new names. | must-change |
| `packages/plugin-center/src/identity.ts` | `applyPenglaiProductIdentity` | 80 | Matches only `deployment:persona` / `penglai:identity`. | must-change |
| `packages/plugin-center/src/identity.ts` | `installPenglaiProductIdentity` | 108 | Still listens on `system-prompt/assemble`. Event name is unchanged; section names are not. | verify |
| `packages/plugin-center/src/index.ts` | `installPenglaiProductIdentity` | 631 | Production install of the identity waterfall. | must-change |
| `packages/plugin-center/src/identity.test.ts` | `deployment:persona` | 36, 40, 87, 97, 100 | Tests encode the old single-section name. | must-change |
| `packages/plugin-center/src/identity.ts` | `HARNESS_IDENTITY_NAME` | 2 | `harness:identity` opener is independent of the persona split. Re-check order vs `DEPLOYMENT_PERSONA_PREFIX` (order 0) and suffix (order 10200). | verify |
| `profile-seed/web/cordis.yml` | *(empty array)* | 1 | No persona config. | ignore |
| `profile-seed/web/cordis.patch.yml` | plugin insert list | 1–24 | No `@deepseek-ai/dsh-persona` row and no `personaPrefix`/`text`. | ignore |

### alpha.2 — ordinary subprocess handle without `pid`

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| *(none in packages/apps/scripts)* | `SubprocessHandle.pid` | — | No import of `@deepseek-ai/dsh-subprocess` and no `ctx.subprocess` consumer. | ignore |
| `packages/runtime/src/index.ts` | `child.pid` | 1424, 1619, 1648 | Node `ChildProcess` of the embedded DSH supervisor, not DSH ordinary spawn handle. | ignore |
| `packages/memory/src/engine/process-supervisor.ts` | `this.child?.pid` | 27 | Mnemon child, not DSH subprocess. | ignore |
| `packages/runtime/src/dsh-home-upgrade.ts` | writer-lock `pid` | 218, 244 | Penglai migration lock identity. | ignore |
| `packages/runtime/src/process.ts` | `id.pid` | 85–98 | Penglai process-tree stop. | ignore |

### alpha.2 — Web disconnect recovery

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/office/src/dsh-client.js` | `useConnectionGeneration` | 135 | Reloads settings when DSH connection generation changes. Auto-recovery is upstream; Penglai must not double-reload or drop in-flight remotes. | verify |
| `packages/memory/src/dsh-client.js` | `connectionGeneration` | *(same pattern)* | Same generation hook. | verify |
| `packages/budget/src/dsh-client.js` | `connectionGeneration` | *(same pattern)* | Same generation hook. | verify |
| `packages/companion/src/dsh-client.js` | `connectionGeneration` | *(same pattern)* | Same generation hook. | verify |
| `packages/im/src/dsh-client.js` | `connectionGeneration` | *(same pattern)* | Same generation hook. | verify |
| `packages/contracts/src/connection-recovery.test.ts` | `pageClients` | 8–14, 41–57 | Locks the official `hooks.connectionGeneration` contract. Re-run against 0.1.3 connection types. | verify |
| `apps/desktop/src/electron-main.ts` | `observeOfficialWebsocket` | 253 | One-shot probe of `/api/remote.mux`. Not a reconnect implementation. | verify |
| `apps/desktop/src/navigation-retry.ts` | `loadWindowUrl` | 19 | Retries `BrowserWindow.loadURL` on `ERR_ABORTED`. Page load, not DSH mux recovery. | ignore |
| `apps/desktop/src/electron-main.ts` | `session.defaultSession` | 345, 362 | Electron cookie/permission session, not DSH Session. | ignore |
| `overlays/dsh-0.1.1-rc.2/manifest.json` | `dsh` | 2 | Overlay identity is `0.1.1-rc.2`. Conversation client is hash-pinned. 0.1.3 disconnect recovery lives in DSH Web; Penglai must re-derive overlay bytes, not patch reconnect itself. | must-change |
| `scripts/apply-overlay.mjs` | `loadOverlayManifest` | 54 | Hard-coded `overlays/dsh-0.1.1-rc.2`. Will fail closed on 0.1.3 frontend hashes. | must-change |
| `packages/im/src/host.ts` | `disconnectChannel` / `reconnectWeixin` | 745, 1165 | IM adapter reconnect, not DSH Web mux. | ignore |

### alpha.2 — long-session memory

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `listSessions` | 131–145 | Inspects **every** cold session and folds the full event array for title. This is the first-party path that will undo DSH long-session memory work. Use list projections / suffix reads. | must-change |
| `packages/dsh-bridge/src/alpha2-owner-adapter.ts` | `describeSessionModels` | 154–169 | Inspects the full log when the list projection is stale. | must-change |
| `packages/contracts/src/session-snapshot.ts` | `snapshotOfficialSession` | 9–19 | Materializes the live prefix. Acceptable for IM recovery of **live** agents; do not use it to scan every cold session. | verify |
| `packages/dsh-bridge/src/plugin.ts` | `recoverOfficialDeliveriesFromHost` | 193–200 | Snapshots only sessions with a live Agent. | verify |
| `packages/companion/src/index.ts` | `replay` | 589 | Full snapshot of the dedicated companion session on resume. | verify |
| `packages/budget/src/index.ts` | `reconcileClosedTurns` | 167 | Full snapshot per live agent at plugin apply. | verify |
| `packages/memory/src/engine/service.ts` | `personalDataDir` | 15 | Penglai Mnemon personal store. Not DSH long-session memory. | ignore |

### Cohort identity that blocks consumption (not a session call, but U02 cannot proceed without it)

| path | symbol | line | why | class |
| --- | --- | --- | --- | --- |
| `packages/dsh-bridge/src/index.ts` | `PINNED_DSH` | 19 | `assertDshVersion` refuses anything other than `0.1.2-rc.1`. | must-change |
| `packages/im/src/index.ts` | `inject` `"sessionController"` | 54 | Still the correct owner name on alpha.1/2. | verify |
| `profile-seed/web/package.json` | `dsh.profile.bundles` | 16–21 | Still `dsh-base` + `dsh-web-app` at product 0.5.11. Bundle composition must be re-frozen with the successor. | verify |

## What was searched and is not a break

- No first-party `SessionHandle`, `agentLoop`, `SessionAlreadyOwnedError`,
  `personaPrefix`, `personaSuffix`, or `ctx.subprocess` identifiers.
- `packages/runtime` `pid` values are supervisor/Mnemon/lock identity.
- IM/Feishu/Slack/Discord `disconnect` is channel transport.
- Memory `personal` / `memory.personalize` is Workspace-vs-personal
  Mnemon scope, not DSH persona.
- `apps/desktop` `session.defaultSession` is Electron.
- Overlays under `overlays/dsh-0.1.0-*` and `dsh-0.1.1-rc.1` are
  historical; only `dsh-0.1.1-rc.2` is applied.

## Required adaptation (U02), not done on this tree

1. Replace persistence `locate`/`inspect`/`load` in
   `scripts/verify-dsh-alpha-session-replay.mjs` with handle
   `create`/`open`/`read` and v2 migration assertions.
2. Stop fail-closed folding on the rc.1 `KNOWN_SESSION_EVENT_TYPES` set;
   accept `assistant/attempt` and stop requiring durable `assistant/chunk`.
3. Point Plugin Center identity at `deployment:persona-prefix` /
   `deployment:persona-suffix` (keep `penglai:identity` /
   `harness:identity` unless upstream drops them).
4. Handle `SessionAlreadyOwnedError` on companion attach and IM resume
   (reuse live Agent in-process; fail honestly across processes).
5. Stop inspecting every cold session in `listSessions` /
   `describeSessionModels`; trust list projections or suffix reads.
6. Rebuild the UI overlay against the frozen 0.1.3 frontend hashes.
   Disconnect recovery stays in official DSH Web.
7. Move `PINNED_DSH` / home-upgrade target / replay SHA only as part of
   the atomic F04 freeze.

## 中文摘要

这是对 `codex/0.5.12` 第一方代码相对官方 DSH `0.1.3-alpha.1/alpha.2`
会话 API 的独立源码审查，不是队列冻结或发布证据。仓库里没有
`SessionHandle` 或 `agentLoop.create` 调用；公开 `ctx.agents.create` 已经
是异步。会断的是：会话回放门禁仍走已删除的 `locate/inspect/load` 且断言
format v0；桥接层用 rc.1 的 `KNOWN_SESSION_EVENT_TYPES` 失败即关闭，v2
新增的 `assistant/attempt` 会被当成契约漂移；预算与引导仍从持久化
`assistant/chunk` 拼最终文本和用量，而 v2 目录已去掉该事件；插件中心身份
仍绑定 `deployment:persona`，alpha.2 已拆成 prefix/suffix；陪伴把专用会话
`attachSession` 进 Workspace，IM 冷恢复同一 id 时未处理写锁
`SessionAlreadyOwnedError`；`listSessions` 对每个冷会话做全量
`inspect`，与 alpha.2 长会话降内存相反。普通 subprocess `pid` 无第一方消费。
Web 断线恢复应留在官方 DSH，蓬莱设置页已绑 `connection.generation`，但
overlay 仍锁 `0.1.1-rc.2` 哈希，必须随 0.1.3 前端重做。`PINNED_DSH` 仍是
`0.1.2-rc.1`，在 F04 原子冻结前不能假装已消费 alpha.2。

## Reviewer session identity

Quoted from this reviewer session
`/Users/agent/.grok/sessions/%2FVolumes%2FKevinSSD-in%2Fmacmini%2FPenglaiAgent/01a07fbc-0dd6-76d2-a570-614cad697398/summary.json`:

- `current_model_id`: `grok-4.6`
- `reasoning_effort`: `xhigh`
