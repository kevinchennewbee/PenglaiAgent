# 0.6.3 open plugin management

Status: implementation in progress; no native or publication result is implied.

## Owner decision, 2026-09-18

Complete development, review, PR/main, source CI, all three selected installer
builds and applicable installed validation, immutable publication, public byte
readback, and only then the README and existing website download updates.
The earlier source-only stop instruction is superseded for this version.
Historical releases and their evidence remain unchanged.

Use the exact official DSH 0.1.6-alpha.2 plugin manager as the single package
management engine. Its official UI and agent tool own inspection, installation,
cancellation, bundle enablement/removal, and explicit build-script approval.
Penglai does not impose its historical signed catalog as an ecosystem allowlist
and does not introduce a second package resolver or manager.

Penglai features remain bundled. Memory and IM start enabled; ASR/TTS start
disabled. Memory can be disabled without deleting its package or data. The
application's management infrastructure must stay available. Host plugins run
with the user's process permissions, not inside a per-plugin security sandbox.
Installing a plugin and approving its build scripts are distinct trust decisions.

## Integration boundaries to verify

- Delegate profile launch to the pinned upstream `runProfile` API and supply
  its `ProfileContext.packageManager` from the bundled Node and pnpm. Never
  fall back to a machine-global pnpm or change the DSH core package bytes.
- Preserve application-owned runtime bytes when pnpm changes a user profile.
  Resolve built-in dependencies from exact bundled artifacts, not unpublished
  `@penglai` names in a public registry.
- Mount one official manager with the Penglai infrastructure as its owner, so
  the official self-protection also protects the product's management entry.
  The standalone profile manager row must not create a duplicate service.
- Keep the existing startup-only reload model unless separately validated.
  `restart-required`, failed, cancelled and applied are different outcomes.
  A saved toggle is not evidence of a live activation.
- Preserve an intentionally disabled Memory through restart and data-generation
  upgrades. Missing, duplicate or unhealthy enabled Memory must still fail
  readiness. Retained disabled code is not reported as healthy active Memory.
- Migrate current management defaults without overwriting user bundle choices,
  conversation data, credentials, workspaces, or unrelated profile settings.
- Validate real upstream manager behavior, package runtime invocation, hostile
  PATH, cancellation restoration, built-in retention, and restart semantics.
- Retain UOS native usage as OWNER_POST_RELEASE; verify package/ABI/closure and
  do not manufacture native UOS evidence. No timed two-hour soak is introduced.

## 中文

本轮授权包括开发、审查、合并、源码 CI、三目标安装包与相应验证、正式发布、公网
文件回读，最后更新 README 和既有官网；不再停在源码阶段。发布前不更新下载声明。

官方 DSH 管理器是唯一包管理后端。保留蓬莱内置功能，记忆默认启用、可以停用但
不能通过管理器删除；停用不得删除数据。使用应用内固定 Node/pnpm，不回退系统
命令。安装包内核保持固定，用户插件在用户 profile 内管理。插件代码不具有进程级
安全隔离。必须如实呈现需要重启、失败、取消和已应用，不以界面成功替代实际验证。
