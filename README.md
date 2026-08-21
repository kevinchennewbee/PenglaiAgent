<p align="center">
  <img src="overlays/dsh-0.1.1-rc.1/brand/logo-256.png" width="112" alt="Penglai logo">
</p>

<h1 align="center">Penglai · 蓬莱</h1>

<p align="center">DSH-powered local personal AI distribution</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#中文">中文</a> ·
  <a href="https://penglai.pages.dev">Website</a> ·
  <a href="https://github.com/kevinchennewbee/PenglaiAgent/releases">Download</a> ·
  <a href="SECURITY.md">Security</a>
</p>

<a id="english"></a>

# English

**Penglai is not another chatbot shell.** It is a local, owner-controlled distribution of DeepSeek Harness that turns models, workspaces, channels, and reviewed plugins into one coherent personal AI experience. DSH remains the only core; Penglai adds the desktop journey, trust boundaries, packaging, evidence, and a signed plugin center for people who should not need to live in a terminal.

## Origin

Penglai started as a non-coder and his AI steward. The product exists so an Owner can install, configure, and govern a local agent without becoming a Node/DSH operator. Multiple AI tools helped implement and review; Owner remains responsible for direction, risk, and release.

## Why “Penglai”

The name is the island where the Eight Immortals each show their own skill. That is a metaphor for many models, channels, and plugins sharing one DSH core — not a second runtime.

## What changed in 0.5.1

0.5.0 rebuilt Penglai around official DSH. Local 0.5.1 work adds (source-tested; exact DMG and live Releases **NOT_RUN**):

- **PPDP/1** — signed, immutable plugin catalogs and packages
- **PUDP/1** — versioned immutable app update manifests (`update-manifest-v1.json`), not a mutable `latest.json`
- Fail-closed fixes for optional-plugin install, Context workspace binding, wizard COMPLETE, outbox CAS, Companion triggers, budget release audit, packaged env/debug, and native Owner confirmation

0.5.0 → 0.5.1 is a **manual DMG overlay**. It keeps the `Penglai/0.5` data root. It is not a one-click update from 0.5.0.

## One DSH core, many reviewed plugins

Fresh install runs official DSH + Penglai Center. IM, ASR, MOSS-TTS, Context, Memory, Budget, Companion, and future reviewed plugins are optional. Missing plugins must not break DSH chat.

## Plugin Center and trust model

Penglai 0.5.1 may distribute first-party or Penglai-reviewed DSH plugins through a signed catalog. It does **not** offer arbitrary URL, npm, or Git install.

DSH plugins share the local DSH process. Permission fields are review/confirm metadata, not an OS sandbox.

## Product boundaries

- Declared 0.5.1 targets: `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64` from the same source SHA
- Native PASS is reserved for a matching runner. Missing Intel/Windows builders stay **BLOCKED** / **NOT_RUN**, not Apple Silicon-only support
- community-verified: ad-hoc seal, not notarized, no Developer ID
- BYOK via official DSH credentials YAML
- Weixin/Feishu private text+voice only
- Companion off by default; no unattended tools

## Architecture

```text
Penglai Desktop (Electron)
  → embedded Node + official DSH 0.1.1-rc.1
  → authenticated loopback proxy
  → pre-DSH /wizard then official DSH Web
  → Plugin Center + optional signed plugins
```

## Install / first run / BYOK

1. Install the matching target installer (`Penglai_0.5.1_macos_aarch64.dmg`, Intel DMG, or Windows Setup) once a native candidate exists.
2. Complete privacy, locale, provider, API test, Workspace, and the first official Turn.
3. Use official DSH Web. Install plugins from Center only after the main-process permission dialog.

## Build, test, contribute

