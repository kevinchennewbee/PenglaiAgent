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

Privacy and installation authority remain stricter than the upstream defaults:
the canonical session-log/upload plugin and upstream free-form plugin manager,
tool, and UI are disabled in the Penglai profile. Only the signed Penglai Plugin
Center may install catalog artifacts.

The planned target set remains Apple Silicon, Windows x64, and UnionTech UOS 20
LoongArch. The later native phase must prove fresh install, restart, default
uninstall, and the exact 0.6.2-to-0.6.3 installed upgrade on Mac and Windows.
UOS native use remains `OWNER_POST_RELEASE`; the two-hour soak remains
`OWNER_EXCLUDED`. macOS is expected to remain ad-hoc signed and not notarized;
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

隐私和安装权限继续采用更严格默认值：Penglai profile 默认关闭 canonical session
log/upload，以及上游自由安装插件的 manager/tool/UI；只有签名的蓬莱插件中心可以
安装目录内制品。

计划目标仍为 Apple 芯片、Windows x64 和统信 UOS 20 龙芯。后续三端阶段必须验证
Mac/Windows 全新安装、重启、默认卸载和 0.6.2 到 0.6.3 的真实安装版升级。UOS
真机仍为 `OWNER_POST_RELEASE`，两小时测试仍为 `OWNER_EXCLUDED`。当前只是源码
候选，三端安装包、原生安装、公开发布、官网更新与公网回读均为 `NOT_RUN`。
