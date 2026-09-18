# Penglai 0.6.3 acceptance delta

Status: development acceptance delta. There are no 0.6.3 native or immutable
public-byte results yet.

## English

Penglai 0.6.3 moves the complete pinned DeepSeek Harness npm cohort from
`0.1.5-rc.2` to official `0.1.6-alpha.2`. The DSH tag is
`dsh-v0.1.6-alpha.2` at commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`. The dependency graph contains
293 DSH packages, nine vendor packages, and five native packages: 307 in all.
The exact registry identities are recorded in `docs/0.6.3/DSH_NPM_COHORT.json`.

The release must satisfy the existing acceptance contract plus these deltas:

- Preserve official DSH as the only agent, Workspace, Session, Turn, tool, and
  Web UI core. No second host, model gateway, or conversation engine is added.
- Disable upstream session log/upload behavior. Use the exact official DSH
  alpha.2 plugin manager as the sole package-management engine, backed by the
  application-owned Node and pnpm `11.11.0`; expose its UI/tool and require
  explicit approval for package build scripts. The historical signed Penglai
  catalog is not an ecosystem allowlist.
- Migrate the active DSH home from rc.2 to an isolated alpha.2 generation only
  after health validation. Original settings and sessions remain byte-for-byte
  unchanged until an explicit owner data action.
- Prove fresh install, restart, the exact 0.6.2 to 0.6.3 installed upgrade, and
  default uninstall on Apple Silicon and Windows x64. The upgrade proof must
  preserve DSH settings, sessions, plugin desired state, and Memory data.
- Package exactly three targets from one clean `main` SHA:
  `darwin-aarch64`, `win32-x86_64`, and `linux-loong64`. Intel Mac is not a
  0.6.3 target.
- Keep LibreOffice, Office/PDF, Budget, and Companion absent from the workspace,
  profile, runtime closure, installer, and product SBOM. Memory stays bundled
  and enabled by default but may be disabled by the Owner without removing its
  package or data. Management infrastructure and credentials remain required.
  The complete upstream cohort ledger is audit evidence, not a requirement to
  ship excluded packages.
- Ship the UOS `.deb` as one complete installer containing Electron, Node,
  official DSH, the in-scope first-party plugins, Memory, Mnemon, native
  add-ons, licenses, and integrity manifests. Package, ABI, architecture, and
  closure checks are required before publication.
- UOS 20 LoongArch native install, startup, file-picker, sleep/resume, and
  functional acceptance remain `OWNER_POST_RELEASE`; static or cross-built
  checks must never be called a native PASS.
- Keep secrets, credentials, owner paths, personal email addresses, local
  profiles, logs, screenshots, and chat media out of committed and published
  material. Evidence output is bounded and redacted before it is written.
- Pin the indirect ONNX packaging dependency `adm-zip` to `0.6.2` and prove
  that overwrite extraction refuses an existing destination symlink. Install
  scripts remain disabled and the installed runtime has no `adm-zip` call path.

Known limitations are part of the release contract: UOS requires `libatomic1`
and recommends `bubblewrap`; MOSS TTS is unavailable on LoongArch; iMessage is
Mac-only and optional; Electron 31 is no longer maintained; UOS native UI,
file-picker, and sleep parity await the Owner's post-release machine test.

The Owner excludes the two-hour installed soak. No timed substitute is added.
The Owner authorizes the complete 0.6.3 workflow through three-target native
validation, immutable publication, public readback, and only then README/site
publication updates. A result remains `NOT_RUN` until that exact step executes.

## 中文

蓬莱 0.6.3 将完整固定的 DeepSeek Harness npm 依赖组从 `0.1.5-rc.2`
迁移到官方 `0.1.6-alpha.2`。本版继续只使用官方 DSH 作为 Agent、工作区、会话、
消息轮次、工具和 Web UI 核心，不增加第二套 Host、模型网关或对话引擎。

本版必须在 Apple 芯片 Mac 和 Windows x64 上完成全新安装、重启、
0.6.2 到 0.6.3 的真实安装版升级，以及默认保留数据的卸载。升级验收单独核对
DSH 设置、会话、插件启用状态和记忆数据。UOS 安装包必须是一个自带 Electron、
Node、完整 DSH、范围内第一方插件、记忆、Mnemon、本地依赖、许可证与完整性
清单的完整 `.deb`，不能要求用户另装开发环境。

LibreOffice、Office/PDF、预算和主动陪伴不属于 0.6.3 产品范围，不得进入 workspace、
profile、运行闭包、安装包或产品 SBOM。记忆随包并默认启用，但 Owner 可以停用而不
删除插件包或记忆数据；管理基础设施与 credentials 必须保持可用。完整上游 cohort
清单只用于审计上游输入，不等于全部随包。官方 DSH alpha.2 插件管理器是唯一包
管理后端，使用应用内固定 Node 与 pnpm `11.11.0`，并区分安装插件与批准 build script。

三个精确目标为 `darwin-aarch64`、`win32-x86_64` 和 `linux-loong64`；
本版不含 Intel Mac。UOS 20 龙芯真机安装、启动、文件选择器、休眠恢复与功能体验
由 Owner 在发布后手动验收，状态保持 `OWNER_POST_RELEASE`，不能用静态检查冒充
真机 PASS。

ONNX 打包工具链间接带入的 `adm-zip` 固定为 `0.6.2`，并以恶意目标符号链接
回归验证解压会拒绝向目录外写入；依赖安装脚本继续禁用，安装版运行时不存在
`adm-zip` 调用路径。

已知限制会如实公开：UOS 依赖 `libatomic1`，建议安装 `bubblewrap`；龙芯版不提供
MOSS 语音生成；iMessage 只支持 Mac 且默认关闭；Electron 31 已不再维护；UOS
原生界面、文件选择器和休眠一致性仍待发布后真机确认。Owner 明确排除两小时测试。
本轮授权在合并 `main` 后停止，三端、安装升级、发布与公网回读均为 `NOT_RUN`。
