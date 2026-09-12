# Penglai 0.6.2 acceptance delta

Status: development candidate. This file is not public-release evidence.

## English

Penglai 0.6.2 moves the complete pinned DeepSeek Harness npm cohort from
`0.1.5-rc.1` to official `0.1.5-rc.2`. The DSH tag is
`dsh-v0.1.5-rc.2` at commit
`fb2c4b9e698e30edb738bca4cf0618587db7d203`. The dependency graph contains
265 DSH packages, nine vendor packages, and five native packages: 279 in all.
The exact registry identities are recorded in `docs/0.6.2/DSH_NPM_COHORT.json`.

The release must satisfy the existing acceptance contract plus these deltas:

- Preserve official DSH as the only agent, Workspace, Session, Turn, tool, and
  Web UI core. No second host, model gateway, or conversation engine is added.
- Keep the upstream feedback behavior but make its local-only behavior explicit:
  feedback remains on the device and conversation content is not uploaded.
- Migrate the active DSH home from rc.1 to an isolated rc.2 generation only
  after health validation. Original settings and sessions remain byte-for-byte
  unchanged until an explicit owner data action.
- Prove fresh install, restart, the exact 0.6.1 to 0.6.2 installed upgrade, and
  default uninstall on Apple Silicon and Windows x64. The upgrade proof must
  preserve DSH settings, sessions, plugin desired state, and Memory data.
- Package exactly three targets from one clean `main` SHA:
  `darwin-aarch64`, `win32-x86_64`, and `linux-loong64`. Intel Mac is not a
  0.6.2 target.
- Ship the UOS `.deb` as one complete installer containing Electron, Node,
  official DSH, every first-party plugin, Office, Memory, Mnemon, native
  add-ons, licenses, and integrity manifests. Package, ABI, architecture, and
  closure checks are required before publication.
- UOS 20 LoongArch native install, startup, file-picker, sleep/resume, and
  functional acceptance remain `OWNER_POST_RELEASE`; static or cross-built
  checks must never be called a native PASS.
- Keep secrets, credentials, owner paths, personal email addresses, local
  profiles, logs, screenshots, and chat media out of committed and published
  material. Evidence output is bounded and redacted before it is written.

Known limitations are part of the release contract: UOS requires `libatomic1`
and recommends `bubblewrap`; MOSS TTS is unavailable on LoongArch; iMessage is
Mac-only and optional; Electron 31 is in maintenance status; UOS native UI,
file-picker, and sleep parity await the Owner's post-release machine test.

The Owner excludes the two-hour installed soak. No timed substitute is added.

## 中文

蓬莱 0.6.2 将完整固定的 DeepSeek Harness npm 依赖组从 `0.1.5-rc.1`
迁移到官方 `0.1.5-rc.2`。本版继续只使用官方 DSH 作为 Agent、工作区、会话、
消息轮次、工具和 Web UI 核心，不增加第二套 Host、模型网关或对话引擎。

本版必须在 Apple 芯片 Mac 和 Windows x64 上完成全新安装、重启、
0.6.1 到 0.6.2 的真实安装版升级，以及默认保留数据的卸载。升级验收单独核对
DSH 设置、会话、插件启用状态和记忆数据。UOS 安装包必须是一个自带 Electron、
Node、完整 DSH、全部第一方插件、办公、记忆、Mnemon、本地依赖、许可证与完整性
清单的完整 `.deb`，不能要求用户另装开发环境。

三个精确目标为 `darwin-aarch64`、`win32-x86_64` 和 `linux-loong64`；
本版不含 Intel Mac。UOS 20 龙芯真机安装、启动、文件选择器、休眠恢复与功能体验
由 Owner 在发布后手动验收，状态保持 `OWNER_POST_RELEASE`，不能用静态检查冒充
真机 PASS。

已知限制会如实公开：UOS 依赖 `libatomic1`，建议安装 `bubblewrap`；龙芯版不提供
MOSS 语音生成；iMessage 只支持 Mac 且默认关闭；Electron 31 处于维护阶段；UOS
原生界面、文件选择器和休眠一致性仍待发布后真机确认。Owner 明确排除两小时测试。
