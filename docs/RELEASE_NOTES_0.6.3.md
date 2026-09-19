# Penglai 0.6.3 development notes

Status: source candidate, not released. Native installers, installed lifecycle
validation, immutable publication, public readback, and website deployment are
`NOT_RUN`.

## English

Penglai 0.6.3 moves the desktop distribution from official DeepSeek Harness
0.1.5-rc.2 to the exact 0.1.6-alpha.2 cohort: tag
`dsh-v0.1.6-alpha.2`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`, and 307 source-cohort packages
with registry integrity. The upstream ledger also records Office/PDF and the
six independent LibreOffice Kit packages, but Penglai prunes those packages
from the 0.6.3 product runtime.

The main compatibility change is Session ownership. Memory provenance,
onboarding final-message proof, and IM
recovery/deduplication now use official asynchronous Session Controller
inspection instead of deprecated synchronous event reads. DSH Home migration
creates an isolated alpha.2 generation from the published rc.2 generation and
activates it only after validation.

The alpha.2 DeepSeek adapter no longer advertises the former
`deepseek-v4-flash-vision-exp` model ID. Image turns now use the advertised
`deepseek-flash` / `DeepSeek-V41-Flash` route, its `text,image` capability, and
the `/v1/messages` SSE protocol.

The upstream generation also expands terminal, browser/computer-use, SSH, PTC,
MCP resource, workspace-change, preview, Office conversion, plan, deliverable,
and subagent/sidebar surfaces. Penglai audits their exact package graph but
does not add a parallel host or executor. All first-party plugins remain on the
one official DSH runtime.

Penglai 0.6.3 does not include LibreOffice, Office/PDF, Budget, or Companion.
Their historical workspaces are excluded and their upstream packages are
removed from the profile, catalog, product runtime closure, installer staging,
and product SBOM. Memory is the only required first-party feature plugin.

Mobile Messaging is installed and active on a fresh profile, while every
channel and account remains unconfigured until the user connects it. ASR and
MOSS-TTS stay disabled by default. Their plugin code, UI, services, and
supported-target inference runtimes are bundled; model weights are separate,
pinned downloads. MOSS-TTS remains unavailable on UOS LoongArch because the
pinned ONNX Runtime has no supported native engine for that target.

Privacy remains stricter than the upstream defaults: the canonical
session-log/upload path stays disabled. Package management now uses the exact
official DSH alpha.2 plugin manager as the sole backend; its official UI/tool are
enabled through Penglai Center, package operations use application-owned
Node/pnpm, and build-script approval remains a separate explicit trust action.
The historical signed Penglai catalog is not an ecosystem allowlist.

The planned target set remains Apple Silicon, Windows x64, and UnionTech UOS 20
LoongArch. Native validation must prove fresh install, restart, and default
uninstall on Mac and Windows. The exact 0.6.2-to-0.6.3 installed upgrade is
`OWNER_EXCLUDED` and is not a publication PASS requirement. UOS native use
remains `OWNER_POST_RELEASE`; the two-hour soak is also `OWNER_EXCLUDED`.
macOS is expected to remain ad-hoc signed and not notarized;
Windows is expected to remain without Authenticode. None of those native or
publication statements is a PASS in this source candidate.

## 中文

Penglai 0.6.3 将桌面发行版从官方 DeepSeek Harness 0.1.5-rc.2 原子升级到
0.1.6-alpha.2：固定 tag `dsh-v0.1.6-alpha.2`、commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`，并锁定带 registry integrity 的
307 个源码 cohort 包。上游审计清单仍记录 Office/PDF 和六个 LibreOffice Kit 包，
但这些包不会进入 0.6.3 产品运行闭包。

本次最主要的适配是 Session 所有权：记忆来源证明、首次
引导终态取证，以及 IM 恢复和去重，全部改用官方异步 Session Controller inspection，
不再读取已弃用的同步事件快照。DSH Home 从已发布 rc.2 复制到隔离的 alpha.2
generation，只有验证通过后才切换。

alpha.2 的 DeepSeek adapter 不再提供旧的 `deepseek-v4-flash-vision-exp`
模型 ID；图片消息改用其实际公布且支持 `text,image` 的 `deepseek-flash` /
`DeepSeek-V41-Flash` 路由及 `/v1/messages` SSE 协议。

上游还新增或重构了终端、浏览器/计算机操作、SSH、PTC、MCP resource、Workspace
变更、预览、Office 转换、计划、交付物和 subagent/sidebar 能力。蓬莱审计完整精确
依赖图，但不增加第二套 Host、执行器或会话引擎；全部第一方插件仍运行在唯一官方
DSH 核心上。

Penglai 0.6.3 不包含 LibreOffice、Office/PDF、预算或主动陪伴。其历史 workspace
被排除，上游对应包也从 profile、catalog、产品运行闭包、安装包 staging 和产品
SBOM 中移除。记忆是唯一必装的第一方功能插件。

手机消息在 fresh profile 中已经安装并 active，但所有通道与账号仍保持未配置，只有
用户连接后才会启动。ASR 与 MOSS-TTS 默认关闭；其插件代码、UI、服务和受支持目标的
推理运行时随包，模型权重按固定版本与哈希另行下载。UOS 龙芯没有受支持的原生 ONNX
Runtime，因此该端仍不能启用 MOSS-TTS。

隐私仍采用更严格默认值：Penglai profile 默认关闭 canonical session log/upload。
插件管理改为只使用官方 DSH alpha.2 manager 作为唯一包管理后端，通过 Penglai Center
开放官方 UI/工具；包操作固定使用应用内 Node/pnpm，build script 仍需单独显式批准。
历史签名目录不再作为整个插件生态的 allowlist。

计划目标仍为 Apple 芯片、Windows x64 和统信 UOS 20 龙芯。三端阶段必须验证
Mac/Windows 全新安装、重启和默认卸载；0.6.2 到 0.6.3 的真实安装版升级在本版为
`OWNER_EXCLUDED`，不作为发布 PASS 条件。UOS 真机仍为 `OWNER_POST_RELEASE`，
两小时测试同样为 `OWNER_EXCLUDED`。当前仍是发布候选，
候选，三端安装包、原生安装、公开发布、官网更新与公网回读均为 `NOT_RUN`。
