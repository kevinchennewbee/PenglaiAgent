# ADR 0031 — DSH 0.1.0-rc.8 pin 与 official brand slots

- 状态：Accepted
- 日期：2026-08-20
- 取代：ADR 0029 的 current product pin；ADR 0023 的 sidebar direct patch

## Context

DSH 在 Penglai 0.5.0 冻结前发布 official prerelease `dsh-v0.1.0-rc.8`。npm `latest` 仍为 rc.7、`next` 为 rc.8，因此升级必须由 exact tag、integrity、兼容测试与产品收益决定，不能按浮动 dist-tag。rc.8 同时声明 sidebar 与 conversation hero 的 official brand single slots，并明确 SQLite 格式与旧版本不兼容。

## Decision

所有直接 DSH 依赖精确钉 `0.1.0-rc.8`，tag commit 为 `141eb6fef83422698aef7a981029e843e8161534`，npm integrity 为 `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`。

Penglai 通过 client module 注册：

- `sidebar.brand.mark`
- `sidebar.brand.name`
- `conversation.hero.brand.mark`

rc.8 overlay 只保留没有公开 seam 的 document title、首次披露和 hero copy/background，且继续受 exact upstream/patched/asset SHA-256 约束。Agent、Session、LLM、Workspace、network 与 loader 不 patch。

SQLite 不兼容不触发迁移实现：0.5.0 继续使用 clean-generation root，不读取、转换或删除 rc.7 与 0.4.1 状态。

## Consequences

- sidebar overlay 文件删除；hero icon 不再由 overlay 替换。
- DSH Web 图片能力透传，但 IM text+voice-only 合同不变。
- rc.7 compatibility/ADR/overlay 保留为历史证据，不再参与 current build。
- exact rc.8 closure、installed Web/slot 行为和 target-native evidence 仍是 release hard gates。
