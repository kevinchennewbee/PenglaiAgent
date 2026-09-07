# R511-02c Mnemon native evaluation

Decision: **retain `0.2.4`**. Do not upgrade this development freeze.

Checked on 2026-09-07 against GitHub releases and this worktree.

## Current pin

| Field | Value |
| --- | --- |
| Release | `v0.2.4` |
| Commit | `67ed1a2f80de902fd041eeaf3b90e7e3d2480d5b` |
| Runner check | `packages/memory/src/engine/runner.ts` requires stdout to include `0.2.4` |
| Assets | `third_party/sources.lock.json` darwin-aarch64 / darwin-x86_64 / win32-x86_64 |

## Local CLI evidence

On Darwin arm64 the pinned binary prints `mnemon version 0.2.4`.

On clean SHA `d7f20c7eeadf6722ab832f5cc3374cb7c5e6f77a`, `pnpm verify:memory-real`
is official PASS: remember/search/recall/forget, workspace isolation, and the
exact 100k corpus query. That is darwin-aarch64 Memory-real, not Windows
special-character paths, old-database copies, or rollback.

## Successor survey (2026-09-07)

Latest GitHub release at check time: **`v0.2.8`** (`2026-09-05`).

| Version | Why it is not consumed here |
| --- | --- |
| 0.2.5 | MiniMax Code / ZCode host integrations. Not a Penglai Memory engine requirement. |
| 0.2.6 | OpenAI-compatible embeddings and readonly-write enforcement. Needs new asset identity and Memory-real. |
| 0.2.7 | Claims Windows/relative `--data-dir` SQLite URI encoding for spaces, Unicode, `#`, `%`. This is the first successor that matches the row's Windows special-character requirement. **Not verified on Windows in this session.** |
| 0.2.8 | npm-managed CLI distribution plus embeddings probe fallback. Penglai ships pinned native archives, not `mnemon update`. |

Upgrade would also require:

1. Exact three-target archive/binary SHA-256 in `sources.lock.json` and
   `packages/release-identity`.
2. Runner version pin change from `0.2.4`.
3. Old `mnemon.db` copy open/search/rollback on each target.
4. Windows native paths with spaces/Unicode/`#`/`%`.
5. No mixed 0.2.4/0.2.8 binaries in one release closure.

Those items are absent. The cohort freeze therefore keeps `0.2.4`.

## 中文

评估结论是保留 Mnemon `0.2.4`。本机 Apple Silicon 上 CLI 能跑 remember/search，
但官方 Memory-real 因脏工作区禁止 PASS。GitHub 已有 `0.2.8`；其中 `0.2.7` 才
对准 Windows 特殊字符路径，但本会话没有 Windows 主机、没有旧库副本和回滚证据，
所以不能升级。
