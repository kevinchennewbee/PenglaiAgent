# ADR 0015 — First-party plugin package format

- 状态：ACCEPTED
- 日期：2026-08-15
- RC：RC1 / 由 RC2/RC5 实施

## Decision

第一方插件以不可变 tarball 进入 `Resources/plugins`，catalog sha256 为最终包 hash。host/client entry、permissions、migrations 写在 package manifest。禁止 pending-build。

## Consequences

Center 只安装 app 内签入包。F-05 的 pending-build 在 RC2/RC5 删除。
