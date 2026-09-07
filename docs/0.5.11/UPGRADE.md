# Penglai 0.5.11 upgrade design (development)

There is **no authorized 0.5.11 installer**. This document is the migration
design required by the development cohort freeze. Do not run it as a public
upgrade guide until V09/V10 and P03/P04 exist.

## From public 0.5.10

Public 0.5.10 already uses DSH `0.1.2-rc.1`. A later 0.5.11 publication that
keeps this freeze does **not** change the DSH generation. The product still:

1. Preserves the previous DSH Home generation on disk.
2. Prepares the new generation in isolation.
3. Switches the active pointer only after runtime and required-plugin health
   checks.
4. Leaves the previous generation available for rollback.

Office and Memory stay required and enabled. Messaging, ASR, TTS and Companion
stay optional and default off.

## Windows payload activation

NSIS must copy the new tree to `$INSTDIR.pending`, then rename the live tree
to `$INSTDIR.previous`, then activate pending. Copy or activate failure
restores `$INSTDIR.previous`. Live `RMDir /r "$LOCALAPPDATA\Penglai\app\0.5"`
before the new copy exists is forbidden. This is implemented in
`scripts/nsis/Penglai.nsi` and asserted by `assertWindowsUpgradeStaging`. It
has **not** been executed on Windows in this session.

## Plugin Center and profile

Interrupted Center transactions restore the latest last-good profile. Failed
rollback remains unresolved rather than presenting a stale success. Completed
update journals become CURRENT only when the running version matches or
supersedes the committed version.

## Mnemon

Memory native remains Mnemon `0.2.4`. An upgrade to `0.2.7`/`0.2.8` is a
separate asset freeze: three-target archives with exact SHA-256, runner
version pin, old-database copy, rollback, and Windows special-character path
evidence. See `MNEMON.md`. Do not mix Mnemon generations inside one release.

## What an operator must not do yet

- Build or distribute 0.5.11 installers from this dirty tree.
- Retitle `package.json` / `release-contract.json` to 0.5.11 without
  publication authorization.
- Rewrite 0.5.10 tags or assets.
- Treat historical 0.5.7 runbook commands as the 0.5.11 procedure.

## 中文

当前没有可执行的 0.5.11 升级包。本文只固定开发期迁移设计：保留上一代 DSH
Home，健康检查后再切指针；Windows 先写 `$INSTDIR.pending` 再替换；插件中心
恢复最近一次成功配置。Mnemon 仍钉在 0.2.4。在三端干净 SHA 安装包和发布授权
出现之前，不要把本文当成用户升级手册。
