# ADR 0008 — Private DSH_HOME and profile transactions

- 状态：ACCEPTED
- 日期：2026-08-15

## Decision

Penglai 使用 `~/Library/Application Support/Penglai/dsh-home`（或测试覆盖的 `PENGLAI_USER_DATA`）作为唯一 `DSH_HOME`。不读写用户 `~/.dsh`。

Profile 变更走 journal + staging + atomic activate + last-known-good。失败回滚，不留半装。
