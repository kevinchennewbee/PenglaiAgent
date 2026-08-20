# ADR 0022 — Layered Penglai plugin ecosystem

- 状态：ACCEPTED
- 日期：2026-08-16

## Decision

Center 用 provenance class 区分 official DSH core、Penglai built-in、Penglai first-party 和 community-reviewed。

alpha.3 内置 Center/IM；reference 只用于 proof。未来 Penglai 原生插件成熟一个完整能力族再加入。社区包只有完成来源/作者/package identity、许可证、签名或可信 integrity、permissions、DSH/platform/ABI compatibility、sandbox/security、migration/rollback 审核后才能进入。

alpha.3 建 schema/badge/policy/rejection fixture，不联网检索、不接受任意 npm/Git/URL、不显示未实现/未审核假卡。

**R3F / 0.5.0 范围修订**：first-party 六插件（ASR/MOSS-TTS/Context/Memory/Budget/Companion）已进入 0.5.0 硬范围并须真实显示；community-reviewed 仍后置，不开放任意市场。
