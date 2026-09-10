<p align="center">
  <img src="website/art/readme-hero-060.png" width="100%" alt="Penglai 蓬莱: DeepSeek Harness, on your computer">
</p>

# Penglai · 蓬莱

Official DeepSeek Harness, installed on a personal computer.

[English](#english) · [中文](#中文) · [Website](https://penglai.pages.dev) · [中文网站](https://penglai.pages.dev/zh/) · [Security](SECURITY.md)

**Penglai 0.6.0** installs official DeepSeek Harness `0.1.5-alpha.1` (tag `dsh-v0.1.5-alpha.1`, commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`, 272 npm packages) on Apple Silicon, Intel Mac, Windows x64, and UnionTech UOS 20 LoongArch. DSH remains the only agent core. Office and Memory are enabled by default.

Download the immutable release: [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0), built from source `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`. Published v0.5.10, v0.5.11, and v0.5.12 tags stay immutable.
[Release notes](docs/RELEASE_NOTES_0.6.0.md) · [Publication manifest](docs/PUBLICATION_MANIFEST_0.6.0.md)

<p align="center">
  <img src="website/shots/0.5.5/welcome.png" width="78%" alt="Penglai first-run welcome: language, appearance, and a seven-step guide">
</p>
<p align="center"><sub>Installed 0.5.5 first-run welcome, kept as a UI reference. Not a 0.6.0 screenshot.</sub></p>

<a id="english"></a>

# English

## What it is

Penglai is a desktop distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It packages a fixed DSH build, Node, Electron, the official conversation interface, a first-run guide, updates, local data controls, and a reviewed set of DSH plugins into one installable application.

DSH owns the agent loop, models, tools, approvals, Workspace, Session, Turn, and the conversation. Penglai owns packaging, process supervision, onboarding, local paths, upgrades, uninstall, product identity, and plugin distribution. Penglai does not ship a second agent or a replacement chat page.

```
You
  → Penglai (installers, wizard, plugins, updates, uninstall)
       → DeepSeek Harness (models, tools, Workspace, Session, conversation)
```

## A day with Penglai

1. Install the matching Apple Silicon, Intel Mac, Windows x64, or UnionTech UOS 20 LoongArch package.
2. Finish seven first-run steps until a real model reply arrives. Back, retry, and restart-resume are supported. A failed API key is never recorded as success.
3. Work in the DSH Workspace you selected. Office can inspect and edit documents after a confirmation bound to that action. Memory may keep safe facts for *this* Workspace only.
4. Optionally bind Weixin, Feishu, or another supported channel; optionally install local speech models. Ordinary conversation must still work if those plugins are off, offline, or missing weights.
5. When a signed desktop update appears, you choose to install it. Updates are never silent.

## What starts enabled

| Product surface | Fresh install | What it does |
| --- | --- | --- |
| Penglai Office | On | Inspect, create, edit, preview, and save DOCX, XLSX, PPTX, and PDF |
| Penglai Memory | On | Automatic current-Workspace memory, explicit personal memory, authorised sources, provenance, and a knowledge graph |
| Mobile Messaging | Off | Eight platform connectors under one IM control plane; WhatsApp is not a product surface |
| Speech Recognition | Off | Local SenseVoice transcription; enabling it adds the conversation microphone entry |
| Voice Generation | Off | Local MOSS-TTS-Nano preview, desktop playback, and supported channel audio |
| Companion | Off | Opt-in scheduled contact with quiet hours, daily limits, and a bound IM route |

In Plugin Center the usual action is install and enable, or disable. Hashes, loader phases, permissions, rollback, and diagnostics stay available if you need them.

<p align="center">
  <img src="website/shots/0.5.5/plugin-center.png" width="48%" alt="Penglai Plugin Center in official DSH settings">
  <img src="website/shots/0.5.5/office.png" width="48%" alt="Penglai Office create, inspect, and planned-edit controls">
</p>
<p align="center"><sub>Installed 0.5.5 Plugin Center and Office, kept as UI references. UI state is never proof of installation or health.</sub></p>

Office writes use host-issued `artifact:<uuid>` handles and wait for a confirmation bound to that action. Memory recall never searches another Workspace. Memory uses your selected model provider to decide which candidate facts to keep. Storage and recall stay local. Memory is required and default-on, including on UOS, with the Mnemon `0.2.8` engine packed. Large SenseVoice weights download only after an explicit action. MOSS-TTS is not available and cannot be enabled on LoongArch.

## Download

Use the matching file. Do not mix platforms. Check the downloaded installer against `SHA256SUMS` on [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0). GitHub Releases is the authoritative source. Linux amd64 and Windows ARM are not targets. All four installers were built from source `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`.

### Apple Silicon, macOS 13+

[`Penglai_0.6.0_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_aarch64.dmg)

284,362,933 bytes · SHA-256 `98d1c0a133d50200c03626d39e225a52ff08d1f1a09fdb1595ab706b70f183cb`

### Intel Mac, macOS 13+

[`Penglai_0.6.0_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_x64.dmg)

293,996,120 bytes · SHA-256 `4c74a4ce9353ccf23aa74471d279237c4b5b9822d118aa2a90e44e16caf16498`

### Windows 10+ x64

[`Penglai_0.6.0_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_windows_x64_setup.exe)

369,849,038 bytes · SHA-256 `6316f623fe877686662b7b3a5641945bc946e2b1dd31bf3d9527c6a17f7c35e9`

### UnionTech UOS 20 LoongArch

[`Penglai_0.6.0_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_uos_loong64.deb)

292,702,128 bytes · SHA-256 `a541e9fa9b06626750b4a87859cc76ff3df51b5a0eb8960de08e8eba20cad430`

The UOS package is published with that four-installer set. The project maintainer will test installation, startup, and functionality on a physical UOS machine after publication (`OWNER_POST_RELEASE`). The UOS runtime is Loongson Electron 31.7.7 (Chromium 126). That runtime is unmaintained. It does not provide the same security as Mac/Windows Electron 43 / Chromium 150.

## Quick start

```
Install the matching package
  → finish the seven-step wizard (a real model reply)
      → work in the DSH Workspace you selected
          → enable messaging, voice, or Companion only if you need them
```

Upgrade with the same-platform installer as a manual overlay. Default uninstall removes the application and cache while preserving user data. External Workspaces and data in `Penglai/0.5` remain.

<p align="center">
  <img src="website/shots/0.5.5/memory.png" width="48%" alt="Penglai Memory Workspace scope and correction">
  <img src="website/shots/0.5.5/privacy.png" width="48%" alt="Penglai first-run privacy step">
</p>
<p align="center"><sub>0.5.5 Memory settings and first-run privacy step. Model calls still send task context to the provider you selected.</sub></p>

## Boundaries

- There is no Penglai account, Penglai-operated telemetry backend, or cloud memory sync. Official DSH bundles a dormant DeepSeek OTLP endpoint; Penglai hard-disables it. Model calls still send the context required for a task to the provider you selected.
- Credentials are stored in app-private YAML through official DSH. That is not Keychain or hardware isolation.
- macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode**. Do not disable system security to install.
- Plugins share the local DSH process. Install only reviewed catalog entries and read their permissions.
- UnionTech UOS 20 LoongArch is the fourth packaged target. The project maintainer will test installation, startup, and functionality on a physical UOS machine after publication (`OWNER_POST_RELEASE`).
- UOS Electron 31.7.7 / Chromium 126 is unmaintained. It does not provide the same security as Mac/Windows Electron 43 / Chromium 150.
- Memory stays required and on for UOS, with the packed Mnemon engine. MOSS-TTS is not available on LoongArch and cannot be enabled there.
- Source tests, packaged tests, native installed Mac/Windows tests, and live external-account tests are reported separately.

## Further reading

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Plugin Center](docs/PLUGIN_CENTER.md) · [Security](SECURITY.md) · [0.6.0 notes](docs/RELEASE_NOTES_0.6.0.md) · [Acceptance delta](docs/0.6.0/ACCEPTANCE_DELTA.md)

## Why it is called Penglai

The name comes from the Eight Immortals crossing the sea, each relying on a different skill. Models, messaging, local voice, office work, and memory have different jobs too, but they meet around one DSH core.

I spent more than ten years around networking, security, and operations. I was not a software developer when this project began. What bothered me was not a lack of powerful agents. It was the amount of software knowledge an ordinary person had to learn before one of those agents became useful.

Penglai has been rebuilt more than once. Version 0.5 was the clear decision: stop building another agent and make the good open-source core easier to install, understand, extend, and trust. 0.6.0 keeps that decision, with installers for Apple Silicon, Intel Mac, Windows x64, and UnionTech UOS 20 LoongArch.

## Build, contribute, and AI-assisted work

This repository uses Node `22.23.2` and pnpm `11.7.0`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm verify:contracts
pnpm verify:dependencies
pnpm audit:secrets
```

Native package commands must run on their matching host. Start with [CONTRIBUTING.md](CONTRIBUTING.md). If an AI coding tool is working in the repository, give it [AGENTS.md](AGENTS.md) first.

Penglai is created and maintained by [Kevin Chen / 陈克文](https://github.com/kevinchennewbee). Kimi Work, Grok Build, Cursor Agent, Claude Code, and OpenAI Codex have all contributed implementation, research, review, or release work. These tools contributed to the work. I remain responsible for product decisions, acceptance, and releases.

Penglai uses [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), [Electron](https://github.com/electron/electron), [Node.js](https://github.com/nodejs/node), [TypeScript](https://github.com/microsoft/TypeScript), [pnpm](https://github.com/pnpm/pnpm), [SenseVoice](https://github.com/FunAudioLLM/SenseVoice), [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx), [MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano), [Mnemon](https://github.com/mnemon-dev/mnemon), [Lark Node SDK](https://github.com/larksuite/node-sdk), and [Tencent openclaw-weixin](https://github.com/Tencent/openclaw-weixin). Thanks also to [DSH-IM](https://github.com/xmanrui/dsh-im) and [qqbot-agent-sdk](https://github.com/tencent-connect/qqbot-agent-sdk) for references that Penglai rewrites inside its own IM control plane; neither upstream runtime is bundled. Office generation builds on [PPTFast](https://github.com/liustack/pptfast), [ExcelJS](https://github.com/exceljs/exceljs), [pdf-lib](https://github.com/Hopding/pdf-lib), and [Noto CJK](https://github.com/notofonts/noto-cjk). Every dependency keeps its own license.

<a id="中文"></a>

# 中文

## 它是什么

蓬莱是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面发行版。它把固定版本的 DSH、Node、Electron、官方会话界面、首次引导、升级、本地数据管理和一组经过审核的 DSH 插件，装进一个可以安装的客户端。

DSH 始终是唯一的 Agent 核心。Agent loop、模型、工具、审批、Workspace、Session、Turn 和会话界面都归 DSH。蓬莱负责打包、进程监管、安装引导、本地目录、升级、卸载、产品身份和插件分发。蓬莱不另做一套 Agent，也不另做一张聊天页。

```
你
  → 蓬莱（安装包、引导、插件、升级、卸载）
       → DeepSeek Harness（模型、工具、Workspace、Session、会话）
```

**Penglai 0.6.0** 使用官方 DeepSeek Harness `0.1.5-alpha.1`（tag `dsh-v0.1.5-alpha.1`，commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`，272 包）。办公和记忆默认开启。四个安装包面向 Apple 芯片、Intel Mac、Windows x64 和统信 UOS 20 龙芯，来自源码 `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`。正式下载见不可变发行版 [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0)。已发布的 v0.5.10、v0.5.11、v0.5.12 保持不可变。

## 怎么用

1. 下载对应平台的安装包：Apple 芯片、Intel Mac、Windows x64 或统信 UOS 20 龙芯，不要混用。
2. 走完七步引导，直到模型真正回复。可以返回、重试，关掉窗口之后也能接着做。密钥失败不会被记成成功。
3. 在引导里选好的 Workspace 里工作。办公写入需要针对这一次动作的确认；记忆只整理 *当前* Workspace 的安全事实。
4. 需要时再绑定微信、飞书或其他渠道，或下载本地语音模型。这些插件关闭、离线或缺少模型时，普通会话仍应可用。
5. 出现签名更新时由你确认安装，不会静默升级。

## 默认开着什么

| 产品功能 | 全新安装 | 能做什么 |
| --- | --- | --- |
| 蓬莱办公 | 默认启用 | 检查、创建、编辑、预览和保存 DOCX、XLSX、PPTX、PDF |
| 蓬莱记忆 | 默认启用 | 当前 Workspace 自动记忆、明确个人记忆、授权资料、来源追溯和知识图谱 |
| 消息连接 | 默认关闭 | 八个平台共用一个 IM 控制平面；WhatsApp 不是产品能力 |
| 蓬莱语音识别 | 默认关闭 | 本地 SenseVoice 转写；启用后为电脑会话提供麦克风入口 |
| 蓬莱语音生成 | 默认关闭 | 本地 MOSS-TTS-Nano 试听、电脑播放和支持渠道的语音输出 |
| 蓬莱主动陪伴 | 默认关闭 | 安静时段、每日上限、指定 IM 路由下的主动联系 |

插件中心里，日常操作就是安装并启用，或者停用。哈希、加载阶段、权限、回滚和诊断都还在，需要时可以看。

<p align="center">
  <img src="website/shots/0.5.5/plugin-center.png" width="48%" alt="官方 DSH 设置里的蓬莱插件中心">
  <img src="website/shots/0.5.5/office.png" alt="蓬莱办公的创建、查看和目标修改" width="48%">
</p>
<p align="center"><sub>0.5.5 安装版插件中心与办公界面，作为参考。界面状态不等于已安装或健康。</sub></p>

办公写入使用宿主发出的 `artifact:<uuid>` 句柄，并等待与动作绑定的确认。记忆召回不会搜索另一个 Workspace。记忆整理会调用你选择的模型供应商，判断哪些候选信息值得保留；存储和检索在本机完成。记忆必装默认开启，UOS 上也带入 Mnemon `0.2.8` 引擎。SenseVoice 大模型要你主动下载。MOSS-TTS 在龙芯上不可用，也不能启用。

## 下载

请使用对应安装包，不要混用。下载后用 [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0) 页的 `SHA256SUMS` 核对。权威公开源是 GitHub Release。Linux amd64 与 Windows ARM 不是目标。四个安装包来自源码 `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`。

### Apple 芯片，macOS 13+

[`Penglai_0.6.0_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_aarch64.dmg)

284,362,933 字节 · SHA-256 `98d1c0a133d50200c03626d39e225a52ff08d1f1a09fdb1595ab706b70f183cb`

### Intel Mac，macOS 13+

[`Penglai_0.6.0_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_x64.dmg)

293,996,120 字节 · SHA-256 `4c74a4ce9353ccf23aa74471d279237c4b5b9822d118aa2a90e44e16caf16498`

### Windows 10+ x64

[`Penglai_0.6.0_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_windows_x64_setup.exe)

369,849,038 字节 · SHA-256 `6316f623fe877686662b7b3a5641945bc946e2b1dd31bf3d9527c6a17f7c35e9`

### 统信 UOS 20 龙芯

[`Penglai_0.6.0_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_uos_loong64.deb)

292,702,128 字节 · SHA-256 `a541e9fa9b06626750b4a87859cc76ff3df51b5a0eb8960de08e8eba20cad430`

UOS 安装包已随另外三个安装包一起发布。龙芯实机上的安装、启动和功能测试，将由项目维护者在发布后完成（`OWNER_POST_RELEASE`）。该端运行时是龙芯 Electron 31.7.7（Chromium 126），已经停止维护。其安全维护水平与 Mac/Windows 使用的 Electron 43 / Chromium 150 不同。

## 快速开始

```
安装对应安装包
  → 走完七步引导（等到真实模型回复）
      → 在引导里选好的 Workspace 里工作
          → 需要时再启用消息、语音或主动陪伴
```

升级使用同平台安装包手动覆盖。默认卸载去掉应用和缓存，保留用户数据。外部工作区和 `Penglai/0.5` 中的数据会保留。

## 边界

- 没有蓬莱账号、蓬莱运营的遥测后端或云端记忆同步。官方 DSH 自带一个休眠的 DeepSeek OTLP 地址，蓬莱会硬性禁用。模型调用仍会把当前任务需要的内容发给你选择的供应商。
- 密钥写在官方 DSH 的应用私有 YAML 里。这不是钥匙串，也不是硬件隔离。
- macOS 是 ad-hoc 签名、**未公证**；Windows **没有 Authenticode**。请不要为了安装而关闭系统安全功能。
- 插件和 DSH 在同一本地进程中运行，只应安装经过审核的目录条目并阅读权限。
- 统信 UOS 20 龙芯是第四个打包目标。龙芯实机上的安装、启动和功能测试，将由项目维护者在发布后完成（`OWNER_POST_RELEASE`）。
- UOS 的 Electron 31.7.7 / Chromium 126 已经停止维护。其安全维护水平与 Mac/Windows 使用的 Electron 43 / Chromium 150 不同。
- UOS 上记忆必开，并带入 Mnemon 引擎。MOSS-TTS 在龙芯上不可用，也不能启用。
- 源码测试、打包测试、Mac/Windows 原生安装测试、真实外部账号测试分别记录。

## 继续阅读

[产品契约](docs/PRODUCT.md) · [架构](docs/ARCHITECTURE.md) · [插件中心](docs/PLUGIN_CENTER.md) · [安全说明](SECURITY.md) · [0.6.0 说明](docs/RELEASE_NOTES_0.6.0.md) · [验收增量](docs/0.6.0/ACCEPTANCE_DELTA.md)

## 为什么叫蓬莱

蓬莱这个名字借的是八仙过海的故事。模型、手机消息、本地语音、办公和记忆各有本领，但最后都围绕同一个 DSH 核心协作。

我做了十多年网络、安全和运维，开始做这个项目时并不会写软件。真正让我难受的，不是没有强大的 Agent，而是普通人要先学会太多软件知识，才能让这些 Agent 有用。

蓬莱重做过不止一次。0.5 是到目前为止最明确的一次选择：不再造另一个 Agent，而是把优秀的开源核心变得更容易安装、理解、扩展和信任。0.6.0 延续了这个方向，提供适用于 Apple 芯片、Intel Mac、Windows x64 和统信 UOS 20 龙芯的安装包。

## 构建、贡献与 AI 协作

本仓库使用 Node `22.23.2` 和 pnpm `11.7.0`。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm verify:contracts
pnpm verify:dependencies
pnpm audit:secrets
```

原生打包命令必须在对应平台运行。普通贡献者从 [CONTRIBUTING.md](CONTRIBUTING.md) 开始；如果让 AI 编程工具进入仓库，请先把 [AGENTS.md](AGENTS.md) 交给它。

蓬莱由 [Kevin Chen / 陈克文](https://github.com/kevinchennewbee) 创建并维护。Kimi Work、Grok Build、Cursor Agent、Claude Code 和 OpenAI Codex 都参与过实现、调研、审查或发布工作。这些工具参与了实际工作，产品决策、验收和发布仍由我负责。

蓬莱用到了这些开源项目：
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)、
[Electron](https://github.com/electron/electron)、
[Node.js](https://github.com/nodejs/node)、
[TypeScript](https://github.com/microsoft/TypeScript)、
[pnpm](https://github.com/pnpm/pnpm)、
[SenseVoice](https://github.com/FunAudioLLM/SenseVoice)、
[sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)、
[MOSS-TTS-Nano](https://github.com/OpenMOSS/MOSS-TTS-Nano)、
[Mnemon](https://github.com/mnemon-dev/mnemon)、
[Lark Node SDK](https://github.com/larksuite/node-sdk) 和
[Tencent openclaw-weixin](https://github.com/Tencent/openclaw-weixin)。
也特别感谢 [DSH-IM](https://github.com/xmanrui/dsh-im) 与 [qqbot-agent-sdk](https://github.com/tencent-connect/qqbot-agent-sdk) 提供参考。蓬莱只在自己的 IM 控制平面内重写这些思路，不会打包这两个上游运行时。蓬莱办公还建立在
[PPTFast](https://github.com/liustack/pptfast)、
[ExcelJS](https://github.com/exceljs/exceljs)、
[pdf-lib](https://github.com/Hopding/pdf-lib) 和
[Noto CJK](https://github.com/notofonts/noto-cjk) 之上。
每个依赖保留自己的许可证。
