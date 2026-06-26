<div align="center">

<img src=".github/assets/banner.png" alt="蓬莱 Penglai" width="100%"/>

# 蓬莱 Penglai 0.3.1

### 面向普通人的自托管 AI Runtime Hub

`penglai` CLI 是产品核心，Runtime Hub 是运行中枢，桌面是原生控制面。把能干活的 Agent 带到你的桌面、飞书、微信、终端和声音里。

[![License](https://img.shields.io/badge/code-MIT-22c55e?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Desktop](https://img.shields.io/badge/Desktop-macOS%20%7C%20Windows-0f766e?style=flat-square)](https://github.com/kevinchennewbee/PenglaiAgent/releases)
[![Runtime](https://img.shields.io/badge/Runtime-Hub-c44531?style=flat-square)](#penglai-runtime-hub)
[![Kernel](https://img.shields.io/badge/powered%20by-GenericAgent-8b5cf6?style=flat-square)](https://github.com/lsdefine/GenericAgent)
[![Website](https://img.shields.io/badge/Website-Penglai-3fbaa6?style=flat-square)](https://kevinchennewbee.github.io/PenglaiAgent/)

**中文** · [English](README_EN.md) · [官网](https://kevinchennewbee.github.io/PenglaiAgent/) · [Release](https://github.com/kevinchennewbee/PenglaiAgent/releases)

</div>

> **官方渠道**：本 GitHub 仓库 · [kevinchennewbee.github.io/PenglaiAgent](https://kevinchennewbee.github.io/PenglaiAgent/) · [penglai.pages.dev](https://penglai.pages.dev/) · PyPI [`penglai`](https://pypi.org/project/penglai)。不要在非官方渠道输入 API Key、机器人 token 或任何账号凭证。

---

**蓬莱**不是另一个聊天机器人壳子。它是一个跑在你自己机器上的个人 AI Runtime Hub：[GenericAgent](https://github.com/lsdefine/GenericAgent) 是执行内核，`penglai` CLI 是产品核心，Runtime Hub 是运行中枢，桌面是原生控制面。蓬莱运行层统一桌面、飞书、微信、终端、语音、图片、文件、主动消息和长期记忆。

0.3.0 把蓬莱从“能接进聊天软件”推进到“可安装、可运行、可升级、可审计的个人 AI 管家发行版”。0.3.1 的使命是把 0.3.0“方向正确但实现半成品”的核心架构真正落地闭环：让 `penglai` CLI 成为发行版的权威核心，让桌面回归“薄壳 + CLI 控制面”的本质，让 owner 从任何入口发消息走同一个 GA 会话。你可以下载 Mac / Windows 桌面客户端，也可以用一行命令部署到自己的主机。你的记忆、日志、配置和渠道凭证默认都留在你自己的机器上。

语音能力也已从“能听”补齐到“能说”：FunASR / SenseVoice 路线在本地把语音转成文字、识别情绪和声学事件；MOSS-TTS-Nano 把文字回复本地合成为语音。两边都可以 CPU 本地运行，语音数据默认不出本机。

<p align="center">
  <img src=".github/assets/wizard-zh.png" alt="蓬莱 0.3.1 桌面安装向导" width="88%"/>
</p>

## 30 秒开始

**推荐使用桌面客户端**：在 [GitHub Releases](https://github.com/kevinchennewbee/PenglaiAgent/releases) 下载对应版本的 Mac / Windows 安装包，双击安装即可用图形向导完成全部配置：

- macOS Apple Silicon DMG
- Windows x64 installer

命令行安装（适合无头服务器或偏好终端的用户）：

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

国内网络：

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

常用命令：

```bash
penglai                         # 终端里直接聊天
penglai setup                   # 配置向导（全量）
penglai setup --only feishu     # 局部补配：只重配飞书，不触碰已配置的 LLM
penglai setup --only llm|identity|feishu|wechat|channels|abilities|companion
penglai config status --json    # 配置概览（--json 供桌面调用）
penglai config backup           # 原子备份当前配置
penglai config restore <backup> # 回滚到备份
penglai channels [--json]       # 渠道矩阵 + 下一步命令
penglai companion status        # 主动陪伴状态 / 模式 / 最近触发原因
penglai companion mode quiet|present|active   # 切换陪伴模式
penglai doctor                  # 体检：环境/依赖/配置/服务/旧版本残留进程 + 下一步命令
penglai abilities               # 语音/TTS/陪伴/搜索/批判脑能力总览
penglai enable voice|tts|companion|intel|critic
penglai update                  # 检查并安全升级
penglai privacy-audit --strict  # 发布前隐私检查
```

无头服务器也能完成飞书 / 微信扫码配置：`penglai setup --only feishu` 在终端直接输出 ASCII 二维码，不必打开桌面。`setup` 完成后会自动跑一次最小 LLM 请求做端到端冒烟验证（`--skip-smoke-test` 可跳过）。

**Docker 已撤出支持矩阵**：0.3.0 起不再提供 Dockerfile、docker-compose、docker-install、GHCR 镜像或容器部署支持。请使用桌面安装包、`install.sh`、PyPI 引导器或源码安装。

## 自动升级

0.3.1 把自动升级跑通成一条完整链路，桌面应用和运行时两层各自独立升级：

- **桌面应用**：基于 `tauri-plugin-updater`，六道关卡全部打通——签名密钥在 CI 中生成并校验，`latest.json` 由 CI 自动发布到 Release，前端 `app.js` 调用 updater API 完成检查、下载、校验、安装；`fallback.html` 配置界面也接入了升级入口，即使主窗口卡住也能从配置界面检查更新。
- **运行时（CLI / Runtime Hub）**：执行 `penglai update` 会先备份当前版本，拉取新版本，校验后切换，失败自动回滚。

桌面应用升级走 updater，运行时升级走 `penglai update`，两条路径互不依赖。

## 为什么做蓬莱

我做了十年网络技术、网络安全和运维，但不会写代码。蓬莱里的代码，是我用 AI 编程工具一句一句说出来的。

我做它，是因为我相信 AI Agent 不应该只属于会写代码、会用终端、愿意折腾配置文件的人。CLI 很强，桌面应用也很好，但普通人每天真正打开最多的入口，是聊天软件。**会发微信，就应该会用 Agent。**

蓬莱这个名字来自中国神话里的海上仙山。对古人来说，蓬莱可望而不可即；对今天很多普通人来说，AI 也常常被 API、终端、英文文档和复杂配置挡在雾里。蓬莱想做那艘船，把能干活的 Agent 带到你已经生活和工作的地方。

## Penglai Runtime Hub

0.3.0 的核心是 Runtime Hub。它把桌面、飞书、微信、终端、语音、文件和主动消息统一成同一套事件、队列、权限和运行记录，再交给 GenericAgent 执行。

```mermaid
flowchart LR
  U["用户<br/>桌面 / 飞书 / 微信 / 终端 / 语音 / 图片"] --> A["Adapters<br/>渠道封装与输入规范化"]
  A --> H["Penglai Runtime Hub<br/>队列 · TaskRun · 权限 · 上下文事件"]
  H --> G["GenericAgent Core<br/>LLM 推理 · 工具调用 · 文件产物"]
  H --> M["Memory & Skills<br/>L1 索引 · L2 事实 · SOP 技能"]
  H --> V["Voice Stack<br/>SenseVoice · MOSS-TTS-Nano"]
  H --> S["Safety Layer<br/>红线 · memguard · fileguard · 日志脱敏"]
  G --> O["回复 / 文件 / 语音 / 主动提醒"]
  M --> H
  V --> H
  S --> H
  O --> U
```

用户能直接感受到的变化：

- **消息不容易丢**：任务运行中，后续消息进入队列。
- **上下文更连贯**：桌面、IM、终端、主动陪伴进入同一套上下文事件。
- **文件外发更可靠**：图片、视频、PDF、Markdown、Office 文档按真实产物类型发送；敏感后缀确定性拦截。
- **日志更安全**：API Key、token、secret、authorization 等统一脱敏后再进入日志和历史。
- **状态更可诊断**：Runtime Hub、飞书、微信、调度器、主动陪伴分开报告，不再只有“好像在跑”。
- **发布更可审计**：`privacy-audit`、`runtime-audit`、`install-check`、`doctor` 都能独立验证。

## 0.3.1 主要变化

0.3.0 建立了正确的架构方向；0.3.1 把“方向正确但实现半成品”的核心架构真正落地闭环。

| 领域 | 0.3.1 带来的变化 |
|---|---|
| CLI 核心 | `setup --only` 局部补配（重配飞书不再走 API Key 全流程）；`config backup/restore` 原子配置管理；`channels` / `companion` 子命令；CLI 二维码输出；setup 端到端 smoke test |
| 桌面控制面 | 修复 `_require_token` 让 9 个 handler 正常工作；消除 9 个内联 Python op（bridge `--bootstrap` 模式，Rust 壳回归薄壳）；接 `tauri-plugin-updater` 自动更新；前端 9 模块重构（Chat / Runs / Channels / Abilities / Companion / Diagnostics / Logs / Update / Security）；Mac 毛玻璃 + Windows Mica 双平台适配 |
| Runtime Hub | TaskRun 状态机闭合（`WAITING_PERMISSION → RUNNING → SUCCEEDED`）；崩溃恢复（重启时把僵尸 TaskRun 标记 failed）；SQLite TOCTOU 修复（`BEGIN IMMEDIATE`）；owner 消息走 control API，多入口共享同一个 GA 会话 |
| 出站投递 | 飞书 / 钉钉 / QQ / 企业微信统一走 DeliveryService 安全策略，文件外发 blocked notice 全渠道一致 |
| 主动陪伴 | off / quiet / present / active 四档模式差异化；active 不再“必须说”，连续 SILENT 自动升级冷却；companion 事件在下一轮 prompt 可见（context 闭环） |
| 诊断 | `doctor` 输出“问题 + 下一步命令”格式；检测旧版本残留进程；setup 完成后自动冒烟验证 |
| 上游 GA sync | extra_sys_prompts 通用 prompt slot；turn-25 写文件 checkpoint；reasoning 字段兼容 |
| 桌面安全初始化 | 修复 `install_runtime` 后 bridge 未拉起导致“点击无反应”；修复 Windows IME 中文输入崩溃；`setup_op` 重试机制；`finalizeSetup` 校验 |
| 自动升级 | `tauri-plugin-updater` 六道关卡全通（签名密钥 + CI 生成 `latest.json` + 前端调用）；`fallback.html` 配置界面也能检查更新；`app.js` 两层升级 UI（桌面应用 + 运行时） |
| CLI 集成修复 | `_try_penglai_setup_only` TTY 检查回落；`os.chmod` 跨平台；`pgrep` → `wmic` 跨平台 |
| 版本号动态化 | 全仓库从硬编码 0.3.0 改为动态引用 `VERSION` 常量 |
| Mac 打包修复 | `icon.icns` 加入配置；adhoc 重签名后重新生成 `.tar.gz` + `.sig` |

> GitHub issue #2（重配飞书被拉回 API Key 全流程）在 0.3.1 用 `penglai setup --only feishu` 和桌面双路径修复。

## 0.3.0 主要优势

| 能力 | 0.3.0 带来的变化 |
|---|---|
| 原生桌面客户端 | Mac / Windows 桌面安装包，图形化设置向导，多会话工作台，系统托盘，渠道和能力管理 |
| Runtime Hub | 多入口统一为 `InboundEvent`、FIFO 队列、`TaskRun` 审计和运行历史 |
| MOSS-TTS-Nano | 新增本地 TTS，把文字回复合成为语音，适合桌面朗读和 IM 语音条；CPU 本地推理，音频不必出本机 |
| SenseVoice / FunASR 路线 | 本地语音转写、情绪标签和声学事件，作为可选本地能力启用 |
| IM 渠道 | 飞书重点验证；微信、钉钉、QQ、企业微信、Telegram、Discord 逐步真机验证 |
| 主动陪伴 | 天气、情绪、早晚锚点、久未联系提醒，带勿扰和频率门禁 |
| 安全审计 | 命令红线、路径红线、记忆写入、文件外发、日志脱敏和发布前隐私审计 |
| 更新机制 | `penglai update` 支持检查、备份、应用和失败回滚 |

## 技术栈与站在谁的肩膀上

蓬莱不是从零发明所有东西，它把优秀的开源项目和生态能力组装成一个普通人可用的发行版。

| 层 | 项目 / 技术 | 作用 |
|---|---|---|
| Agent Core | [GenericAgent](https://github.com/lsdefine/GenericAgent) | 执行核心：上下文、LLM 推理、工具调用、文件产物 |
| Runtime | Penglai Runtime Hub | 队列、TaskRun、权限、运行历史、上下文事件 |
| Desktop | Tauri 2.0 + Web UI | Mac / Windows 原生薄壳 + Python bridge；0.3.1 起 9 模块控制面（Chat / Runs / Channels / Abilities / Companion / Diagnostics / Logs / Update / Security），Rust 层无内联 Python，配置逻辑下沉到 CLI |
| Speech-to-text | SenseVoice / FunASR 路线 | 本地语音转写、情绪与声学事件 |
| Text-to-speech | MOSS-TTS-Nano | 本地语音合成，CPU 可跑 |
| IM | Feishu / WeChat / more adapters | 把 Agent 接进真实聊天入口 |
| Safety | redline / memguard / fileguard / log redaction | 确定性安全边界 |
| Memory | 文件式 L1 / L2 / SOP / raw sessions | 可审计、可迁移、可清理的长期记忆 |

## 渠道与能力状态

| 入口 | 接入方式 | 当前状态 |
|---|---|---|
| 桌面 | macOS / Windows 原生客户端 | 0.3.1 控制面（薄壳 + 9 模块） |
| 飞书 | 向导扫码建应用，长连接接入 | 重点验证 |
| 微信个人号 | 向导扫码登录 | wrapper 接入中枢，需本机绑定后启用 |
| 终端 TUI | 运行 `penglai` | 可用 |
| 钉钉 / QQ / 企业微信 | `penglai enable <channel>` | 封装就绪，逐步真机验证 |
| Telegram / Discord | 贴 token 接入 | 封装就绪，逐步真机验证 |

| 能力 | 说明 | 状态 |
|---|---|---|
| 语音转写 | SenseVoice / FunASR 路线，本地转写和情绪标签 | 可选启用 |
| 语音合成 | MOSS-TTS-Nano 本地 TTS，CPU 推理 | 0.3.0 新增 |
| 图片理解 | IM 图片进入视觉任务 | 取决于配置的视觉模型 |
| 长期记忆 | 文件式记忆，写入前安全扫描 | 默认能力 |
| 搜索 | 免费搜索兜底，多源搜索可选 | 默认可用 |
| 主动陪伴 | 天气、情绪、提醒和 check-in；0.3.1 起 off / quiet / present / active 四档模式 + context 闭环 | opt-in |
| 批判脑 | 本地绊线 + 可选异厂商复核 | 可选增强 |
| 技能集市 | 本地 SOP 技能，安装时安全扫描 | 按需安装 |

## 安全和隐私边界

- 公开仓库不包含个人记忆、日志、运行历史、token 或私有配置。
- API Key、聊天记录、长期记忆、渠道凭证和本地语音处理数据默认留在你自己的机器上。
- 日志、上下文事件和运行历史在写入前会做脱敏。
- `memory/global_mem.txt`、`memory/global_mem_insight.txt`、`temp/`、`_internal/` 等本地运行态默认不入库。
- 安全护栏是降低风险，不是绝对安全保证；建议部署在你自己控制的机器上。
- 漏洞反馈请先脱敏，详见 [SECURITY.md](SECURITY.md)。

## Penglai 和 GenericAgent 的关系

[GenericAgent](https://github.com/lsdefine/GenericAgent) 是蓬莱的执行核心。蓬莱不替代 GenericAgent，也不把上游内核改成自己的私货。蓬莱做的是普通用户真正用起来还缺的那一层：安装、桌面、渠道、语音、记忆卫生、安全审计、长期运行和升级。

| 维度 | GenericAgent | Penglai |
|---|---|---|
| 定位 | Agent 执行核心 | 个人 AI 管家发行版 |
| 安装 | 需要理解依赖和配置 | 一键安装 + 桌面向导 |
| 入口 | 终端 / 上游前端 | 桌面、飞书、微信、终端、更多 IM |
| 运行层 | 核心循环 | Runtime Hub：队列、审计、上下文、权限 |
| 语音 / 图片 | 自行接入 | SenseVoice、MOSS-TTS-Nano、图片入口规则 |
| 安全 | 基础能力 | 命令、路径、日志、文件外发、记忆写入的确定性护栏 |
| 运维 | 手动为主 | doctor / status / logs / update / audit |

## 版本

**v0.3.1 · 2026-06-26**

核心架构闭环。`penglai` CLI 成为发行版权威核心（`setup --only` 局部补配 / `config` 配置管理 / `channels` / `companion` 子命令）；桌面回归薄壳 + 9 模块控制面（修复 `_require_token`、消除内联 Python op、接 `tauri-plugin-updater`）；桌面安全初始化强健化（修复 `install_runtime` 后 bridge 未拉起导致“点击无反应”、Windows IME 中文输入崩溃、`setup_op` 重试 + `finalizeSetup` 校验）；自动升级完整实现（`tauri-plugin-updater` 六道关卡全通、`fallback.html` 也能升级、`app.js` 两层升级 UI）；CLI 集成修复（TTY 检查回落、`os.chmod` 与 `pgrep` → `wmic` 跨平台）；版本号动态化（硬编码 0.3.0 改为 `VERSION` 常量）；Mac 打包修复（`icon.icns` + adhoc 重签名后重生成 `.tar.gz` / `.sig`）；Runtime Hub 稳态化（TaskRun FSM 闭合、崩溃恢复、SQLite TOCTOU 修复、owner 多入口共享 GA 会话）；飞书 / 钉钉 / QQ / 企微出站统一走 DeliveryService；陪伴四档模式差异化 + context 闭环；`doctor` 给行动建议 + 旧版本残留进程检测 + setup smoke test。

**v0.3.0 · 2026-06-25**

Runtime Hub 正式版。Mac / Windows 原生桌面客户端、飞书 QR 扫码自动创建、MOSS-TTS-Nano 本地语音合成、`penglai update` 自动备份回滚升级、Docker 全面撤出支持矩阵。

完整时间线见 [官网更新日志](https://kevinchennewbee.github.io/PenglaiAgent/#changelog)。

## 许可、品牌与致谢

- 代码使用 [MIT](LICENSE) 许可。
- 上游 GenericAgent 的版权声明完整保留。
- “蓬莱 / Penglai”名称、logo、横幅等品牌视觉资产保留所有权利，不在代码许可范围内。
- 第三方素材和高权限工具边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

感谢 [GenericAgent](https://github.com/lsdefine/GenericAgent)、MOSS-TTS-Nano、SenseVoice、Tauri、Feishu / Lark SDK 生态，以及所有让 AI 工具变得更普通、更可用、更安全的开源项目。
