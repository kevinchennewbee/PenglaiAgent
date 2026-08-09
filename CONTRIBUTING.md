# 为蓬莱做贡献 · Contributing to Penglai

蓬莱（Penglai）0.4 是面向个人项目与长期任务的本地 Agent 工作台。0.4 的产品代码位于
`packages/`，采用 TypeScript/Tauri，并使用固定版本的 Pi 作为上游 Agent 内核。

- **Pi 本身的 Agent 生命周期、模型和工具执行问题** → 先用最小复现确认，再反馈到
  [Pi](https://github.com/earendil-works/pi) 上游。
- **蓬莱产品问题**（项目/任务/运行/证据、桌面工作台、IM、Supervisor、安全策略、持久化、
  打包与发布）→ 在本仓库提 issue / PR。

## PR 约定

1. **不要复制或分叉 Pi 的 Agent 循环。** 上游差异收敛在 `AgentKernel` 适配层。
2. **安全相关改动必须配套回归测试**，并验证真实执行边界，不把路径检查或 `cwd` 当成沙箱。
3. **面向用户的字符串中英兼顾**即可；代码注释跟随周围风格，别堆无谓注释。
4. 小而可审的 diff，一个 PR 一件事。

## 0.4 工作流

0.4 是唯一的未来产品线。新功能和修复只进入 `packages/` 的 TypeScript/Tauri 路径。
仓库根目录的 Python 0.3 代码仅作为迁移参考，在完成能力提取后退出 0.4 发布路径。
0.4 的里程碑施工记录见 [`M1_BUILD_LOG.md`](M1_BUILD_LOG.md)，发布门禁由
`node scripts/release-check.mjs` 把关。

---

Penglai 0.4 is a local workbench for personal projects and long-running agent
tasks. Product code lives in `packages/`, uses TypeScript/Tauri, and integrates
a pinned Pi release through a narrow adapter. Do not copy or fork Pi's agent
loop. Penglai owns projects, tasks, runs, evidence, Desktop, IM, supervision,
security, persistence, packaging, and releases.

0.4 is the only future product line. Root Python 0.3 code is migration
reference only and leaves the 0.4 release path after proven behavior has been
extracted. See [`M1_BUILD_LOG.md`](M1_BUILD_LOG.md) for the milestone build
records; `node scripts/release-check.mjs` enforces the release gate.

「蓬莱 / Penglai」名称与视觉品牌保留所有权利，详见 [NOTICE](NOTICE)。
