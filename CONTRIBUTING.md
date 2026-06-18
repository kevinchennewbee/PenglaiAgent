# 为蓬莱做贡献 · Contributing to Penglai

蓬莱（Penglai）是 [GenericAgent](https://github.com/lsdefine/GenericAgent)（GA）的中文个人管家**发行版**——
内核完全用 GA，蓬莱只在其上做发行层的裁剪与增补。请按问题归属选地方：

- **内核 / Agent 循环 / 工具本身的 bug** → 提到上游 [GenericAgent](https://github.com/lsdefine/GenericAgent)。
  蓬莱不把发行层策略写进 GA 执行核心（`ga.py`、`agent_loop.py`、`llmcore.py`、`agentmain.py` 保持 upstream-first）。
- **发行层问题**（安装向导、`penglai` CLI、Docker、渠道 adapter 打磨、`plugins/penglai_*` 插件、SOP 包、文档、
  发布脚本）→ 在本仓库提 issue / PR。

## PR 约定

1. **优先只动发行层或新增文件。** 需要改 IM 前端时，必须是明确的蓬莱 adapter/V5 迁移需求，并配套测试；
   GA 执行核心仍按 upstream-first 处理。
2. **安全相关改动配套回归测试**：放进 `tests/`，`python tests/test_xxx.py` 或 `pytest` 全绿。
3. **面向用户的字符串中英兼顾**即可；代码注释跟随周围风格，别堆无谓注释。
4. 小而可审的 diff，一个 PR 一件事。

---

Penglai is a Chinese personal-butler **distribution** of [GenericAgent](https://github.com/lsdefine/GenericAgent):
the execution core is GA and stays upstream-first; Penglai curates and extends on top.

- Kernel / agent-loop / tool bugs → file upstream at **GenericAgent**. Penglai does not put distro policy into the GA execution core.
- Distribution-layer issues (wizard, `penglai` CLI, Docker, channel adapters, `plugins/penglai_*`, docs,
  release scripts) → open an issue / PR here.

PR rules: prefer distro-layer or new files; IM frontend edits need a clear Penglai adapter/V5 reason and tests;
ship a `tests/` regression for security changes; keep diffs small.

「蓬莱 / Penglai」名称与视觉品牌保留所有权利，详见 [NOTICE](NOTICE)。
