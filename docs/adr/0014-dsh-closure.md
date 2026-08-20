# ADR 0014 — Official DSH production closure

- 状态：ACCEPTED
- 日期：2026-08-15
- RC：RC1 / 由 RC2 实施

## Decision

使用 frozen lock 在隔离目录安装 `@deepseek-ai/dsh@0.1.0-rc.6` 的 production dependency tree，再复制到 `runtime/dsh`。禁止只复制顶层 package。embedded Node 必须能从空 NODE_PATH / 非仓库 cwd 执行 `lib/bin.js --version` 与 `--dump-default-config`。

## Consequences

F-02 在 RC2 用真实 `--version` 关闭。
