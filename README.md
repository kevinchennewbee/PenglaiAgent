<p align="center">
  <img src="overlays/dsh-0.1.1-rc.1/brand/logo-256.png" width="112" alt="Penglai logo">
</p>

<h1 align="center">Penglai · 蓬莱</h1>

<p align="center">DeepSeek Harness, packaged for a personal computer.</p>

<p align="center">
  <a href="#english">English</a> ·
  <a href="#中文">中文</a> ·
  <a href="https://penglai.pages.dev">Website</a> ·
  <a href="https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.0">Current download</a> ·
  <a href="docs/RELEASE_NOTES_0.5.1.md">0.5.1 notes</a> ·
  <a href="SECURITY.md">Security</a>
</p>

> Penglai 0.5.1 is still being verified. The current public installer is 0.5.0 for Apple Silicon. Intel Mac and Windows x64 packages do not exist as accepted releases yet.

<p align="center">
  <img src="https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/gh-pages/shots/desktop-conversation.webp" width="31%" alt="Penglai desktop conversation">
  <img src="https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/gh-pages/shots/desktop-wizard-provider.webp" width="31%" alt="Penglai provider setup">
  <img src="https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/gh-pages/shots/feishu-approval.webp" width="31%" alt="Penglai Feishu approval">
</p>

<a id="english"></a>

# English

## What Penglai is

Penglai is a desktop distribution of [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). It packages a fixed DSH build, Node, Electron, the official DSH Web interface, a first-run setup flow, and a set of reviewed DSH plugins into an application that can be installed without preparing a development environment.

DSH owns the agent loop, models, tools, approvals, Workspace, Session, Turn, and the main Web interface. Penglai owns the desktop package, process supervision, local data layout, onboarding, update and uninstall behavior, product identity, and the plugin catalog. Penglai does not run a second agent or replace DSH chat with its own chat page.

The name comes from the story of the Eight Immortals crossing the sea, each using a different skill. In Penglai, models, channels, local voice, memory, and other plugins bring different abilities to one DSH core.

## Where the project is now

Penglai 0.5.0 was a clean architectural reset around official DSH `0.1.0-rc.8`. It shipped one Apple Silicon DMG on 20 August 2026.

The 0.5.1 work updates the core to official DSH `0.1.1-rc.1` and declares three release targets from one source commit:

| Platform | Planned 0.5.1 installer | Current status |
| --- | --- | --- |
| Apple Silicon, macOS 13+ | `Penglai_0.5.1_macos_aarch64.dmg` | native release verification in progress |
| Intel Mac | `Penglai_0.5.1_macos_x64.dmg` | native build and installed verification not complete |
| Windows x64 | `Penglai_0.5.1_windows_x64_setup.exe` | native NSIS build and installed verification not complete |

The source tree currently passes its format, type, build, unit, contract, integration, desktop E2E, dependency, license, secret, and CodeQL checks. That does not prove that all three installers work. A platform is supported only after its native package has been installed and tested on matching hardware.

## One DSH core, optional Penglai plugins

A fresh profile starts with DSH and Penglai Center. The other Penglai plugins are optional and must not prevent ordinary DSH conversation when they are absent, disabled, or broken.

| Package | What it adds |
| --- | --- |
| `@penglai/im` | authorised private conversations through Weixin and Feishu, with durable binding, routing, and recovery |
| `@penglai/asr` | local SenseVoice speech recognition, including language and emotion metadata |
| `@penglai/moss-tts` | local MOSS-TTS-Nano synthesis, preview, and supported channel audio output |
| `@penglai/context` | a local index for explicitly granted folders and host-verified source cards |
| `@penglai/memory` | global, Workspace, and session-candidate memory with confirmation boundaries |
| `@penglai/budget` | local usage limits based on the official DSH TokenMeter and model route |
| `@penglai/companion` | opt-in scheduled messages with quiet hours, daily limits, and channel binding |

The 0.5.1 source suite exercises these packages against DSH rc.1, including packaging, typed services, settings registration, persistence, failure isolation, and selected lifecycle behavior. Full installed compatibility is still under test. We will not describe the old plugin set as 0.5.1-compatible until every plugin has passed install, enable, restart, disable, upgrade, rollback, and uninstall checks in the packaged application.

## Plugin Center

Penglai Center is a real DSH host/client plugin inside the official DSH settings interface. Installed and active states come from the DSH loader inventory, not from a UI preference or a downloaded filename.

