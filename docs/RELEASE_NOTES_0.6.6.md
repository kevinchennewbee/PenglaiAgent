# Penglai 0.6.6 release notes — draft

Status: development candidate. The 0.6.6 installers and public readback have not been produced. The current public download remains v0.6.5.

## English

Penglai 0.6.6 is being built against the exact official DeepSeek Harness `0.1.7-alpha.2` npm cohort. The official Harness remains the only agent, session, Workspace, Web UI and plugin-management core. The first-party IM, Memory, Context, ASR, MOSS-TTS, Plugin Center, Plugin Reference, Plugin Pilot, Budget and Companion packages are included in the development scope. IM and Memory are enabled on a fresh profile; ASR, TTS, Budget and Companion are bundled but disabled until the user enables them. Office, LibreOffice and Office/PDF processing are excluded.

The current candidate has passed source build, contract tests and a real embedded startup matrix for the bundled plugins. Session V3-to-V4 preservation, installed upgrade, native target tests and immutable public-byte readback still require evidence. Channel-specific IM fixes from `@xmanrui/dsh-im` v4.25.0 are under review; the community package itself is not installed because its declared Harness range does not cover 0.1.7.

The planned distribution targets remain Apple Silicon macOS 13+, Windows 10+ x64 and UOS 20 loong64. Intel Mac is outside this exact set. macOS notarization and Windows Authenticode are not claimed. Native UOS installation remains a separate observation from package verification.

## 中文

蓬莱 0.6.6 候选版使用精确固定的官方 DeepSeek Harness `0.1.7-alpha.2` npm 包组。官方 Harness 仍是唯一的 Agent、会话、Workspace、Web 界面和插件管理核心。开发范围包括消息、记忆、上下文、语音识别、MOSS 语音生成、插件中心、插件参考、插件试验、预算与主动陪伴。新用户默认启用消息与记忆；语音、预算和主动陪伴随包提供但默认关闭。办公、LibreOffice 和 Office/PDF 处理不在本版范围内。

当前候选版已通过源码构建、契约测试和真实嵌入式插件组合启动。用户会话 V3→V4 保原文件迁移、安装版升级、原生目标测试和公开附件逐字节回读仍须取证。正在审查社区 `@xmanrui/dsh-im` v4.25.0 中适用的渠道修复；其声明的 Harness 兼容范围尚未覆盖 0.1.7，因此不直接安装社区包。

计划发布目标仍为 Apple Silicon macOS 13+、Windows 10+ x64 与统信 UOS 20 loong64；Intel Mac 不在精确目标集合。当前不声称 Apple 公证或 Windows Authenticode 签名通过。UOS 包验证不能代替 UOS 真机安装验证。
