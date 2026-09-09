# Penglai 0.6.0

Penglai 0.6.0 uses the unmodified official DeepSeek Harness `0.1.5-alpha.1` npm packages, fixed to tag `dsh-v0.1.5-alpha.1` and commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a` (272-package cohort). DSH remains the only agent core. Office and Memory stay required and default-on.

Immutable public bytes: [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0). Verified publication: [`docs/PUBLICATION_MANIFEST_0.6.0.md`](PUBLICATION_MANIFEST_0.6.0.md). The four installers were built from source SHA `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`. Published **v0.5.10**, **v0.5.11**, and **v0.5.12** tags and assets stay immutable.

## Changes

- Official DSH `0.1.5-alpha.1` full 272-package cohort. Session V3 copies historical logs and keeps originals. Plugin Agent API follows upstream (`ctx.agent` removed; Inbox is type-only).
- Lived-in 0.5.12 → 0.6.0 DSH Home copy skips DSH-regenerated `profiles/node_modules` installation links.
- Wizard: invalid credential classified as auth failure; stale workspace folder error clears on a valid path; custom-model image input uses official DeepSeek `inputModalities` (no model-id regex).
- Fourth packaged target: UnionTech UOS 20 Professional 1070 Loongson old-world `.deb`. Memory remains required/on; the architecture-built Mnemon `0.2.8` engine is packed. MOSS-TTS is not available and not enableable on LoongArch. Native UOS install, startup, and function remain Owner post-publication testing (`OWNER_POST_RELEASE`), not PASS.
- Publication is the complete eleven-file signed release set. The signed update sequence is 9. Updater platforms remain Apple Silicon, Intel Mac, and Windows x64.

## Downloads and verification

Apple Silicon, Intel Mac, and Windows x64 installers were built on matching native hosts from the same clean main commit: `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`. The UOS `.deb` was packaged from that same commit.

[Native target jobs](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376799819) cover Mac/Windows installed startup, credential-free onboarding/recovery, bundled plugin modes, upgrade from published 0.5.12, and default uninstall with user data preserved (four target jobs SUCCESS). The GitHub four-target aggregate job on that run FAILED while collecting the UOS `.deb` from a flattened path; the installer was present at `dist/Penglai_0.6.0_uos_loong64.deb`. That aggregate job is not PASS. Local collection of the original four artifacts produced complete `verify:release` PASS bound to this source. Independent PM desktop acceptance of the exact Apple Silicon installer bytes passed. Native UOS function is not claimed here.

Check the downloaded installer against `SHA256SUMS` before running it. Office and Memory start enabled. Messaging, speech recognition, voice generation, and Companion start disabled.

## Known boundaries

macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode signature**. UOS native install/startup/function remain `OWNER_POST_RELEASE`. Electron 31.7.7 / Chromium 126 on LoongArch is not maintained and is not a Mac/Windows security-parity claim. Packaged PDF page-image preview / bundled Poppler stay Owner-deferred. Private account delivery is not inferred from credential-free tests.

## 中文

蓬莱 0.6.0 使用未经修改的官方 DeepSeek Harness `0.1.5-alpha.1`（tag `dsh-v0.1.5-alpha.1`，commit `5dda764e…`，272 包）。DSH 仍是唯一 Agent 核心。办公与记忆必装默认开启。四个安装包来自同一干净 main 提交 `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`。Apple Silicon / Intel Mac / Windows 已做原生安装与从 0.5.12 升级验证；UOS 龙芯包已打包，真机安装/启动/功能为 Owner 发布后测试。UOS 使用龙芯 Electron 31.7.7（Chromium 126），未维持，也不是 Mac/Windows Electron 43 的安全等价。UOS 上 Memory 必开且带入架构构建的 Mnemon 引擎；MOSS 在龙芯上不可用、不可启用。macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。已发布的 0.5.10 / 0.5.11 / 0.5.12 不被改写。
