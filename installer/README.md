# 蓬莱 · Penglai

**住在飞书、微信和终端里的自托管 AI 管家** · A self-hosted AI butler for Feishu, WeChat, and the terminal.

这是已冻结的蓬莱 **0.3.6 引导安装器**，只会下载并校验 `v0.3.6` 的固定源码快照。它不是 0.4 安装器；0.4 请从 GitHub Releases 获取桌面版。

```bash
pip install penglai
penglai        # 引导:选目录 → 自动克隆发行版 → 向导(依赖→模型→渠道→能力)
```

装好之后,`penglai` 命令自动透传给发行版:

```bash
penglai doctor     # 体检:环境/依赖/配置/LLM/记忆/服务/上游
penglai status     # 服务状态
penglai update     # 0.3.6 已冻结；该命令会拒绝跨代原地升级
```

- 项目主页:https://github.com/kevinchennewbee/PenglaiAgent
- 这份 PyPI 包仅服务于历史 0.3.6。0.4 以 TypeScript Host 与 Pi 为唯一核心，不复用该 Python 引导链。
- 0.3.1 起 Docker 已撤出支持矩阵；请使用桌面安装包、命令行安装脚本、PyPI 引导器或源码安装。
- 引导器不执行第三方镜像代码；固定归档必须通过内置大小与 SHA-256 校验。

**代码 MIT;「蓬莱 / Penglai」名称与视觉品牌保留所有权利。**
