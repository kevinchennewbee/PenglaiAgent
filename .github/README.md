<div align="center">

<img src="assets/banner.png" alt="蓬莱 Penglai" width="100%"/>

# 蓬莱 · Penglai

### 住在你飞书和微信里的中文 AI 管家

**八仙过海，各显神通**

[![License](https://img.shields.io/badge/code-MIT-22c55e?style=flat-square)](../LICENSE)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=flat-square&logo=python&logoColor=white)](https://www.python.org/)
[![Channels](https://img.shields.io/badge/%E6%B8%A0%E9%81%93-%E9%A3%9E%E4%B9%A6%20%C2%B7%20%E5%BE%AE%E4%BF%A1-07C160?style=flat-square&logo=wechat&logoColor=white)](#)
[![Voice](https://img.shields.io/badge/%E8%AF%AD%E9%9F%B3-%E6%83%85%E7%BB%AA%E6%84%9F%E7%9F%A5-f59e0b?style=flat-square)](#)
[![Kernel](https://img.shields.io/badge/powered%20by-GenericAgent-8b5cf6?style=flat-square)](https://github.com/lsdefine/GenericAgent)

**中文** · [English](README_EN.md)

</div>

---

**蓬莱**是一个跑在你自己服务器上的个人 AI 管家：扫码接入你的微信，三分钟接入飞书，
听得出你语音里的情绪，记得住你说过的话，干得了查资料、写代码、跑任务的活——
而且**记忆只属于你**，安全靠确定性红线而不是模型自觉。

一台 $5/月 的云服务器、一个 LLM API Key，十分钟向导走完，你就有了自己的管家。

## 🌊 缘起：一个不会写代码的人，和他的 AI 管家

我做了十年网络技术、网络安全与网络运维，但**不会写代码——一行都不会**。这个仓库里的每一行代码，
都是我用 AI 编程工具一句话一句话"说"出来的。蓬莱本身就是它想证明的那件事：
**AI 时代，普通人也能为自己造工具。**

初心来自真实的痛。作为一个想认真拥抱这场变革的普通用户，我把市面上摸得到的工具
几乎用了个遍，也实打实撞过它们的墙。我见证了 CLI 时代的锋利——Claude Code、
OpenCode、Kimi CLI 个个出色；也看到了桌面时代的完善与流行——Codex 桌面版、Qoder、
WorkBuddy、Claude Cowork 把 Agent 做进了窗口里。它们都很好，但它们都默认同一件事：
**你得坐在电脑前。**

我总想起电脑的来路：DOS 把计算交给会敲命令的人，Windows 的图形界面把它交给会用
鼠标的人，而移动互联网把它装进了每个人的口袋。Agent 正在走同一条路——
**CLI 是它的 DOS，桌面应用是它的 Windows，下一站一定在移动端、在碎片时间里。**
各家的移动 App 会各有精彩，但对普通大众而言，最方便、最简单、每天真实会打开的，
是聊天软件。**会发微信，就该会用 Agent**——不需要再学任何新东西。

[GenericAgent](https://github.com/lsdefine/GenericAgent) 是我见过最干净的 Agent 内核，
所以蓬莱不重造轮子，核心完全站在它的肩膀上。蓬莱要补的是"最后一公里"：
让它跑在你拥有的任何一台机器上——无头云服务器、角落里 24 小时待机的 Mac mini，
Windows 也在路上——然后住进你的飞书和微信，在通勤的地铁上、午休的间隙里，
随叫随到，一直都在。

## ✨ 它能做什么

- 🏮 **十分钟开箱** —— `penglai setup` 一个向导：自装依赖（国内自动切清华镜像）→ 选模型测连通 → **飞书扫码自动建应用**（免开网页，手动凭证兜底）→ 给管家起名 → 微信扫码即用
- 💬 **飞书 + 微信双渠道，都是扫码** —— 飞书扫码建机器人、长连接免公网 IP；个人微信扫码登录，文字/语音/图片收发
- 🎙️ **听得出情绪的耳朵** —— 本地 CPU 跑 SenseVoice（约 230MB）：语音转写 + 情绪标签 + 声学事件，`[语音(情绪:低落): 今天好累]` 这样进入对话
- 🧠 **四层记忆** —— 索引/事实/技能/原始会话四层文件式记忆，纯 markdown 可审计；写入前威胁扫描（提示注入/角色劫持/密钥落库），禁止覆盖
- 🛡️ **确定性安全** —— 危险命令与路径红线拦截 + 全量工具调用审计 JSONL——**安全靠确定性检查，不靠 LLM 自觉**
- 🧐 **防幻觉双保险** —— 过度自信绊线命中时调**另一厂商**模型复核（单模型查不出自己的幻觉）；求证型任务可开多源搜索交叉验证
- 🌙 **真主动，不扰民** <sub>opt-in</sub> —— 心跳 + 硬编码门禁：勿扰时段、对话中绝不插话、频率上限——像朋友想起你，而不是闹钟响了
- ⚙️ **运维一个命令** —— `penglai doctor` 13 项体检 / `status` / `logs` / `update` 一键升级内核

> 以上每一条都在真实服务器上每天跑着，不是路线图。

## 🚀 快速开始

新机器只要联网，**一行命令**——没有 Python、没有 git 都不要紧，脚本全自动备好：

```bash
curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

国内网络（走镜像，同样一行）：

```bash
curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
```

喜欢自己动手的，传统三段式同样可用：

```bash
git clone https://github.com/kevinchennewbee/PenglaiAgent.git
cd PenglaiAgent
python3 penglai setup    # 向导：依赖 → 模型 → 飞书 →（可选）微信扫码
```

日常运维：

```bash
penglai doctor     # 体检：环境/依赖/配置/LLM/记忆/服务/上游
penglai status     # 服务状态（飞书/调度器/陪伴/微信）
penglai logs       # 最近日志
penglai update     # 一键同步上游内核
```

> 🇨🇳 国内服务器友好：依赖走清华 PyPI 镜像，模型与代码走 gh-proxy，向导自动处理，无需手动配置。

## 🧬 架构：站在内核肩膀上

蓬莱构建于 [GenericAgent](https://github.com/lsdefine/GenericAgent)（GA）内核之上——一个被验证过的
~130 行 Agent 循环：`上下文 → LLM → 工具 → 结果回流`。蓬莱与 GA 的关系，如同 Ubuntu 之于 Linux 内核：

- **内核零改动**：蓬莱层全部是新增文件（当前 +1295/−0），GA 的升级一条命令合并，结构上不可能冲突；
- **形态梯度**：新能力优先用 SOP（0 行代码）实现，其次 hook 插件，再次心跳模块，最后才是工具——克制是设计，不是懒；
- **身份与记忆分离**：出厂态零用户记忆，只带一行身份。你的记忆是你的隐私资产，永不进发行版。

| 蓬莱层 | 形态 | 干什么 |
|---|---|---|
| `penglai` CLI + 向导 | 入口 | 安装、体检、服务管理、一键升级 |
| 微信渠道服务 | systemd | 扫码登录、token 过期智能提示（不盲目重启） |
| 语音情绪 | 工具 | SenseVoice 本地转写 + 情绪 + 声学事件，微信 silk 自动解码 |
| 红线 + 审计 | hook | 确定性拦截危险操作，全量审计留痕 |
| 记忆卫生 | hook | 写记忆威胁扫描 + 禁覆盖 |
| 批判脑 | hook | 跨厂商二次复核，专治幻觉 |
| 情报矩阵 <sub>opt-in</sub> | 插件 | 多源搜索交叉验证 |
| 主动陪伴 <sub>opt-in</sub> | 心跳 | 门禁内的真主动 |
| 蓬莱 SOP 包 | markdown | 符号化断点、可追溯压缩、生成技能——0 行代码 |

## 📜 许可与品牌

- **代码**：[MIT](../LICENSE) 许可。上游 GenericAgent 的版权声明完整保留；蓬莱层代码 © 2026 Kevin Chen，同样以 MIT 发布——随便用、随便改、随便商用。
- **品牌**：「蓬莱」「Penglai」名称、logo 与横幅视觉资产**保留所有权利**，不在代码许可范围内。未经书面许可，请勿将其用于你的分发版本、衍生产品或商业宣传的命名与标识。
  （开源圈通行做法：代码自由，品牌保留——Rust、Docker 皆如此。）

## 🙏 致谢

蓬莱站在这些项目的肩膀上：

- [GenericAgent](https://github.com/lsdefine/GenericAgent)（MIT）——内核本身：极简 Agent 循环、L1-L4 记忆、自进化技能树
- [Hermes Agent](https://github.com/NousResearch/hermes-agent)（MIT）——doctor 与安装体验、渠道质量标准、记忆卫生的理念
- [PilotDeck](https://github.com/OpenBMB/PilotDeck)（AGPL，仅借鉴设计理念）——门禁系统与可回滚纪律
- [SenseVoice / FunASR](https://github.com/FunAudioLLM/SenseVoice) · [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)——CPU 友好的语音与情绪识别
