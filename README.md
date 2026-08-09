# 蓬莱 Penglai 0.4

> 一个以 TypeScript Host 为核心、以 Pi 为 agent runtime 的本地 AI 工作台。

[English](#english) · [更新日志](CHANGELOG.md) · [0.4.0 发布说明](docs/RELEASE_NOTES_0.4.0.md) · [安全边界](SECURITY.md) · [隐私与本地数据](docs/PRIVACY_AND_DATA.md)

![Version](https://img.shields.io/badge/version-0.4.0-2563eb?style=flat-square)
![TypeScript](https://img.shields.io/badge/core-TypeScript-3178c6?style=flat-square)
![Pi](https://img.shields.io/badge/Pi-0.83.0-8b5cf6?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-16a34a?style=flat-square)

蓬莱 0.4.0 不是给 Pi 再做一个外壳。它把 0.3.x 已验证的个人助理能力重构为一个本地控制平面：持续会话、可信项目、Task / Run / Evidence、审批、预算、恢复、飞书与微信入口，都连接同一个 Host、同一份事实和同一条执行路径。

## 0.4.0 的产品边界

- **只有一个助理、一个会话面。** 不再把 chat/work 当成两套产品或两种能力。会话未绑定项目时工作在助理自己的目录；Owner 明确确认后，它锚定到一个 realpath 校验过的项目目录。工具面不因标签切换。
- **只有一条 agent 执行路径。** Desktop、CLI、Goal、飞书、微信和持久化 Task 最终都进入 `EpisodeRunner → Pi AgentKernel`。TaskRunner 只保留 Run / Step / Evidence / checkpoint 的持久化生命周期，不再拥有另一套模型循环。
- **CLI 是完整核心，Desktop 是原生工作台。** Tauri 2 桌面版启动随包内置的 Node + TypeScript Host；它不是独立后端，也不要求用户安装 Node、Python 或源码树。
- **结果必须可核对。** 文件 diff、磁盘重读、命令退出态、审批决定、token 用量和 checkpoint 进入持久证据轨；模型的“我完成了”不等于完成证据。

## 能力

- 持续对话：流式输出、安全 Markdown/GFM、表格与代码复制、图片和普通文件输入、steer / follow-up / interrupt、Pi 原生 compact、thinking 档位；全部历史可搜索、重命名、归档和恢复。
- Goal：持久目标、计划模式 kick / continue、blocked / complete 状态和 Owner 解封边界。
- 项目与任务：Project、Task、Run、Step、Evidence、Approval、checkpoint、崩溃恢复和续跑。
- 权限档位：`plan`、`confirm`、`auto_edit`、`full`；L1 自主、L2 可确认并按项目记住、L3 每次强制人工、L4 直接拒绝。
- 安全围栏：项目 realpath jail、敏感凭证路径拒绝、外发/推送/删除检测、工具调用前 authority 复核；Host token 不进入 renderer 或 URL，公开模型端点强制 HTTPS，文档/网页/MCP 内容明确标记为不可信数据。
- 常用工作能力：Pi 的 `read / write / edit / bash` 原子工具直接覆盖代码、Git、压缩、日志、构建、测试与进程检查；Host 补充 PDF / DOCX / XLSX / PPTX 读取与生成、会话文件 inbox、产物打开/定位及应用内只读文本预览，以及带公网/SSRF 边界和 L3 审批的真实网页搜索与抓取。无需记工具名，也不增加任务卡片。
- 成本控制：全局日预算与项目日预算、80% 预警、100% 熔断、人工 lift 和完整用量账本。
- 记忆与技能：全局 L1、项目记忆、Owner 批准的 SOP 技能树，以及 Run 完成后的蒸馏/审计流程；桌面可从本地或 GitHub 安装声明式 Agent Skill，逐次验哈希并支持查看、启停和卸载，不运行 package installer、生命周期钩子或任意 TypeScript extension。
- MCP：桌面可配置 stdio / HTTP / SSE、手动连接、预览工具和断开；Host 启动绝不自启第三方服务，stdio 使用私有临时 HOME，远程传输逐跳防 SSRF，每次 MCP 工具调用都必须重新经过 Owner L3。
- 多入口同一事实：CLI、Tauri Desktop、飞书长连接、微信 iLink；白名单、路由、审批和 transcript 都由本地 Host 管理。
- 本地语音：SenseVoice ASR（含情绪/语言标签）+ MOSS-TTS-Nano ONNX CPU 全管线；桌面可录音转写、逐条朗读，模型按需下载且不构成启动硬依赖。
- 主动陪伴：默认关闭、Owner 明确启用；保留勿扰强度、晨间/晚间/空闲机会、SenseVoice 负面情绪承接和飞书/微信主动短消息，生成仍走同一 EpisodeRunner。
- 0.3 迁移：模型档案、飞书配置/白名单、L1 记忆和 SOP 的 dry-run、备份、迁移与 rollback。
- 模型接入：11 个内置供应商/自定义 OpenAI-compatible 端点，实时 `/models` 探测、废弃模型提示和目录刷新。
- 诊断与支持：Desktop Doctor 和 `penglai doctor --export` 可导出受限脱敏诊断包；只收集运行时元数据、Doctor 结果和有界近期文本日志，明确排除 token、模型档案、会话、数据库、记忆、Skill 与 MCP 配置。

0.4.0 不开放任意 Pi TypeScript extension/hooks、browser/CUA、scheduler 或 autonomous 工具执行。MCP 只在 Owner 手动连接后按逐工具 L3 挂载；主动陪伴不执行无人值守工具，只把可审计的内部观察事件提交给同一核心，并以 `plan` 权限生成短消息。

## 快速开始（源码）

要求：Node.js `>=22.19`。桌面本地打包还需要 Rust 与 macOS Command Line Tools。

```bash
git clone https://github.com/kevinchennewbee/PenglaiAgent.git
cd PenglaiAgent
npm ci

# 首次配置并进入终端会话
npm run cli -w @penglai/host -- setup
npm run cli -w @penglai/host -- chat

# 检查本机能力
npm run cli -w @penglai/host -- doctor
```

从源码目录运行常用命令：

```bash
npm run cli -w @penglai/host -- doctor
npm run cli -w @penglai/host -- doctor --export
npm run cli -w @penglai/host -- status
npm run cli -w @penglai/host -- project list
npm run cli -w @penglai/host -- task list
npm run cli -w @penglai/host -- approval list
npm run cli -w @penglai/host -- budget status
npm run cli -w @penglai/host -- channel list
npm run cli -w @penglai/host -- migrate --dry-run
```

如果通过 `packages/host/scripts/install.sh` 或 `install.ps1` 安装 Host，上述命令可直接简写为 `penglai ...`；安装器只接受通过生产构建的运行时，不会静默降级为源码开发模式。

## Desktop 与 DMG

开发窗口：

```bash
npm run tauri:dev -w @penglai/desktop
```

本机 adhoc-signed DMG（只用于本地验收，不等于 Developer ID / notarization 或正式 updater 签名）：

```bash
npm run tauri:build:local -w @penglai/desktop
node scripts/lifecycle-check.mjs
```

构建会先生成并验证可移植 Host runtime，再把它作为 Tauri resource 放进 `.app`。正式 Release 还必须通过 Owner 签名 tag、受保护环境、updater minisign、资产回读、SHA-256、SBOM 和 release contract 门禁；流程见 [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md)。

## 架构

```text
Desktop / CLI / Feishu / WeChat
                │
                ▼
      TypeScript Host (loopback + token)
        ├─ Conversation / Goal / Project
        ├─ Task / Run / Step / Evidence
        ├─ Approval / Budget / Memory
        └─ EpisodeRunner
                │
                ▼
       Pi AgentKernel 0.83.0
        ├─ model I/O + streaming
        ├─ read / write / edit / bash
        ├─ Office / PDF + public Web broker
        ├─ verified Agent Skills + manual MCP
        ├─ session history + compact
        └─ policy + approval hooks
```

仓库结构：

```text
packages/protocol   跨进程协议、版本与错误码
packages/host       TypeScript Host、CLI、执行/策略/存储/渠道
packages/desktop    React + Tauri 2 原生桌面工作台
scripts             契约、发布、安全、runtime 与生命周期门禁
docs                发布说明、发布流程、官网源文档
```

## 开发与发布门禁

```bash
npm test
npm run typecheck -w @penglai/protocol
npm run typecheck -w @penglai/host
npm run typecheck -w @penglai/desktop
npm run build
npm run protocol:check
npm run desktop:allowlist
npm run renderer:token-boundary
npm audit --audit-level=moderate --registry=https://registry.npmjs.org
node scripts/release-check.mjs
```

## 安全说明

Penglai 的 policy、jail、审批和路径检查是重要的进程内防线，但不是 OS sandbox。0.4.0 因此不宣称能安全执行任意不可信 MCP、插件或长期无人值守的外部代码。密钥只留在 Host 进程及权限受限的本地配置中；L3 外发/删除永远不能“同类免问”；L4 越狱/凭证访问直接拒绝。

macOS Developer ID / notarization 和 Windows Authenticode 尚未配置或验证。正式 updater 包由 minisign 保护，但 minisign 不能替代操作系统发行者信任。完整说明见 [SECURITY.md](SECURITY.md) 与 [发布说明](docs/RELEASE_NOTES_0.4.0.md)。

## 从 0.3.x 升级

0.3.x 是已经发布的 Python 产品线，最终版本保留在 [`v0.3.6`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.3.6)。0.4.0 是独立的 TypeScript 跨代升级，不覆盖 0.3 的更新通道。请先保留旧数据并执行：

```bash
penglai migrate --dry-run
penglai migrate
```

迁移写入前会备份；仍建议额外备份整个 `~/.penglai/`。

## License 与致谢

公开发布采用两分支策略：应用源码与 Release 在 `main`，双语静态官网在 `gh-pages`，两者都由 Owner 分别审核后推送。0.3.x Python 产品线已冻结并归档于 `v0.3.6`，仓库中保留的 Python 文件只用于历史、迁移与兼容性测试。

Penglai 使用 [MIT License](LICENSE)，继承并感谢 GenericAgent 的早期产品基因，也感谢 Trae Agent 相关实现为 0.4 重构提供的调研参照。当前执行内核锁定 `@earendil-works/pi-agent-core` / `@earendil-works/pi-ai` 0.83.0（MIT）；0.84.1 的持久化 AgentHarness 接口与当前发布架构不兼容，未在 0.4.0 中冒险升级。MOSS-TTS-Nano Node 适配包含 OpenMOSS Apache-2.0 归属与许可证；其余第三方归属以 Release 中的 `THIRD_PARTY_NOTICES.txt` 与 SBOM 为准。

---

## English

Penglai 0.4 is a local AI workbench built around a TypeScript Host and the Pi agent runtime. It preserves the useful product ideas proven by 0.3.x—persistent assistance, IM access, memory and workflows—while adding durable projects, tasks, runs, evidence, approvals, budgets and recovery.

There is one assistant and one conversation surface. A conversation either works on the assistant's own ground or is explicitly anchored by the owner to a realpath-checked project directory; this is a boundary change, not a second capability mode. Desktop, CLI, Goal, Feishu, WeChat and durable Tasks all execute through `EpisodeRunner → Pi AgentKernel`.

The Tauri 2 desktop app bundles its target Node runtime and the TypeScript Host. End users do not need a system Node, Python installation or source checkout. The desktop provides conversations, project/task supervision, approval cards, usage and budget views, evidence, channels, settings, runtime diagnostics and update controls over the same Host facts as the CLI.

Key guarantees:

- durable Conversation / Goal / Project / Task / Run / Step / Evidence records;
- one Pi execution path with streaming, tools, steering, interruption and compaction;
- `plan`, `confirm`, `auto_edit` and `full` permission dials;
- L1 autonomous, L2 owner-confirmable/grantable, L3 always human, L4 denied;
- realpath project jail, credential-path denial and authority revalidation;
- Pi atomic tools for files, code, Git, archives, logs, builds and tests, plus bounded PDF/DOCX/XLSX/PPTX create/read and public Web search/fetch brokers;
- safe Markdown/GFM, ordinary file import, jailed in-app text preview plus artifact open/reveal, searchable/archivable history and background completion notifications;
- a redacted diagnostic export containing bounded recent text logs and runtime health only, never conversations, credentials, profiles, databases, memories, skills or MCP configuration;
- local/GitHub declarative Agent Skill installation with integrity receipts, plus manually connected stdio/HTTP/SSE MCP tools that require L3 approval on every call;
- global/project daily budgets, warnings, breakers and auditable lifts;
- Feishu and WeChat routes into the same local transcript and approval truth;
- local SenseVoice ASR, the complete MOSS-TTS-Nano ONNX CPU pipeline, and opt-in active companionship;
- 0.3 migration with dry-run, backup and rollback.

Build and test commands are identical to the Chinese sections above. For a local ad-hoc-signed macOS bundle, run `npm run tauri:build:local -w @penglai/desktop`, then `node scripts/lifecycle-check.mjs`. Local acceptance bundles do not prove Developer ID signing, notarization, or formal updater signing.
