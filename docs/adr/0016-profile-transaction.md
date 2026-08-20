# ADR 0016 — Private profile transaction

- 状态：ACCEPTED
- 日期：2026-08-15
- RC：RC1 / 由 RC3 实施

## Decision

首次启动必须 seed → offline install → dump-config/loader dry-run → atomic activate。journal 覆盖 staging/activating。失败回滚 last-known-good。不读写 `~/.dsh`。

DSH 子进程 allowlist 至少包含 `DSH_HOME`、`PENGLAI_USER_DATA`、`PENGLAI_DSH_PIN`。缺少 `PENGLAI_USER_DATA` 时 IM 必须硬失败。

## Consequences

F-03 在 RC3 关闭。
