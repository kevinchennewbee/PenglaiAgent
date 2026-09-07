# Penglai 0.5.11

Penglai 0.5.11 uses the unmodified official DeepSeek Harness `0.1.2-rc.1` npm packages, fixed to tag `dsh-v0.1.2-rc.1` and commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. DSH remains the only agent core. Penglai supplies the desktop application, onboarding, local data lifecycle and bundled plugins.

Immutable public bytes: [`v0.5.11`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.11). Verified publication: [`docs/PUBLICATION_MANIFEST_0.5.11.md`](PUBLICATION_MANIFEST_0.5.11.md). Published **v0.5.10** tags and assets stay immutable.

## Changes

- Isolation and recovery: Owner-peer IM gating, Office job Workspace/Session ownership, Memory policy-before-write, Center journal last-good recovery, and Windows NSIS upgrade staging that copies over a locked install tree instead of deleting it first.
- First-party workflows through official DSH slots: scoped Memory library query, Weixin/Feishu official question/approval identity, bounded text-PDF inspect plus digest-bound page preview, read-only usage projection, and redacted Plugin Center diagnostics.
- Upgrades from 0.5.8, 0.5.9 and 0.5.10 on matching native hosts. Default uninstall preserves user data.
- Publication requires the complete ten-file signed release set. The signed update sequence is 7.

## Downloads and verification

Apple Silicon, Intel Mac and Windows x64 installers were built on matching native hosts from the same clean main commit: `77e7105773b4d43abb7315ea6e83abe17e646cb4`.

[Native build and installed checks](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34151469696) cover installed startup, credential-free onboarding/recovery, bundled plugin modes, the three pinned upgrade paths and default uninstall with user data preserved. [Complete publication and public-byte readback](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34155522316) verified the ten-file set after the draft became public.

Check the downloaded installer against `SHA256SUMS` before running it. Office and Memory start enabled. Messaging, speech recognition, voice generation and Companion start disabled.

## Known boundaries

macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode signature**. Private account delivery and real provider responses are not inferred from credential-free tests. Mnemon remains `0.2.4`. UOS/LoongArch is not a release target.

## 中文

蓬莱 0.5.11 使用未经修改的官方 DeepSeek Harness `0.1.2-rc.1`（tag `dsh-v0.1.2-rc.1`，commit `a66e470…`）。DSH 仍是唯一 Agent 核心。三端安装包来自同一干净 main 提交 `77e7105773b4d43abb7315ea6e83abe17e646cb4`，并验证从 0.5.8、0.5.9、0.5.10 升级与默认卸载保留用户数据。macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。无凭据测试不代表真实账号送达。已发布的 0.5.10 未被改写。
