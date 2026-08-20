# ADR 0003 — SQLite driver

> HISTORICAL R1 INPUT：仅可作为 `@penglai/im` 持久化参考，R2 需按新 plugin 生命周期复验。

- 状态：ACCEPTED
- 日期：2026-08-15
- 取代：D-026 PROBE

## Context

需要事务、FK、崩溃恢复、Electron/Node ABI、无额外下载器。

## Options

1. `better-sqlite3`（native，需 electron-rebuild）  
2. Node 内置 `node:sqlite`（Node 22+）  
3. sql.js（WASM，无 OS 锁语义）

## Decision

选项 2：`node:sqlite`（DatabaseSync）。

理由：Node 22.22.2 与目标 Electron 均带该模块；无 install script、无预编译二进制供应链；WAL + 同步事务满足单 writer。

CI Linux 同样用 Node 22。若某 Electron 构建缺少 `node:sqlite`，再开 ADR 改 better-sqlite3。

## Security impact

无 native postinstall。migration 失败 fail closed。
