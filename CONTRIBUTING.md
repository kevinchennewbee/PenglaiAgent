# 为蓬莱做贡献 · Contributing to Penglai

蓬莱（Penglai）是 [GenericAgent](https://github.com/lsdefine/GenericAgent)（GA）的中文个人管家**发行版**——
内核完全用 GA，蓬莱只在其上做发行层的裁剪与增补。请按问题归属选地方：

- **内核 / Agent 循环 / 工具本身的 bug** → 提到上游 [GenericAgent](https://github.com/lsdefine/GenericAgent)。
  蓬莱不编辑 GA 内核文件（`ga.py`、`agent_loop.py`、`llmcore.py`、`agentmain.py`、`frontends/*` 等保持零 diff）。
- **发行层问题**（安装向导、`penglai` CLI、Docker、飞书/微信接入打磨、`plugins/penglai_*` 插件、SOP 包、文档、
  发布脚本）→ 在本仓库提 issue / PR。

## PR 约定

1. **只动发行层或新增文件，不编辑上游 GA 文件。** 要改现有工具/前端的行为，用 `plugins/penglai_*.py`
   在运行时 monkeypatch 包装（例：`_orig = GenericAgentHandler.do_xxx` 再覆盖），保上游升级无冲突。
2. **安全相关改动配套回归测试**：放进 `tests/`，`python tests/test_xxx.py` 或 `pytest` 全绿。
3. **面向用户的字符串中英兼顾**即可；代码注释跟随周围风格，别堆无谓注释。
4. 小而可审的 diff，一个 PR 一件事。

---

Penglai is a Chinese personal-butler **distribution** of [GenericAgent](https://github.com/lsdefine/GenericAgent):
the kernel is GA, untouched; Penglai only curates and extends on top.

- Kernel / agent-loop / tool bugs → file upstream at **GenericAgent**. Penglai never edits GA kernel files.
- Distribution-layer issues (wizard, `penglai` CLI, Docker, channel polish, `plugins/penglai_*`, docs,
  release scripts) → open an issue / PR here.

PR rules: edit only distro-layer or new files (wrap GA behavior via runtime monkeypatch in
`plugins/penglai_*.py`, never edit GA files); ship a `tests/` regression for security changes; keep diffs small.

「蓬莱 / Penglai」名称与视觉品牌保留所有权利，详见 [NOTICE](NOTICE)。
