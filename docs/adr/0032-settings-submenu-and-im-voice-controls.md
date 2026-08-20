# ADR 0032 — Settings 嵌套子菜单与 IM 语音控制

- 状态：Accepted
- 日期：2026-08-20

## Context

DSH 0.1.0-rc.8 的 `settings.section` contribution 只有 id、order 与 label，没有父子层级。把 Penglai 页面全部作为一级 section 会形成拥挤平铺；在内容区再做一列导航又会形成用户已明确拒绝的第三列。IM 的语音策略如果只靠 slash command，也无法让普通用户发现 ASR、MOSS-TTS、回复方式和音色之间的组合关系。

## Decision

Penglai Center 仍是 official settings shell 内唯一一级“蓬莱”入口。各可选插件继续独立注册 official `settings.section`，并使用保留的 `penglai-*` section id 命名空间。rc.8 的 SlotCore 只保留官方 section option，实测会丢弃未知 `parentId`；因此一个仅作用于 rc.8 settings renderer 的 exact-hash UI overlay 按该 id 命名空间把 active 第一方插件排成嵌套子菜单。它不修改 section 内容、Remote、loader、Agent、Session 或网络。

IM 的 binding 页面直接提供 `inputMode`、`replyMode` 与 MOSS `voiceId` 控件，并和 `/语音`、`/声音` 共用 RoutingControlPlane/SQLite 策略。ASR/TTS 未安装或模型未 ready 时显示 actual state 并安全降级。微信 native voice 用“发送 live probe → 用户确认客户端可见 → 启用”状态机；API `ret=0` 不足以启用。

微信/飞书入站语音在 official `user/message` 中保留真实转写和严格的 `source.voice` 元数据。模型侧的本地 ASR language/emotion block 仍经 official pre-step 进入请求，但 conversation overlay 只有在 `source.voice` 有效且首块精确匹配 Penglai 固定前缀时才从用户可见投影中去掉该内部块；语音波形、时长和真实转写继续显示。普通文本、非 Penglai source 与其他内容块完全不改写。

## Consequences

- 插件未安装或未启用时不注册、也不显示对应子项。
- upstream settings renderer hash 漂移即拒绝应用 overlay，升级 DSH 必须重新审计。
- ASR/TTS 下载显示真实 bytes、百分比和采样速度；暂停、继续、取消复用同一 operation id。
- 微信 native bubble 失败时继续使用可播放音频附件与 exact text fallback；飞书仍走 official native audio API。
- 本地 ASR 的模型提示不会作为用户文字显示；upstream conversation renderer hash 漂移同样 fail closed。
