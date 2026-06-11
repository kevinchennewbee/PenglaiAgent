# 蓬莱 · Penglai

**住在你飞书和微信里的中文 AI 管家** · Your personal AI butler, living in Feishu & WeChat.

这是蓬莱的**引导安装器**。安装后运行 `penglai`,它会引导你完成全部安装:

```bash
pip install penglai
penglai        # 引导:选目录 → 自动克隆发行版 → 向导(依赖→模型→飞书→可选微信扫码)
```

装好之后,`penglai` 命令自动透传给发行版:

```bash
penglai doctor     # 体检:环境/依赖/配置/LLM/记忆/服务/上游
penglai status     # 服务状态
penglai update     # 一键同步上游内核
```

- 项目主页:https://github.com/kevinchennewbee/PenglaiAgent
- 蓬莱基于 [GenericAgent](https://github.com/lsdefine/GenericAgent) 内核(MIT,零改动),
  叠加微信渠道、语音情绪感知、确定性安全红线、记忆卫生、跨厂商防幻觉复核等精选外设。
- 国内网络友好:克隆自动回退 gh-proxy 镜像,依赖走清华 PyPI 镜像。

**代码 MIT;「蓬莱 / Penglai」名称与视觉品牌保留所有权利。**