Version 0.5.1 adds PPDP/1, the Penglai Plugin Distribution Protocol. The client can discover versioned GitHub Releases from the public [Penglai Plugin Registry](https://github.com/kevinchennewbee/PenglaiPluginRegistry), verify a Penglai Ed25519 signature and each archive hash, install a package in the disabled state, ask for permission confirmation, and roll back a failed activation.

The protocol and trust root are in the 0.5.1 source. The first signed public catalog has not been published yet, so the current client has no remote catalog it can truthfully refresh. Once that release exists, new reviewed DSH plugins can be added to the catalog without rebuilding the Penglai desktop application.

Penglai Center does not accept arbitrary npm packages, Git repositories, or download URLs. A DSH plugin runs with the local DSH process permissions. Catalog permission fields explain what was reviewed and what the user is confirming; they are not an operating-system sandbox.

## Models and first run

Penglai uses the official DSH model directory, adapters, and local YAML credentials service. It does not keep a separate provider registry or API key store.

The setup flow covers privacy, language and appearance, provider credentials, the official model list, a real API test, Workspace selection, and the first official Turn. DeepSeek's rc.1 adapter includes `deepseek-v4-flash-vision-exp` with text and image input. The 0.5.1 source verifies model discovery and `image_url` attachment serialization; a real installed call with a user-provided key remains a release gate.

## Install and upgrade

The only accepted public desktop package today is [Penglai 0.5.0 for Apple Silicon](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.0). Download the DMG and compare it with the published `SHA256SUMS` before installing.

Penglai 0.5.0 cannot update itself to 0.5.1. Apple Silicon users will install 0.5.1 manually over the existing application; data under the isolated `Penglai/0.5` generation is preserved. Intel Mac and Windows x64 are new installations because 0.5.0 never shipped those packages.

Penglai 0.5.1 contains PUDP/1, a signed and versioned application-update protocol for later same-platform releases. It uses immutable tagged assets and `update-manifest-v1.json`, never a mutable `latest.json`. Updates require verification and user confirmation. They are not silent.

## Local data and trust

- There is no Penglai account, cloud sync, or telemetry service.
- Provider calls send the prompt and required context to the provider selected by the user.
- Credentials are written by the official DSH credentials service to an app-private YAML file. The renderer cannot read them back.
- ASR and TTS model files are downloaded only after user action from pinned sources with revision, size, and SHA-256 checks.
- Context reads only folders explicitly granted by the user and does not modify source files.
- Long-term global memory and reusable SOP writes require confirmation. Companion is off by default and cannot run tools unattended.
- macOS packages use ad-hoc signing and are not notarized. There is no Apple Developer ID.
- Windows packages have no Authenticode signature and may trigger SmartScreen warnings.
- Penglai's Ed25519 signatures protect update and plugin bytes. They do not replace Apple or Microsoft publisher identity.

See [Security](SECURITY.md), the [product and data contract](docs/PRODUCT.md), [Plugin Center](docs/PLUGIN_CENTER.md), and the release SBOM and third-party notices for the full boundary.

## Architecture

```text
Penglai Desktop (Electron)
  -> embedded Node and official DSH 0.1.1-rc.1
  -> authenticated loopback proxy
  -> setup wizard before DSH is ready
  -> official DSH Web for normal use
  -> Penglai Center and optional DSH plugins
```

The package contains its own runtime and does not fall back to a system Node, pnpm, Python, ffmpeg, global DSH install, or source checkout. Large speech model weights are optional downloads and never block DSH startup.

## Project history

Penglai has changed architecture more than once. The old versions remain in Git history and Releases because they explain how the product arrived here, but their runtimes are not mixed into 0.5.

| Generation | What it explored |
| --- | --- |
| 0.3 | the Python and GenericAgent product line |
| 0.4 | a TypeScript Host, Pi runtime, Tauri desktop, durable tasks, evidence, and personal context |
| 0.5.0 | a clean Electron distribution with official DSH as the only agent and Web UI core |
| 0.5.1 | DSH rc.1, three release targets, signed plugin distribution, and a signed future update path |

The useful product ideas can return as DSH plugins. Old databases, credentials, sessions, and execution engines do not automatically cross an architectural generation.

## Build and test

Development uses Node `22.22.2` and pnpm `10.14.0`.

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

Native packaging commands are target-specific:

```bash
pnpm package:dmg:arm       # native Apple Silicon Mac
pnpm package:dmg:intel     # native Intel Mac
pnpm package:windows       # native Windows x64 with MSVC and NSIS
```

A successful source build is not release evidence. See [0.5.1 publication contract](docs/PUBLICATION_0.5.1.md), [acceptance registry](docs/ACCEPTANCE.md), and [contributing guide](CONTRIBUTING.md).

## License and acknowledgements

Penglai source is released under the [MIT License](LICENSE). The Penglai name, logo, and visual identity are not granted by the software license.

Penglai builds on DeepSeek Harness, Electron, Node, SenseVoice, sherpa-onnx, MOSS-TTS-Nano, the Feishu SDK, the Weixin iLink reference implementation, and other open-source work. Each dependency keeps its own license and attribution. Release packages include `THIRD_PARTY_NOTICES.txt` and `SBOM.cdx.json`.

<a id="中文"></a>

# 中文

## 蓬莱是什么

蓬莱是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的桌面发行版。它把固定版本的 DSH、Node、Electron、官方 DSH Web、首次引导和经过审核的 DSH 插件装进一个普通应用，不要求用户先准备开发环境。

Agent loop、模型、工具、审批、Workspace、Session、Turn 和主界面都由 DSH 提供。蓬莱负责安装包、进程监管、本地数据目录、首次引导、升级与卸载、产品名称和插件目录。蓬莱不再运行第二套 Agent，也不做一张自己的聊天页来替代 DSH Web。

“蓬莱”这个名字借的是八仙过海的故事。模型、渠道、本地语音、记忆和其他插件各有本领，但共用一个 DSH 核心。

## 项目现在做到哪了

Penglai 0.5.0 围绕官方 DSH `0.1.0-rc.8` 重做了整个架构。2026 年 8 月 20 日发布的安装包只有一份 Apple Silicon DMG。

0.5.1 把核心更新到官方 DSH `0.1.1-rc.1`，并声明同一份源码的三个发行目标：

| 平台 | 计划中的 0.5.1 安装包 | 当前状态 |
| --- | --- | --- |
| Apple Silicon，macOS 13+ | `Penglai_0.5.1_macos_aarch64.dmg` | 正在做原生发布验收 |
| Intel Mac | `Penglai_0.5.1_macos_x64.dmg` | 原生构建与安装验收尚未完成 |
| Windows x64 | `Penglai_0.5.1_windows_x64_setup.exe` | 原生 NSIS 构建与安装验收尚未完成 |

当前源码已经通过格式、类型、构建、单元、契约、集成、桌面 E2E、依赖、许可证、秘密扫描和 CodeQL。源码测试通过不等于三个安装包可用。只有在对应原生硬件上安装并验过，才能把那个平台写进正式支持范围。

## 一个 DSH 核心，七个可选插件

全新 profile 只启动 DSH 和 Penglai Center。其他蓬莱插件都是可选项。插件缺失、关闭或出错时，普通 DSH 对话和无关插件必须照常工作。

| 插件 | 能力 |
| --- | --- |
| `@penglai/im` | 微信、飞书授权私聊，持久绑定、路由和恢复 |
| `@penglai/asr` | 本机 SenseVoice 语音识别，以及语言、情绪元数据 |
| `@penglai/moss-tts` | 本机 MOSS-TTS-Nano 合成、试听和渠道语音输出 |
| `@penglai/context` | 为用户明确授权的目录建立本地索引，显示由 host 核对的来源卡 |
| `@penglai/memory` | global、Workspace 和 session candidate 分层记忆，受确认边界约束 |
| `@penglai/budget` | 根据 official DSH TokenMeter 与模型 route 统计和限制本地用量 |
| `@penglai/companion` | 默认关闭的定时陪伴，带安静时段、每日上限和渠道绑定 |

0.5.1 的源码测试已经在 DSH rc.1 下覆盖这些包的打包、类型化服务、设置注册、持久化、故障隔离和部分生命周期。真实安装兼容还在验证。每个插件没有走完安装、启用、重启、停用、升级、回滚和卸载之前，我们不会写“0.5.1 完全兼容原插件”。

## 插件中心怎么更新

Penglai Center 是 official DSH settings 里的真实 host/client 插件。installed 和 active 状态只认 DSH loader inventory，不认 UI 里的开关文字，也不认下载目录里有没有一个文件。

0.5.1 加入 PPDP/1，也就是蓬莱插件发行协议。客户端从公开的 [Penglai Plugin Registry](https://github.com/kevinchennewbee/PenglaiPluginRegistry) 查找按版本发布的 GitHub Release，验证蓬莱 Ed25519 签名和每个 tar 包的 SHA。插件先以 disabled 状态安装，用户确认权限后再启用；启用失败会回滚。

协议和公钥已经进入 0.5.1 源码，但第一份正式签名 catalog 还没有发布。现在点击刷新，没有可用的远端目录是正常结果。第一份 catalog 通过验收并发布后，以后加入新的 DSH 插件只需要发一个新的 catalog sequence，不需要为了改列表重做桌面客户端。

插件中心不接受任意 npm、Git 仓库或下载 URL。DSH 插件与本机 DSH 进程共享权限。catalog 里的 permission 用来说明审核内容和用户正在确认什么，不是操作系统沙箱。

## 模型与首次引导

蓬莱使用 official DSH 的模型目录、adapter 和本地 YAML credentials service，不维护第二份 provider 列表或 API Key 仓库。

首次引导包括隐私、语言和外观、provider 凭据、official model list、真实 API test、Workspace 和第一条 official Turn。DSH rc.1 的 DeepSeek adapter 已包含 `deepseek-v4-flash-vision-exp`，支持文本与图片输入。0.5.1 源码已经验证模型发现和 `image_url` 图片附件序列化；使用用户 Key 的真实安装调用仍是发布门禁。

## 安装与升级

目前唯一通过公开验收的桌面安装包是 [Penglai 0.5.0 Apple Silicon 版](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.0)。下载 DMG 后，请用 Release 中的 `SHA256SUMS` 核对文件。

0.5.0 不能在应用内直接升级到 0.5.1。Apple Silicon 用户需要手动覆盖安装，隔离在 `Penglai/0.5` 下的数据会保留。0.5.0 没有 Intel 与 Windows 客户端，这两个平台安装 0.5.1 属于全新安装。

0.5.1 包含 PUDP/1，为后续同平台版本提供签名、按版本发布的辅助更新。它读取 immutable tag 下的 `update-manifest-v1.json`，不用可变的 `latest.json`。更新必须先校验，再由用户确认，不会静默替换应用。

## 本地数据与信任边界

- 没有蓬莱账号、云同步或遥测服务。
- 调用云模型时，prompt 和本次任务需要的上下文会发送给用户选择的 provider。
- 凭据由 official DSH credentials service 写入应用私有的 YAML 文件，renderer 不能读回明文。
- ASR/TTS 模型只在用户操作后下载，固定来源、revision、size 和 SHA-256。
- Context 只读取用户明确授权的目录，不修改源文件。
- 写入长期 global memory 或可复用 SOP 需要确认。Companion 默认关闭，不能无人值守使用工具。
- macOS 安装包采用 ad-hoc 签名，没有 Apple Developer ID，也没有公证。
- Windows 安装包没有 Authenticode，可能出现 SmartScreen 提示。
- 蓬莱 Ed25519 签名保护更新和插件字节，不能代替 Apple 或 Microsoft 的发行者身份。

完整说明见[安全文档](SECURITY.md)、[产品与数据合同](docs/PRODUCT.md)、[插件中心合同](docs/PLUGIN_CENTER.md)，以及 Release 中的 SBOM 和第三方声明。

## 架构

```text
Penglai Desktop (Electron)
  -> 内置 Node 与 official DSH 0.1.1-rc.1
  -> authenticated loopback proxy
  -> DSH 就绪前显示首次引导
  -> 日常使用进入 official DSH Web
  -> Penglai Center 与可选 DSH 插件
```

安装包自带运行时，不会回退到系统 Node、pnpm、Python、ffmpeg、全局 dsh 或源码目录。大型语音模型按需下载，不影响 DSH 首次启动。

## 版本历史

蓬莱换过几次架构。旧版本保留在 Git 历史和 Release 里，因为这些经历解释了今天的产品，但旧 runtime 不会混进 0.5。

| 版本 | 当时在解决什么 |
| --- | --- |
| 0.3 | Python 与 GenericAgent 产品线 |
| 0.4 | TypeScript Host、Pi runtime、Tauri 桌面、持久任务、证据和个人上下文 |
| 0.5.0 | 以 official DSH 为唯一 Agent 与 Web UI 核心的 Electron 发行版 |
| 0.5.1 | DSH rc.1、三个发行目标、签名插件目录和后续签名更新路径 |

有价值的产品想法可以重新做成 DSH 插件。旧数据库、凭据、会话和执行引擎不会自动跨架构继承。

## 从源码构建与测试

开发环境使用 Node `22.22.2` 和 pnpm `10.14.0`。

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

安装包必须在对应原生平台构建：

```bash
pnpm package:dmg:arm       # Apple Silicon Mac
pnpm package:dmg:intel     # Intel Mac
pnpm package:windows       # Windows x64，需要 MSVC 与 NSIS
```

源码构建成功不算发布证据。发布流程见 [0.5.1 公开发布合同](docs/PUBLICATION_0.5.1.md)、[验收清单](docs/ACCEPTANCE.md)与[贡献指南](CONTRIBUTING.md)。

## License 与致谢

Penglai 源码使用 [MIT License](LICENSE)。软件许可证不包含 Penglai 名称、logo 和视觉识别的授权。

Penglai 建立在 DeepSeek Harness、Electron、Node、SenseVoice、sherpa-onnx、MOSS-TTS-Nano、飞书 SDK、微信 iLink 参考实现和其他开源工作之上。各依赖保留原许可证与归属。正式安装包会附带 `THIRD_PARTY_NOTICES.txt` 和 `SBOM.cdx.json`。
