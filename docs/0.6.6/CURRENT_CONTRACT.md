# Penglai 0.6.6 current product, architecture, and privacy contract

This document is the 0.6.6 overlay for the historical 0.6.5 snapshots retained in [`docs/PRODUCT.md`](../PRODUCT.md), [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md), and [`docs/SECURITY.md`](../SECURITY.md). The source, [`ACCEPTANCE_DELTA.md`](ACCEPTANCE_DELTA.md), [`REVIEW_AND_ADAPTATION.md`](REVIEW_AND_ADAPTATION.md), and [public release evidence](../PUBLICATION_MANIFEST_0.6.6.md) set the exact boundary. General safeguards in the older documents continue to apply where they do not conflict with this version.

## Product and distribution

- Official DeepSeek Harness `0.1.7-alpha.2` is the sole agent, model, tool, approval, Workspace, Session, Turn, Web UI, and plugin-management core. Its source tag is `dsh-v0.1.7-alpha.2` at `00102833dfaee1da9f48a3a8eae9d34005a75218`. The audited official registry cohort has 323 packages (309 DSH, nine vendor, five native); the installed product closure is measured separately.
- The published v0.6.6 Release has exactly ten immutable assets from source `519a24be3702257bc7b0e0230d19fe3affd0a31b`: Apple Silicon macOS 13+, Windows 10+ x64, and UOS 20 LoongArch installers plus seven integrity/supply-chain files. Intel Mac, Linux amd64, and Windows ARM are outside the target set.
- A fresh profile enables Memory and IM; IM accounts and channels remain unconfigured until connected. ASR, MOSS-TTS, Budget, and Companion are bundled but disabled by default. Context, Plugin Reference, and Plugin Pilot remain bounded first-party components. Office, LibreOffice, Office/PDF processing, and a separate Penglai agent runtime are excluded.
- The exact official 0.1.7 plugin manager is the mutable profile package engine. Penglai supplies application-owned Node and pnpm. Third-party package installation and build-script approval are distinct trust actions; bundled Penglai code remains app-owned.

## Runtime and user data

- Electron owns bootstrap, local paths, process supervision, authenticated loopback, narrow OS permissions, assisted update, and uninstall. Official DSH owns the long-lived conversation and plugin loader. No system Node, Git dependency, locally repacked DSH, or mixed DSH generation substitutes for the pinned runtime.
- The app-private `Penglai/0.5` data generation remains. Upgrading to the DSH 0.1.7 Home and Session V4 copies prior data first, preserves the original V3 bytes, checks the successor, and activates only after a healthy transaction. Mac and Windows installed upgrades from immutable 0.6.3 and 0.6.5 passed user-data preservation.
- Memory stays scoped to the selected Workspace. An IM binding is checked against official Workspace/Session membership before rebind, pairing, menu action, and inbound use. Channel text and imported source guidance are untrusted data; an IM route never grants wider agent/tool/approval authority. Durable inbox/outbox state and uncertain-send handling prevent blind duplicate delivery.
- Optional plugins remain inert when disabled or unconfigured. Budget and Companion actions require explicit enabling and remain bounded by Workspace, Session, and Owner authorization. Neither introduces a second agent core.

## Privacy and trust

- App data is local by default; model calls send required task context to the selected provider, and connected messaging channels send/receive through their platforms. The product does not promise a fresh confirmation for every message after a connection is configured.
- Credentials use the official DSH app-private YAML seam. File permissions/current-user ACLs reduce accidental access; another process running as the same OS user may still read them. They are not Keychain or hardware-backed isolation. The owned DSH child receives `DSH_TELEMETRY_DISABLED=1`; Penglai operates no telemetry or cloud-memory backend.
- Private keys, account credentials, QR payloads, chat bodies, media, personal paths, and raw profiles must not enter Git, diagnostics, screenshots, evidence, or release assets. The current 0.6.6 public source export passed clean-room install/typecheck and secret scanning. Historical public Git history requires separate review and is not described as completely clean by that current-export result.
- macOS is ad-hoc signed without notarization; Windows lacks Authenticode. UOS uses an older Electron/Chromium train and does not have Mac/Windows security parity. The signed updater covers Apple Silicon and Windows x64 and never runs silently.

## Evidence limits

Source CI, the three-target native aggregate, Mac/Windows installed onboarding and upgrades, exact draft readback, and ten-asset immutable public readback passed. UOS package/ABI/runtime closure passed; native UOS machine acceptance remains `OWNER_POST_RELEASE`. Private-account IM/iMessage live delivery was outside publication acceptance. The two-hour installed soak remains `OWNER_EXCLUDED`. See the [publication manifest](../PUBLICATION_MANIFEST_0.6.6.md) for exact runs, hashes, and the public release.

## 中文

0.6.6 以官方 DSH `0.1.7-alpha.2` 为唯一 Agent、Workspace、Session、工具、审批、Web 界面和插件管理核心。完整上游 npm 审计包组为 323 包，安装版运行闭包另行实测。三个原生安装包来自同一源码提交；办公、LibreOffice 和 Office/PDF 处理不在本版内。记忆与消息默认启用但消息账号未配置；语音、预算与主动陪伴随包提供、默认关闭。

升级到新的 DSH Home 与 Session V4 时先复制旧数据，验证后才切换，原始 V3 字节保留。Mac 与 Windows 从 0.6.3、0.6.5 安装版升级并保留用户数据通过。消息绑定每次涉及 Workspace/Session 操作都要重新核对官方成员关系；外来文本不获得工具或审批权。模型调用会把任务上下文发给选定供应商，连接的消息通道也会经过对应平台；本地 YAML 凭据并非硬件隔离。

十项不可变公开附件和签名已完成公网字节回读。UOS 真机功能仍为 `OWNER_POST_RELEASE`，私人 IM 账号在线收发不属于发布验收，Mac 未公证、Windows 无 Authenticode。当前源码导出和密钥扫描通过，不等于整个历史 Git 仓库从未出现隐私例外。
