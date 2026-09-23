# Penglai 0.6.6 release notes

Status: published as the immutable [v0.6.6 GitHub Release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.6). All ten public assets passed byte readback.

## English

Penglai 0.6.6 uses the exact official DeepSeek Harness `0.1.7-alpha.2` npm cohort (tag `dsh-v0.1.7-alpha.2`, commit `00102833dfaee1da9f48a3a8eae9d34005a75218`). The official Harness remains the only agent, Session, Workspace, Web UI and plugin-management core.

The first-party IM, Memory, Context, ASR, MOSS-TTS, Plugin Center, Plugin Reference, Plugin Pilot, Budget and Companion packages were adapted to this cohort. IM and Memory are enabled on a fresh profile; channels stay unconfigured until connected. ASR, TTS, Budget and Companion ship disabled by default. Office, LibreOffice and Office/PDF processing are excluded. The community `@xmanrui/dsh-im` v4.25.0 changes were reviewed; its package was not installed because its declared Harness range does not cover 0.1.7.

Session V3-to-V4 migration preserves the original user data. Mac and Windows installed tests covered onboarding, first official message, first-party plugin profiles, fresh install/restart/default uninstall, and upgrades from immutable 0.6.3 and 0.6.5. The three native packages and complete release evidence set passed at source `519a24be3702257bc7b0e0230d19fe3affd0a31b`. The exact ten-asset public Release, update signature, installer signatures and public bytes passed readback. [Publication evidence](PUBLICATION_MANIFEST_0.6.6.md) records the boundaries and digests.

Limitations: UOS 20 LoongArch package, ABI and runtime closure passed, while native UOS machine acceptance remains `OWNER_POST_RELEASE`. Intel Mac, Linux amd64 and Windows ARM are outside the exact target set. macOS is ad-hoc signed without notarization; Windows has no Authenticode. Optional live delivery on private IM accounts, including iMessage, was not part of publication acceptance. The two-hour installed soak remains `OWNER_EXCLUDED`.

## 中文

蓬莱 0.6.6 使用精确固定的官方 DeepSeek Harness `0.1.7-alpha.2` npm 包组（tag `dsh-v0.1.7-alpha.2`，commit `00102833dfaee1da9f48a3a8eae9d34005a75218`）。官方 Harness 仍是唯一的 Agent、Session、Workspace、Web 界面和插件管理核心。

消息、记忆、上下文、语音识别、MOSS 语音生成、插件中心、插件参考、插件试验、预算和主动陪伴已适配该包组。新 profile 默认启用消息和记忆；消息通道在连接前保持未配置。语音、预算和主动陪伴随包提供但默认关闭。办公、LibreOffice 和 Office/PDF 处理被排除。已审查社区 `@xmanrui/dsh-im` v4.25.0 的变化；其声明的 Harness 兼容范围尚未覆盖 0.1.7，因此未直接安装该包。

Session V3→V4 迁移保留用户原始数据。Mac 与 Windows 安装态测试覆盖引导、首条官方消息、第一方插件组合、全新安装/重启/默认卸载，以及从不可变 0.6.3、0.6.5 的安装升级。三个原生安装包和完整发布证据集均在源码 `519a24be3702257bc7b0e0230d19fe3affd0a31b` 通过。精确十项公开附件、更新签名、安装器签名和公网字节回读均通过。[发布证据](PUBLICATION_MANIFEST_0.6.6.md)记录了边界和摘要。

限制：统信 UOS 20 龙芯包、ABI 与运行闭包已通过，UOS 真机验收仍为 `OWNER_POST_RELEASE`。Intel Mac、Linux amd64、Windows ARM 不在精确目标集合。macOS 使用临时签名且未公证；Windows 没有 Authenticode。私人 IM 账号（包括 iMessage）的可选在线收发不属于发布验收。两小时安装态等待仍为 `OWNER_EXCLUDED`。
