# ADR 0011 — Plugin Center transaction and provenance

- 状态：ACCEPTED / AMENDED 2026-08-16
- 日期：2026-08-15

## Decision

Penglai Center 是 DSH host/client plugin。事务：validate → snapshot → stage → probe → activate → loader inventory reconcile → health → commit/rollback。

actual state 只来自 `@deepseek-ai/dsh-host-plugin-inventory`。catalog 区分：

- `official-core`
- `penglai-builtin`
- `penglai-first-party`
- `community-reviewed`

alpha.3 用户 catalog 只含 Center、IM 和默认 disabled reference；credentials-keychain、smoke、未来假插件不进入。community-reviewed 仅实现 schema/badge/policy/rejection fixture，不开放任意 npm/Git/URL 或在线市场。

**R3F / 0.5.0 范围修订**：0.5.0 真实 catalog 必须显示 IM/ASR/MOSS-TTS/Context/Memory/Budget/Companion；仍不开放任意 npm/Git/URL，也不显示未实现假卡。事务与 inventory 不变量不变。
