# ADR 0002 — 进程布局与本地控制

> HISTORICAL R1 ONLY：旧控制面进程布局已被 `docs/ARCHITECTURE.md` 取代。

- 状态：ACCEPTED
- 日期：2026-08-15
- 取代：D-025 PROBE

## Context

首选控制平面在 DSH plugin 内。DSH 通过 `dsh plugin --profile web add` + Cordis `apply` 加载插件。Electron 必须监督子进程并提供认证入口。

## Decision

**混合且单一控制平面：**

1. `@penglai/im` 作为 DSH web profile 插件，在 DSH 进程内持有 Routing Control Plane、SQLite writer、adapters。
2. Electron main 只做 supervisor、OS 安全存储代理、认证本地代理、UI。
3. Electron ↔ plugin 使用 `127.0.0.1` 随机端口 + 每启动 ≥128 bit token 的窄 schema HTTP（控制面，不是 DSH `/api`）。
4. 测试可用内存 ports 替换网络。

若 profile 安装失败，允许把同一套 routing-core 放在 Electron main，仅通过最小 bridge plugin 调 Agent——仍是一个 writer、一个 Agent 入口。不得双写 SQLite。

## Security impact

内层 DSH Web 仍无认证（残余风险）。外层 token + Origin 检查。不绑 0.0.0.0。
