# Penglai 0.5.0

Penglai 0.5.0 是一次完整重构：以 official DeepSeek Harness（DSH）作为唯一 Agent、Workspace、Session、Turn、模型、工具和基础 Web UI 核心，蓬莱负责把它变成更容易安装、配置和组合的本地桌面发行版。

## 下载

- `Penglai_0.5.0_macos_aarch64.dmg` — Apple Silicon（M 系列）Mac，macOS 13+

0.5.0 暂不提供 Intel Mac 或 Windows 安装包。DMG 内含匹配架构的 Electron、Node、DSH 与插件代码；大型语音模型由用户选择后按固定清单和 SHA-256 下载。

## 从 0.4.1 开始

0.4.1 → 0.5.0 是 fresh install，不是旧 Tauri Host 的增量升级。0.5.0 不迁移旧会话、credential 或设置，也不会删除 0.4.1 数据；新版本使用隔离的 `Penglai/0.5` 数据根。

## 第一次使用

首次引导完成隐私与语言/外观选择、BYOK provider/model、API 测试、Workspace 与真实对话。完成后进入蓬莱品牌化的 official DSH Web；Models、Workspace、Session、工具、审批、主题与中英文均由 DSH 核心提供。

fresh 默认只运行 DSH core 与 Penglai Center。IM、SenseVoice ASR、MOSS-TTS、Context、Memory、Budget、Companion 都是可选 DSH 插件，由用户在 Center 中自行安装、启用、配置、停用或卸载；缺少任一插件都不影响 DSH 基础对话。

## 蓬莱插件组合

- IM：微信/飞书授权私聊文字与语音入口，使用持久 binding、inbox/outbox 和 original reply target。
- SenseVoice ASR：在本机识别麦克风、音频附件及渠道语音，并提供语言/情绪等非用户指令元数据。
- MOSS-TTS-Nano：本机语音合成、试听和支持渠道的语音回复。
- Context：只索引用户授权目录，不修改或删除源文件。
- Memory：区分 global、Workspace 与 session candidate，长期写入需用户确认。
- Budget：复用 official TokenMeter；价格不可信时只报告 token，不伪造金额。
- Companion：默认关闭，具备安静时段、每日上限、exact binding，且禁止无人值守工具。

微信真实链路已验证：私聊文字收发，以及入站 encrypted SILK → 本地 SenseVoice → official DSH Turn → 微信文字回复。当前不承诺微信原生绿色语音气泡。飞书和其他语音组合只按应用内诊断及实际可用状态工作，不用普通文件冒充 native audio。

## 隐私、安全与信任

- `trustTier=community-verified`
- macOS app 已 ad-hoc seal，但没有 Developer ID，not notarized；首次打开可能出现系统信誉提示。
- 不要求或指导关闭 Gatekeeper。
- API key、微信 token、飞书 App Secret 通过 official credentials seam 写入本机 app-private YAML；renderer 看不到明文。同 OS 用户的高权限进程仍可能读取本地文件。
- 无 Penglai 云账户、云同步或遥测。真实 QR、聊天正文、语音、资料内容与长期记忆不进入发布 evidence。
- Release 提供 SHA-256、SBOM、third-party notices 和可审计源码。它们证明 bytes 与供应链材料，不等于 Apple 发行者认证。

## 升级与卸载

0.5.0 不启用 silent auto-update 或 updater channel。后续 assisted upgrade 只有在正式独立签名链就绪后才会发布，并始终由用户确认。

删除应用默认保留用户数据。设置中的存储与卸载向导可分别导出或删除模型、语音缓存、Context 索引、Memory、Budget 与 Companion 数据；Workspace、Context 源目录和 0.4.1 legacy 数据永不被递归删除。
