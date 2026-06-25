<div align="center">

<img src=".github/assets/banner.png" alt="蓬莱 Penglai" width="100%"/>

# 蓬莱 · Penglai

### 住在飞书、微信、终端和桌面里的自托管 AI 管家

**八仙过海，各显神通**

[![License](https://img.shields.io/badge/code-MIT-22c55e?style=flat-square)](LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Channels](https://img.shields.io/badge/%E6%B8%A0%E9%81%93-%E9%A3%9E%E4%B9%A6%20%C2%B7%20%E5%BE%AE%E4%BF%A1%20%C2%B7%20%E7%BB%88%E7%AB%AF-07C160?style=flat-square&logo=wechat&logoColor=white)](#)
[![Kernel](https://img.shields.io/badge/powered%20by-GenericAgent-8b5cf6?style=flat-square)](https://github.com/lsdefine/GenericAgent)
[![Website](https://img.shields.io/badge/%F0%9F%8C%90-%E5%AE%98%E7%BD%91-3fbaa6?style=flat-square)](https://kevinchennewbee.github.io/PenglaiAgent/)

**中文** · [English](README_EN.md) · [官网](https://kevinchennewbee.github.io/PenglaiAgent/)

</div>

> **官方渠道**：本 GitHub 仓库 · [kevinchennewbee.github.io/PenglaiAgent](https://kevinchennewbee.github.io/PenglaiAgent/) · PyPI [`penglai`](https://pypi.org/project/penglai)。不要在非官方渠道输入 API Key、机器人 token 或任何账号凭证。

---

**蓬莱**是一个跑在你自己机器上的 AI 管家。它接入飞书、微信、终端，也有 Mac 和 Windows 原生桌面客户端，能听语音、看图片、记事情、查资料、写代码、跑任务，也能在确定性安全规则内主动提醒你。

你只需要一台云服务器或家里的 Mac mini / Linux 主机，一个 LLM API Key，十分钟向导走完，就有一个属于自己的长期 AI 管家。也可以直接下载桌面安装包，双击安装、图形化配置、开箱即用。记忆、配置、日志和渠道凭证都留在你自己的机器上。

## 缘起

我做了十年网络技术、网络安全与运维，但不会写代码。这个项目里的每一行代码，都是我用 AI 编程工具一句话一句话说出来的。

我做蓬莱，是因为我相信 AI Agent 不应该只属于会写代码、会用终端、愿意折腾配置文件的人。CLI 很强，桌面应用也很好，但普通人每天真正打开最多的入口，是聊天软件。会发微信，就应该会用 Agent。

所以蓬莱不是另一个聊天机器人玩具。它想把一个真正能干活的 Agent 放进你已经在用的飞书和微信里，让它在通勤、午休、出门、睡前都能被叫到，也能在你允许的范围内主动关心重要的事。

名字来自中国神话里的海上仙山。对古人来说，蓬莱是可望而不可即的神奇之地；对今天很多普通人来说，AI 也常常被 API、终端、配置和英文文档隔在雾里。蓬莱想做的，就是把这座岛搬进你的聊天窗口。

## 现在能做什么

- **飞书和微信扫码接入**：飞书长连接，不需要公网 IP；个人微信扫码登录；终端 TUI 直接可聊。0.3.0 preview 已重点验证飞书，微信需本机绑定后启用。
- **统一对话体验**：飞书、微信、终端共享同一个管家、同一套记忆、同一条任务执行链。
- **语音情绪识别**：本地 SenseVoice 转写语音，并识别高兴、低落、生气、害怕等情绪信号；这是可选本地能力，依赖模型和转写引擎就绪。
- **语音合成输出**：本地 MOSS-TTS-Nano 把文字回复合成为语音，适合桌面朗读和 IM 语音条。
- **图片理解入口**：IM 收到图片后按图像任务处理，不再靠文件名、EXIF 或 OCR 猜答案。
- **四层文件式记忆**：索引、事实、技能、原始会话分层保存，Markdown 可审计。
- **确定性安全护栏**：危险命令、敏感路径、记忆写入、文件外发、日志泄露都走规则拦截，不依赖模型自觉。
- **网页搜索开箱即用**：无头服务器也能查天气、新闻和事实；需要多源验证时再开启增强搜索。
- **主动陪伴**：天气预警、语音情绪承接、早晚问候、久未联系提醒，默认有勿扰和频率门禁；这是 opt-in 长驻服务，需显式开启。
- **本地技能集市**：提醒、邮件、快递、公众号文章、文档处理、市场调研等技能按需安装。
- **一键安装和无头服务**：新机器、国内网络、云服务器长期后台运行都有完整路径。
- **自诊断和升级**：`penglai doctor`、`penglai status`、`penglai update` 负责体检、服务状态和安全升级。

## 这次全新架构优化了什么

蓬莱的新架构把“多个入口接同一个 Agent”这件事系统化了。以前每个渠道更像单独包装；现在飞书、微信、终端、语音、文件、主动消息都先进入统一运行层，再交给 GenericAgent 执行核心。

用户能直接感受到的变化：

- **消息不容易丢**：同一个用户的忙时消息会排队，任务结束后继续处理。
- **上下文更连贯**：主动陪伴、IM 回复、终端对话进入同一套上下文事件，后续对话不突兀。
- **文件外发更可靠**：图片、视频、PDF、Markdown、Office 文档按真实文件类型发送；敏感后缀仍确定性拦截。
- **日志更安全**：API Key、token、secret、authorization 等会统一脱敏后再进入日志或历史。
- **服务状态更清楚**：飞书、微信、调度器、主动陪伴和中枢控制服务分别报告，不再混成一个“好像在跑”。
- **中枢可审计**：Runtime Hub 记录标准 `TaskRun`，队列、权限、取消、失败和运行历史都能被 doctor/selfcheck/audit 检查。
- **版本身份可信**：CLI、doctor、IM `/version` 都能报告当前版本、来源、分支/commit 和构建信息。

这不是换一个包装名，而是把蓬莱从“能接进聊天软件”推进到“多入口、可运维、可审计的个人 Agent 运行层”。

## 快速开始

新机器只要联网，一行安装：

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

国内网络：

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

手动安装：

```bash
git clone https://github.com/kevinchennewbee/PenglaiAgent.git
cd PenglaiAgent
python3 penglai setup
```

常用命令：

```bash
penglai                         # 终端里直接聊天
penglai setup                   # 重新进入配置向导
penglai doctor                  # 环境/依赖/配置/LLM/服务体检
penglai status                  # 飞书/微信/调度器/主动陪伴状态
penglai logs                    # 查看最近日志
penglai channels                # 渠道矩阵
penglai abilities               # 语音/陪伴/搜索/批判脑能力总览
penglai enable voice|companion|intel|critic
penglai skill list              # 本地技能集市
penglai migrate                 # 从 Hermes/OpenClaw 迁移
penglai version                 # 当前版本、安装来源、构建信息
penglai update                  # 安全升级
```

## 渠道和能力

| 入口 | 接入方式 | 当前状态 |
|---|---|---|
| 飞书 | 向导扫码建应用，长连接接入 | 已实测 |
| 微信个人号 | 向导扫码登录 | wrapper 已接入中枢，需本机绑定后启用 |
| 终端 TUI | 运行 `penglai` | 已实测 |
| 钉钉 / QQ / 企业微信 | `penglai enable <channel>` | 封装已就绪，逐步真机验证 |
| Telegram / Discord | 贴 token 接入 | 封装已就绪，逐步真机验证 |

| 能力 | 说明 | 0.3.0 preview 状态 |
|---|---|---|
| 语音 | 本地转写、情绪识别、微信 silk 解码 | 可选能力；腾讯云已验证 SenseVoice ready，未装齐时 doctor/install-check 仍如实报告 |
| 图像 | IM 图片进入视觉任务，不用文件名猜图 | 入口规则已收敛，实际效果取决于配置的视觉模型 |
| 记忆 | 文件式长期记忆，写入前安全扫描 | 内核标配；记忆卫生和运行噪声拦截已纳入中枢检查 |
| 搜索 | 免费 Bing 兜底，多源搜索可选 | 默认可用；TinyFish/Tavily/Firecrawl 属于 opt-in 增强 |
| 主动陪伴 | 天气、情绪、早晚锚点、久未联系提醒 | opt-in 长驻服务；门禁逻辑已测试，腾讯云已验证 systemd active 与心跳门禁 |
| 批判脑 | 本地绊线 + 可选异厂商复核记忆写入 | 本地绊线常开；异厂商复核需 `penglai enable critic` 配第二模型 |
| 技能 | 本地 SOP 技能集市，安装时安全扫描 | 按需安装，非 0.3.0 中枢完成门槛 |
| 安全 | 命令红线、路径红线、文件外发白名单、日志脱敏 | 出厂常开，作为确定性防线参与检查 |

## 蓬莱和 GenericAgent 有什么不同

[GenericAgent](https://github.com/lsdefine/GenericAgent) 是蓬莱的执行核心。它提供简洁的 Agent 循环：上下文进来，大模型思考，工具执行，结果回流。

蓬莱不替代 GenericAgent，也不把上游内核改成自己的私货。蓬莱做的是普通用户真正用起来还缺的那一层：

| 维度 | GenericAgent | 蓬莱 |
|---|---|---|
| 定位 | Agent 执行核心 | 面向个人用户的完整 AI 管家发行版 |
| 安装 | 需要理解依赖和配置 | 一键安装 + 翻页式向导 |
| 入口 | 终端/上游前端 | 飞书、微信、终端、更多 IM 封装 |
| 语音/图片 | 需要自行接能力 | 发行层接入语音、情绪和图片规则 |
| 记忆 | 核心记忆机制 | 加入记忆卫生、迁移、技能索引和审计边界 |
| 安全 | 基础能力 | 命令、路径、日志、文件外发、记忆写入的确定性护栏 |
| 运维 | 手动为主 | doctor/status/logs/update/version |

可以把它理解成：GenericAgent 是内核，蓬莱是把内核变成一个普通人能安装、能接入、能长期运行、能升级、能审计的个人产品。

## 安全和隐私边界

- 你的 API Key、聊天记录、记忆、渠道凭证默认都在你自己的机器上。
- 公开发行版不包含个人记忆、日志、运行历史、token 或私有配置。
- 所有安全护栏都是降低风险，不是绝对安全保证；建议部署在你自己控制的服务器上。
- 不要在非官方安装源、非官方网页或陌生机器人里输入凭证。
- 漏洞反馈请先脱敏，详见 [SECURITY.md](SECURITY.md)。

## 最新版本

**2026-06-25 · v0.3.0**

0.3.0 正式发布 Runtime Hub 统一运行层，把所有入口（飞书、微信、终端、桌面）归一为统一的事件和执行模型。同步推出 Mac（Apple Silicon）和 Windows（x64）原生桌面客户端：完整的图形化设置向导、多会话对话工作台、系统托盘驻留、渠道/能力管理面板、一键更新和融合诊断，与命令行安装功能完全对等。

**桌面客户端下载**：[GitHub Releases](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.3.0)

| 平台 | 下载 | 说明 |
|------|------|------|
| macOS (Apple Silicon) | `Penglai_0.3.0_macos_aarch64.dmg` | 下载后拖入 Applications，首次打开到系统设置 → 隐私与安全性 → 仍要打开 |
| Windows (x64) | `Penglai_0.3.0_windows_x64_setup.exe` | 下载安装，SmartScreen → 更多信息 → 仍要运行 |

**命令行安装**（Linux / macOS / Windows）：
```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

**Docker 已撤出支持矩阵**：0.3.0 起不再提供 Dockerfile、docker-compose、docker-install、GHCR 镜像或容器部署支持。请使用桌面安装包、命令行安装脚本、PyPI 引导器或源码安装。

0.3.0 不等于所有可选能力都默认开启：语音、TTS、主动陪伴、批判脑异厂商复核、情报矩阵增强、各个 IM 渠道均按 `penglai abilities` / `penglai channels` 状态逐项启用、诊断和验证。

近期更新重点：

- **v0.3.0**：Runtime Hub 正式版。Mac/Windows 原生桌面客户端（完整设置向导 + 会话工作台 + 系统托盘 + 渠道/能力管理面板 + 补配置 + 融合诊断）。feishu QR 扫码自动创建、MOSS-TTS-Nano 本地语音合成、`penglai update` 自动备份回滚升级；Docker 全面撤出支持矩阵。
- v0.2.27：安装网络兜底热修，国内网络下会更稳地回退到镜像源或本地源码构建。
- v0.2.25：安装依赖网络热修，一键安装在默认 PyPI 长时间无响应时，会自动超时并切换到清华镜像重试。
- v0.2.24：GA 核心边界修正，LLM 日志脱敏从 GenericAgent 核心文件移到蓬莱插件层，恢复“上游核心不改”的发行边界。
- v0.2.23：非交互安装边界热修，安装输出被重定向到日志、CI 或远程自动化时，不再误入配置向导。
- v0.2.22：安装幂等热修，一键安装在首次下载 Python/依赖被中断后可直接重跑。
- v0.2.21：安装网络热修，一键安装和 PyPI 引导器在 GitHub 首页或默认镜像不可用时，会自动回退到源码压缩包。
- v0.2.20：全新架构版本，统一多入口运行层，优化消息排队、上下文事件、文件投递、日志脱敏、服务状态和版本身份。
- v0.2.10：修复飞书真实工作流、按钮交互、忙时排队、文件外发。
- v0.2.9：隐私合规、公开素材许可、安全文档。
- v0.2.8：飞书人工介入按钮、macOS launchd、微信包装命令、更新网络兜底。
- v0.2.7：macOS 真机守护、图像入口修复、密钥防泄、语音错误提示。
- v0.2.5：首批本地技能集市。
- v0.2.0：网页搜索、主动陪伴。

完整时间线见 [官网更新日志](https://kevinchennewbee.github.io/PenglaiAgent/#changelog)。

## 许可与品牌

- 代码使用 [MIT](LICENSE) 许可。
- 上游 GenericAgent 的版权声明完整保留。
- “蓬莱 / Penglai”名称、logo、横幅等品牌视觉资产保留所有权利，不在代码许可范围内。
- 第三方素材和高权限工具边界见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 致谢

蓬莱站在 [GenericAgent](https://github.com/lsdefine/GenericAgent) 的肩膀上，也站在所有愿意把 AI 工具变得更普通、更可用、更安全的人肩膀上。
