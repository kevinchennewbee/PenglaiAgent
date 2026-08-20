# ADR 0007 — Embedded Node and DSH closure

- 状态：ACCEPTED
- 日期：2026-08-15

## Decision

- 嵌入官方 Node `v22.22.2` darwin-arm64：`https://nodejs.org/dist/v22.22.2/node-v22.22.2-darwin-arm64.tar.gz`
- SHA-256：`db4b275b83736df67533529a18cc55de2549a8329ace6c7bcc68f8d22d3c9000`
- DSH production closure 从 frozen lock 复制完整 `@deepseek-ai/dsh` 及其运行依赖，不是顶层单包。
- Supervisor 只接受已验证绝对路径：`runtime/node/bin/node` + `runtime/dsh/lib/bin.js`。
- 生产代码不得出现 `dsh`/`node` PATH fallback。
- 打包器：受控 `scripts/embed-runtime.mjs` + `scripts/package-mac.mjs`（自研 pipeline，不依赖 electron-builder）。
