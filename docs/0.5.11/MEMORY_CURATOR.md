# 0.5.11 Memory curator (actual official API)

This reconciles older “curator Agent/Session” wording with the shipped
`@penglai/memory` path on DSH `0.1.2-rc.1`. It does not add a second Agent core.

## What runs

After official `session/event` `turn/end`, Memory enqueues one internal job per
`(workspaceId, sessionId, turnId)` on `InternalCuratorQueue` (max two attempts).

The job calls official `ctx.llm.stream` once:

- `sessionId` is omitted
- `tools` is `[]`
- the prompt `source` is `{ kind: "plugin", plugin: "@penglai/memory" }`
- provider/model come from the official Agent route of that Session

Late tool blocks and an already-aborted signal fail closed. Parse failures
fail open for the user Turn and enqueue no candidates.

## What does not run

- No user-visible curator Session or `origin: subagent`
- No official Jobs / workbench task engine
- No second conversation UI
- No auto-write to personal/global/SOP; those still need Owner confirmation
- Auto-save is only current-Workspace safe project facts after Host policy

Audit rows store a digest and closed failure metadata, not chat bodies.

See `packages/memory/src/index.ts`, `turn-pipeline.ts`, `v2/internal-curator.ts`,
and `turn-pipeline.test.ts` (“one official LLM request without Session or tools”).

## 中文

0.5.11 的记忆整理不再创建可见 Session。它在官方 `turn/end` 后用 Memory 内部队列
发一次禁用工具的 `ctx.llm.stream`。失败对用户 Turn 失败开放，不写入半份记忆。
个人/全局/SOP 仍需 Owner 确认。
