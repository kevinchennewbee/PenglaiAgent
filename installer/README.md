# 蓬莱 · Penglai

**住在飞书、微信和终端里的自托管 AI 管家** · A self-hosted AI butler for Feishu, WeChat, and the terminal.

这是蓬莱的**引导安装器**。安装后运行 `penglai`,它会引导你完成完整安装:

```bash
pip install penglai
penglai        # 引导:选目录 → 自动克隆发行版 → 向导(依赖→模型→渠道→能力)
```

装好之后,`penglai` 命令自动透传给发行版:

```bash
penglai doctor     # 体检:环境/依赖/配置/LLM/记忆/服务/上游
penglai status     # 服务状态
penglai update     # 一键同步蓬莱发行仓
```

- 项目主页:https://github.com/kevinchennewbee/PenglaiAgent
- 蓬莱基于 [GenericAgent](https://github.com/lsdefine/GenericAgent) 执行核心(MIT, upstream-first),
  叠加统一多入口运行层、渠道 adapter、语音情绪感知、确定性安全红线、记忆卫生和版本身份等发行能力。
- 0.3.1 起 Docker 已撤出支持矩阵；请使用桌面安装包、命令行安装脚本、PyPI 引导器或源码安装。
- 国内网络友好:克隆自动回退 GitHub 镜像,依赖走清华 PyPI 镜像。可用 `PENGLAI_GH_PROXY` 指定自己的镜像。

**代码 MIT;「蓬莱 / Penglai」名称与视觉品牌保留所有权利。**
