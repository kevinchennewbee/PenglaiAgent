# Penglai 0.6.0

These notes are a **source draft**. They are not a public GitHub Release and
do not replace the immutable [`v0.5.12`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.12)
download tables. Public README and both websites stay on 0.5.12 until
immutable `v0.6.0` bytes exist and are read back. Do not copy these notes
onto the live site before that.

Penglai 0.6.0 uses the unmodified official DeepSeek Harness `0.1.5-alpha.1`
npm packages, fixed to tag `dsh-v0.1.5-alpha.1` and commit
`5dda764ed3aa172535a7967b06ff95d9cbfe536a` (272-package cohort). DSH remains
the only agent core. Office and Memory stay required and default-on.

Four installer targets from **one** clean `main` SHA (SHA frozen only after
UOS payload integration): Apple Silicon, Intel Mac, Windows x64, and
UnionTech UOS 20 Professional 1070 Loongson old-world
(`Penglai_0.6.0_uos_loong64.deb`). Native UOS install, startup and function
are **Owner post-publication** testing (`OWNER_POST_RELEASE`), never PASS
before that.

## Changes

- Official DSH `0.1.5-alpha.1` full 272-package cohort. Session V3 copies
  historical logs and keeps originals. Plugin Agent API follows upstream
  (`ctx.agent` removed; Inbox is type-only).
- Lived-in 0.5.12 → 0.6.0 DSH Home copy skips DSH-regenerated
  `profiles/node_modules` and `profiles/<name>/node_modules` installation
  links, including `collectHistoricalSessionLogs` skip-before-lstat.
  `bundle-desktop` rebuilds TypeScript before packing so that skip ships.
- Wizard: invalid credential classified as auth failure; stale workspace
  folder error clears on a valid path; custom-model image input uses
  official DeepSeek `inputModalities` (no model-id regex).
- Fourth target: actual UOS 20 old-world `.deb` class with Office/Memory
  required and chrome-sandbox kept. Payload addons (koffi / require-builtin /
  sharp) are integrated from a separate old-world build, not from new-world
  npm `linux-loong64` wheels.

## Known boundaries

- macOS is ad-hoc signed and **not notarized**. Windows has **no
  Authenticode**.
- UOS native install/startup/function remain `OWNER_POST_RELEASE`.
- UOS Electron is Loongson vendor **31.7.7** (Chromium 126.0.6478.234,
  zip dated 2025-02-06). That train is **not maintained** and is **not**
  a Chromium 150 / Electron 43 security equivalent of Mac/Windows. PM has
  not accepted publishing that limitation as a production-security PASS.
  Options remain: ship 31.7.7 with this disclosure, or do not ship a public
  old-world 43 recipe. V25 is not requested.
- Packaged PDF page-image preview / bundled Poppler stay Owner-deferred.
- WhatsApp is not a product surface.

## Verification (after freeze)

Installers must match `SHA256SUMS` from the `v0.6.0` release. Upgrade from
published 0.5.12 on matching Mac/Windows hosts. Default uninstall preserves
user data. 0.5.10, 0.5.11 and 0.5.12 tags stay immutable.

## 中文

本说明是**源码草稿**，不是 GitHub 公开发布，也不替换不可变的
[v0.5.12](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.12)
下载表。在 v0.6.0 回读完成前，公开 README 与两个网站仍指向 0.5.12。

蓬莱 0.6.0 使用未经修改的官方 DeepSeek Harness `0.1.5-alpha.1`（tag
`dsh-v0.1.5-alpha.1`，commit `5dda764e…`，272 包）。DSH 仍是唯一 Agent
核心。办公与记忆必装默认开启。四个安装包须来自同一干净 main SHA：Apple
Silicon、Intel Mac、Windows x64，以及统信 UOS 20 专业版 1070 龙芯旧世界
`.deb`。UOS 上的安装/启动/功能验收为 **Owner 发布后测试**
（`OWNER_POST_RELEASE`），发布前不得标 PASS。

macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。UOS 使用龙芯厂商
Electron 31.7.7（Chromium 126），**未维持**，也不是 Mac/Windows Electron 43
/ Chromium 150 的安全等价；PM 尚未把该限制接受为生产安全 PASS。已发布的
0.5.10 / 0.5.11 / 0.5.12 不被改写。