Node `22.22.2`, pnpm `10.14.0`. See `CONTRIBUTING.md`. Do not push until Owner review for this 0.5.1 pass.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:security
```

## Project timeline

```text
0.3  Python / GenericAgent genes — product exploration
0.4  Pi + TypeScript Host + Tauri — durable workbench generation
0.5  clean reset around DeepSeek Harness + Electron — DSH becomes the only core
0.5.1 signed plugin distribution — capabilities evolve without repackaging the app
```

Each generation is historical. Old capabilities do not automatically inherit.

## Privacy, security, license

MIT for Penglai source. DSH and third-party components keep their licenses. No Penglai cloud account, sync, or telemetry. See `SECURITY.md`.

---

<a id="中文"></a>

# 中文

**蓬莱不是又一个聊天机器人外壳。** 它是一个由 Owner 控制、运行在本机的 DeepSeek Harness 发行版：模型、Workspace、渠道和经过审核的插件共用同一个 DSH 核心；蓬莱负责把桌面体验、信任边界、打包、证据和签名插件中心带给不应该被终端挡在门外的人。

## 起源

蓬莱始于一个不会写代码的人和他的 AI 管家。产品目标是让 Owner 能安装、配置和治理本机 Agent，而不必成为 Node/DSH 运维。多个 AI 工具参与实现与审查；方向、风险和发布责任仍在 Owner。

## 为什么叫蓬莱

八仙过海，各显神通。这用来表达多模型、多渠道、多插件共用同一个 DSH 核心，而不是再造一套 runtime。

## 0.5.1 变了什么

0.5.0 把蓬莱重建到官方 DSH 上。本地 0.5.1 增加（源码测试；exact DMG 与 live Release **NOT_RUN**）：

- **PPDP/1**：签名且不可变的插件目录与插件包
- **PUDP/1**：按版本不可变的应用更新清单，不再使用可变 `latest.json`
- 可选插件安装、Context 工作区绑定、向导 COMPLETE、Outbox CAS、陪伴触发器、预算释放审计、打包环境/调试开关、以及主进程原生确认的 fail-closed 修复

0.5.0 → 0.5.1 是 **手动覆盖安装 DMG**，保留 `Penglai/0.5` 数据根。0.5.0 不能一键升级。

## 一个 DSH 核心，许多经过审核的插件

全新安装只运行官方 DSH 与蓬莱插件中心。IM、ASR、MOSS-TTS、Context、Memory、Budget、Companion 以及未来经审核插件都是可选的。缺少任一插件不得阻断 DSH 基础对话。

## 插件中心与信任模型

0.5.1 可以通过签名目录分发第一方或经蓬莱逐版本审核的 DSH 插件。不提供任意 URL、npm 或 Git 安装。

DSH 插件与本地 DSH 进程共享权限。权限字段用于审核和确认，不是操作系统沙箱。

## 产品边界

- 0.5.1 声明三个 target：`darwin-aarch64`、`darwin-x86_64`、`win32-x86_64`，必须来自同一 source SHA
- Native PASS 只来自对应原生 runner。缺 Intel/Windows 构建器只能写 **BLOCKED** / **NOT_RUN**，不得写成单端已发布
- community-verified：ad-hoc seal，未公证，无 Developer ID
- BYOK 走官方 DSH credentials YAML
- 微信/飞书仅授权私聊文字与语音
- Companion 默认关闭，禁止无人值守工具

## 架构

```text
蓬莱桌面（Electron）
  → 嵌入 Node + 官方 DSH 0.1.1-rc.1
  → 经认证的 loopback 代理
  → 引导完成前 /wizard，之后官方 DSH Web
  → 插件中心 + 可选签名插件
```

## 安装 / 首次使用 / BYOK

1. 安装对应 target 的安装包（Apple Silicon DMG、Intel DMG 或 Windows Setup），以原生候选存在为前提。
2. 完成隐私、语言、供应商、API 测试、Workspace 和第一条官方 Turn。
3. 使用官方 DSH Web。仅在主进程权限对话框确认后从插件中心安装插件。

## 从源码开发

需要 Node `22.22.2` 与 pnpm `10.14.0`。贡献前请读 `CONTRIBUTING.md`。本轮 0.5.1 在 Owner 检查前不推送。

## 时间线

```text
0.3  Python / GenericAgent 基因 — 产品探索
0.4  Pi + TypeScript Host + Tauri — 工作台世代
0.5  以 DeepSeek Harness + Electron 干净重置 — DSH 成为唯一核心
0.5.1 签名插件发行 — 能力可以在不重打包应用的情况下生长
```

每一代都是历史，旧能力不会自动继承到当前版本。

## 隐私、安全与许可

蓬莱源码 MIT。DSH 与第三方组件保留各自许可证。无蓬莱云账户、同步或遥测。详见 `SECURITY.md`。
