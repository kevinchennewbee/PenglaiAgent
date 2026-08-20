# ADR 0005 — Electron bundler / packager

> HISTORICAL R1 ONLY：该打包结果未包含完整 Node/DSH closure，已被 R1 FAIL 报告否决。

- 状态：ACCEPTED
- 日期：2026-08-15

## Decision

- Electron **精确 pin** 与 Node 22 ABI 匹配的发布版（见根 package.json）。
- 打包使用 **pinned `electron@43.4.0` + 本仓 `scripts/package-mac.mjs` dir packer**：复制官方 `Electron.app` 为 `Penglai.app`，写入 `Resources/app`，再 `ditto` 成 `unsigned` zip。
- renderer 为静态 HTML + ESM，无远程脚本。
- 主进程 TypeScript 编译到 `apps/desktop/dist`。
- `ignore-scripts=true`；仅 `scripts/ensure-electron.mjs` 显式调用官方 `electron/install.js` 拉取二进制，并记入供应链 allowlist。

不创建公共 GitHub Release。文件名含 `unsigned`。
