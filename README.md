<p align="center">
  <img src="website/art/readme-hero-060.png" width="100%" alt="Penglai 蓬莱: DeepSeek Harness, on your computer">
</p>

# Penglai · 蓬莱

Official DeepSeek Harness, installed on a personal computer.

[English](#english) · [中文](#中文) · [Website](https://penglai.pages.dev) · [中文网站](https://penglai.pages.dev/zh/) · [Security](SECURITY.md)

**Penglai 0.6.1** is the current public download. It installs official DeepSeek Harness `0.1.5-rc.1` (tag `dsh-v0.1.5-rc.1`, commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`, 279 npm packages) on Apple Silicon, Intel Mac, Windows x64, and UnionTech UOS 20 LoongArch. DSH remains the only agent core. Office and Memory are enabled by default.

Download the immutable release: [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1). Published v0.5.10, v0.5.11, v0.5.12, and v0.6.0 tags stay immutable.
[Release notes](docs/RELEASE_NOTES_0.6.1.md) · [Acceptance delta](docs/0.6.1/ACCEPTANCE_DELTA.md)

<p align="center">
  <img src="website/shots/0.5.5/welcome.png" width="78%" alt="Penglai first-run welcome: language, appearance, and a seven-step guide">
</p>
<p align="center"><sub>Installed 0.5.5 first-run welcome, kept as a UI reference. Not a 0.6.1 screenshot.</sub></p>

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
2. Finish seven first-run steps until a real model reply arrives. Fresh setup lists official `deepseek-flash` (DeepSeek-V41-Flash) with text and image input. A model you already chose stays in official settings. Folder browse for Add workspace and a new conversation stays in the Penglai window; you can cancel, retry, or pick another folder. Back, retry, and restart-resume are supported. A failed API key is never recorded as success. The app data directory and the install directory cannot be Workspaces.
3. Work in the DSH Workspace you selected. Office can inspect, create, preview, export, and save DOCX, XLSX, PPTX, and PDF after a confirmation bound to that action. That is not dropping a file in the composer, and it is not sending a picture to a vision model. Memory may keep safe facts for *this* Workspace only. A later Workspace does not see them. Saving a candidate, starting a new Workspace, and restarting the app keep that boundary.
4. Optionally bind Weixin, Feishu, or another supported channel; optionally enable macOS iMessage after Full Disk Access and Messages automation; optionally install local speech models. Ordinary conversation must still work if those plugins are off, offline, or missing weights.
5. When a signed desktop update appears, you choose to install it. Updates are never silent.

## What starts enabled

| Product surface | Fresh install | What it does |
| --- | --- | --- |
| Penglai Office | On | Inspect, create, edit, preview, export, and save DOCX, XLSX, PPTX, and PDF |
| Penglai Memory | On | Automatic current-Workspace memory, explicit personal memory, authorised sources, provenance, and a knowledge graph |
| Mobile Messaging | Off | Eight connectors under one IM control plane, plus optional macOS iMessage (private text, default off). WhatsApp is not a product surface |
| Speech Recognition | Off | Local SenseVoice transcription; enabling it adds the conversation microphone entry |
| Voice Generation | Off | Local MOSS-TTS-Nano preview, desktop playback, and supported channel audio |
| Companion | Off | Opt-in scheduled contact with quiet hours, daily limits, and a bound IM route |

In Plugin Center the usual action is install and enable, or disable. Hashes, loader phases, permissions, rollback, and diagnostics stay available if you need them. The live signed catalog remains [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006): it lists no extra downloads and keeps the historic office-reader revocation. A reviewed DSH `0.1.5-rc.1`-compatible plugin can join later without shipping a new desktop version merely to change a list.

<p align="center">
  <img src="website/shots/0.5.5/plugin-center.png" width="48%" alt="Penglai Plugin Center in official DSH settings">
  <img src="website/shots/0.5.5/office.png" width="48%" alt="Penglai Office create, inspect, and planned-edit controls">
</p>
<p align="center"><sub>Installed 0.5.5 Plugin Center and Office, kept as UI references. UI state is never proof of installation or health. Not 0.6.1 screenshots.</sub></p>

Office writes use host-issued `artifact:<uuid>` handles and wait for a confirmation bound to that action. Sending a picture in chat uses the official image store. A generic file in the composer is a same-session upload receipt; the model later sees handle text (name, size, harness-owned saved path), not a native Office document. Penglai does not claim that the composer attaches ordinary DOCX, XLSX, PPTX, or PDF. Structured Office inspect, preview, export, and saved bytes are the product path for those files. The official generic right sidebar is plain text for DOCX and may call the file non-text.

Memory recall never searches another Workspace. Memory uses your selected model provider to decide which candidate facts to keep. Storage and recall stay local. Memory is required and default-on, including on UOS, with the Mnemon `0.2.8` engine packed. Large SenseVoice weights download only after an explicit action. MOSS-TTS is not available and cannot be enabled on LoongArch.

WeChat and Feishu remain the native media channels. Admitted non-image files enter the bound official conversation as official file blocks, separate from Office export and from chat image vision. If the bound conversation or agent preset is missing, messaging keeps a durable error with `/projects` and `/new`, not a one-line unknown failure. Optional macOS iMessage is private text, default off, and Darwin-only. Enable it only after granting Full Disk Access and Messages automation, then bind the exact peer. It does not read images, files, or group chats. Native iMessage live use is not claimed. The channel is unsupported on Windows and UOS. WhatsApp is not displayed, supported, or bundled.

## Download

Use the matching file. Do not mix platforms. Check the downloaded installer against `SHA256SUMS` on [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1). GitHub Releases is the authoritative source. Linux amd64 and Windows ARM are not targets.

### Apple Silicon, macOS 13+

[`Penglai_0.6.1_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_aarch64.dmg)

### Intel Mac, macOS 13+

[`Penglai_0.6.1_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_x64.dmg)

### Windows 10+ x64

[`Penglai_0.6.1_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_windows_x64_setup.exe)

### UnionTech UOS 20 LoongArch

[`Penglai_0.6.1_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_uos_loong64.deb)

The UOS package is published with that four-installer set. Physical UOS install, startup, and function remain Owner post-publication testing (`OWNER_POST_RELEASE`), not PASS. Mac and Windows packages embed Node `22.23.2` and Electron `43.6.0` (Chromium 150). The UOS runtime is Loongson Node `22.16.0` and Electron `31.7.7` (Chromium 126). That Electron train is unmaintained. It does not provide the same security as Mac/Windows Electron 43 / Chromium 150.

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
<p align="center"><sub>0.5.5 Memory settings and first-run privacy step. Model calls still send task context to the provider you selected. Not 0.6.1 screenshots.</sub></p>

## Boundaries

- There is no Penglai account, Penglai-operated telemetry backend, or cloud memory sync. Official DSH bundles a dormant DeepSeek OTLP endpoint; Penglai hard-disables it. Model calls still send the context required for a task to the provider you selected.
- Credentials are stored in app-private YAML through official DSH. That is not Keychain or hardware isolation.
- macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode**. Do not disable system security to install.
- Plugins share the local DSH process. Install only reviewed catalog entries and read their permissions.
- UnionTech UOS 20 LoongArch is the fourth packaged target. Native install, startup, and function on a physical UOS host remain `OWNER_POST_RELEASE`. The 0.6.0 UOS record is historical for that release only; it is not a 0.6.1 native PASS.
- UOS Electron 31.7.7 / Chromium 126 is unmaintained. UOS Node is vendor `22.16.0`, not the Mac/Windows `22.23.2`. That is not a Mac/Windows security equivalent.
- Memory stays required and on for UOS, with the packed Mnemon engine. MOSS-TTS is not available on LoongArch and cannot be enabled there.
- Optional macOS iMessage is default off. Native iMessage live evidence is not claimed (`LIVE_NOT_RUN`). Windows and UOS never call macOS Messages helpers.
- Source tests, packaged tests, native installed Mac/Windows tests, and live external-account tests are reported separately. This page does not claim a four-target native GUI PASS, live provider replies on every target, or notarization.

## Further reading

[Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Plugin Center](docs/PLUGIN_CENTER.md) · [Security](SECURITY.md) · [0.6.1 notes](docs/RELEASE_NOTES_0.6.1.md) · [Acceptance delta](docs/0.6.1/ACCEPTANCE_DELTA.md)

## Why it is called Penglai

The name comes from the Eight Immortals crossing the sea, each relying on a different skill. Models, messaging, local voice, office work, and memory have different jobs too, but they meet around one DSH core.

I spent more than ten years around networking, security, and operations. I was not a software developer when this project began. What bothered me was not a lack of powerful agents. It was the amount of software knowledge an ordinary person had to learn before one of those agents became useful.

Penglai has been rebuilt more than once. Version 0.5 was the clear decision: stop building another agent and make the good open-source core easier to install, understand, extend, and trust. 0.6.1 keeps that decision, with installers for Apple Silicon, Intel Mac, Windows x64, and UnionTech UOS 20 LoongArch.

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

**Penglai 0.6.1** 是当前公开下载版本，使用官方 DeepSeek Harness `0.1.5-rc.1`（tag `dsh-v0.1.5-rc.1`，commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`，279 包）。办公和记忆默认开启。四个安装包面向 Apple 芯片、Intel Mac、Windows x64 和统信 UOS 20 龙芯。正式下载见不可变发行版 [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1)。已发布的 v0.5.10、v0.5.11、v0.5.12、v0.6.0 保持不可变。

## 怎么用

1. 下载对应平台的安装包：Apple 芯片、Intel Mac、Windows x64 或统信 UOS 20 龙芯，不要混用。
2. 走完七步引导，直到模型真正回复。全新安装会列出官方 `deepseek-flash`（DeepSeek-V41-Flash），支持文本和图片输入。你已经明确选过的模型留在官方设置里。添加工作区和发起新会话时，选文件夹的窗口留在蓬莱里，可以取消、重试或换一个目录。可以返回、重试，关掉窗口之后也能接着做。密钥失败不会被记成成功。应用数据目录和安装目录不能当作 Workspace。
3. 在引导里选好的 Workspace 里工作。办公可以检查、创建、预览、导出和保存 DOCX、XLSX、PPTX、PDF，写入前要有与动作绑定的确认。这不是把文件丢进输入框，也不是把图片发给视觉模型。记忆只整理 *当前* Workspace 的安全事实。换一个 Workspace 看不见。保存候选、新建工作区、重启应用，这条边界都还在。
4. 需要时再绑定微信、飞书或其他渠道；macOS 上可选的 iMessage 要先授予完全磁盘访问和 Messages 自动化；本地语音模型也要你主动安装。这些插件关闭、离线或缺少模型时，普通会话仍应可用。
5. 出现签名更新时由你确认安装，不会静默升级。

## 默认开着什么

| 产品功能 | 全新安装 | 能做什么 |
| --- | --- | --- |
| 蓬莱办公 | 默认启用 | 检查、创建、编辑、预览、导出和保存 DOCX、XLSX、PPTX、PDF |
| 蓬莱记忆 | 默认启用 | 当前 Workspace 自动记忆、明确个人记忆、授权资料、来源追溯和知识图谱 |
| 消息连接 | 默认关闭 | 八个平台共用一个 IM 控制平面，另加可选的 macOS iMessage（仅私聊文本，默认关闭）；WhatsApp 不是产品能力 |
| 蓬莱语音识别 | 默认关闭 | 本地 SenseVoice 转写；启用后为电脑会话提供麦克风入口 |
| 蓬莱语音生成 | 默认关闭 | 本地 MOSS-TTS-Nano 试听、电脑播放和支持渠道的语音输出 |
| 蓬莱主动陪伴 | 默认关闭 | 安静时段、每日上限、指定 IM 路由下的主动联系 |

插件中心里，日常操作就是安装并启用，或者停用。哈希、加载阶段、权限、回滚和诊断都还在，需要时可以看。当前线上签名目录仍是 [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006)：没有可下载的额外插件，并保留对旧 office-reader 的撤销。以后若有通过审核、兼容 DSH `0.1.5-rc.1` 的插件，不必只为改一张列表重发桌面版本。

<p align="center">
  <img src="website/shots/0.5.5/plugin-center.png" width="48%" alt="官方 DSH 设置里的蓬莱插件中心">
  <img src="website/shots/0.5.5/office.png" alt="蓬莱办公的创建、查看和目标修改" width="48%">
</p>
<p align="center"><sub>0.5.5 安装版插件中心与办公界面，作为参考。界面状态不等于已安装或健康。不是 0.6.1 截图。</sub></p>

办公写入使用宿主发出的 `artifact:<uuid>` 句柄，并等待与动作绑定的确认。聊天里发图片走官方图片存储。输入框里的普通文件是同一次会话的上传回执；模型稍后看到的是句柄文字（文件名、大小、Harness 保存路径），不是原生办公文档。蓬莱不宣称输入框能直接附上普通 DOCX、XLSX、PPTX 或 PDF。这些文件的产品路径是办公的检查、预览、导出和保存。官方通用侧栏对 DOCX 只提供纯文本预览，也可能把它报成非文本文件。

记忆召回不会搜索另一个 Workspace。记忆整理会调用你选择的模型供应商，判断哪些候选信息值得保留；存储和检索在本机完成。记忆必装默认开启，UOS 上也带入 Mnemon `0.2.8` 引擎。SenseVoice 大模型要你主动下载。MOSS-TTS 在龙芯上不可用，也不能启用。

微信和飞书仍是原生媒体通道。允许进入的非图片文件会成为绑定官方会话里的官方文件块，这和办公导出、聊天图片视觉不是同一条路。如果绑定的会话或 Agent Preset 不可用，消息连接会留下可处理的错误（`/项目`、`/新建`），而不是一句不明原因的失败。可选的 macOS iMessage 仅私聊文本、默认关闭、只在 Darwin 可用。请先授予完全磁盘访问和 Messages 自动化，再启用并把精确对端绑定好。它不读图片、文件或群聊。真机 iMessage 未取证。Windows 与 UOS 不可用，也不会调用 macOS Messages 助手。不提供 WhatsApp。

## 下载

请使用对应安装包，不要混用。下载后用 [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1) 页的 `SHA256SUMS` 核对。权威公开源是 GitHub Release。Linux amd64 与 Windows ARM 不是目标。

### Apple 芯片，macOS 13+

[`Penglai_0.6.1_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_aarch64.dmg)

### Intel Mac，macOS 13+

[`Penglai_0.6.1_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_x64.dmg)

### Windows 10+ x64

[`Penglai_0.6.1_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_windows_x64_setup.exe)

### 统信 UOS 20 龙芯

[`Penglai_0.6.1_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_uos_loong64.deb)

UOS 安装包已随另外三个安装包一起发布。龙芯真机安装/启动/功能仍是 Owner 发布后测试（`OWNER_POST_RELEASE`），不是 PASS。Mac/Windows 包内是 Node `22.23.2` 与 Electron `43.6.0`（Chromium 150）。UOS 运行时是龙芯 Node `22.16.0` 与 Electron `31.7.7`（Chromium 126），已经停止维护。其安全维护水平与 Mac/Windows 使用的 Electron 43 / Chromium 150 不同。

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
- 统信 UOS 20 龙芯是第四个打包目标。真机安装/启动/功能仍是 `OWNER_POST_RELEASE`。0.6.0 的 UOS 记录只属于那一次发布，不是 0.6.1 的原生 PASS。
- UOS 的 Electron 31.7.7 / Chromium 126 已经停止维护。UOS 的 Node 是厂商 `22.16.0`，不是 Mac/Windows 的 `22.23.2`。这不是 Mac/Windows 的安全等价。
- UOS 上记忆必开，并带入 Mnemon 引擎。MOSS-TTS 在龙芯上不可用，也不能启用。
- 可选的 macOS iMessage 默认关闭。真机 iMessage 证据为 `LIVE_NOT_RUN`。Windows 与 UOS 不会调用 macOS Messages 助手。
- 源码测试、打包测试、Mac/Windows 原生安装测试、真实外部账号测试分别记录。本页不宣称四端原生界面全部 PASS，也不宣称每个目标都有真实模型回复或系统公证。

## 继续阅读

[产品契约](docs/PRODUCT.md) · [架构](docs/ARCHITECTURE.md) · [插件中心](docs/PLUGIN_CENTER.md) · [安全说明](SECURITY.md) · [0.6.1 说明](docs/RELEASE_NOTES_0.6.1.md) · [验收增量](docs/0.6.1/ACCEPTANCE_DELTA.md)

## 为什么叫蓬莱

蓬莱这个名字借的是八仙过海的故事。模型、手机消息、本地语音、办公和记忆各有本领，但最后都围绕同一个 DSH 核心协作。

我做了十多年网络、安全和运维，开始做这个项目时并不会写软件。真正让我难受的，不是没有强大的 Agent，而是普通人要先学会太多软件知识，才能让这些 Agent 有用。

蓬莱重做过不止一次。0.5 是到目前为止最明确的一次选择：不再造另一个 Agent，而是把优秀的开源核心变得更容易安装、理解、扩展和信任。0.6.1 延续了这个方向，提供适用于 Apple 芯片、Intel Mac、Windows x64 和统信 UOS 20 龙芯的安装包。

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
