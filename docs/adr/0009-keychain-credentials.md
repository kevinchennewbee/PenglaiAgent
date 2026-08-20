# ADR 0009 — Keychain credentials provider（历史，已取代）

- 状态：SUPERSEDED_BY_ADR_0018
- 原日期：2026-08-15
- 取代日期：2026-08-16

旧决定曾要求 `@penglai/credentials-keychain` 覆盖 official credentials provider。Owner 已明确否决这条产品路径，并用 official credentials-local YAML 完成真实 BYOK。

alpha.3 不 pack、catalog、load 或默认测试 Keychain provider；production secret 统一经 official credentials service/local YAML。历史源码可暂留以支持检测/显式迁移旧 profile/item，但不能成为 fallback。当前决定见 ADR 0018。
