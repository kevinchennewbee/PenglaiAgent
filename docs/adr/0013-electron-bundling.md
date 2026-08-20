# ADR 0013 — Electron production bundling

- 状态：ACCEPTED
- 日期：2026-08-15
- RC：RC1 / 由 RC2 实施

## Decision

Electron main/preload 在 `package:mac` 时用 esbuild 打成 `Resources/app` 内的自包含 ESM，external 仅允许 `electron` 与 Node builtin。禁止 workspace protocol、repo symlink 和 NODE_PATH。

## Consequences

F-01 在 RC2 通过 isolated createRequire 关闭。preload 保持 contextIsolation + sandbox。
