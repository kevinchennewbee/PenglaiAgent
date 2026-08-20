# ADR 0001 — DSH pin

> HISTORICAL R1 ONLY：R2 必须在 RC1 新建发行版 ADR；本文件不能覆盖 `PRODUCT_CONSTITUTION.md`。

- 状态：ACCEPTED
- 日期：2026-08-15
- 取代：D-024 PROBE

## Context

R1 必须固定官方 `@deepseek-ai/dsh`，现场核对相对规划审计版 0.1.0-rc.6 / 47f9438。

## Evidence

- `npm view @deepseek-ai/dsh version` → `0.1.0-rc.6`
- `gh api repos/deepseek-ai/deepseek-harness/commits/master` → `47f943859bef60e4160492346772ded9b24f765a`
- 本机 `dsh --version` → `0.1.0-rc.6`
- Agent / claimed / MessageSourceMap / workspaceRegistry.list 与规划文档一致

## Options

1. 钉 0.1.0-rc.6  
2. 跟踪 latest / caret  

## Decision

选项 1。lockfile 精确 `0.1.0-rc.6`。启动 contract probe。漂移 fail closed。

## Security impact

无 fork；无深层 path 泄漏到 UI/adapter。

## Rollback

换 pin 必须新 ADR + 全量门禁。
