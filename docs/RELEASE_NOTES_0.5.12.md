# Penglai 0.5.12

Penglai 0.5.12 uses the unmodified official DeepSeek Harness `0.1.3-alpha.2` npm packages, fixed to tag `dsh-v0.1.3-alpha.2` and commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9`. DSH remains the only agent core. Penglai supplies the desktop application, onboarding, local data lifecycle and bundled plugins.

Immutable public bytes: [`v0.5.12`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.12). Verified publication: [`docs/PUBLICATION_MANIFEST_0.5.12.md`](PUBLICATION_MANIFEST_0.5.12.md). Published **v0.5.10** and **v0.5.11** tags and assets stay immutable.

## Changes

- Official DSH `0.1.3-alpha.2` full 263-package cohort freeze, with first-party plugin, Remote, IM, Memory, session projection and Home-generation re-verification on that cohort.
- Native installer class repairs: DMG convert/eject identity, NSIS ExecWait construction, scoped process stop that does not kill `Uninstall.exe` running from INSTDIR, and Finder paper-hall plates behind native DMG icon names.
- Packaged PDF page-image preview and bundled Poppler are **deferred by Owner / out of scope** for 0.5.12, not PASS. Existing PDF inspect and digest-bound text preview remain.
- Upgrades from 0.5.8, 0.5.9, 0.5.10 and 0.5.11 on matching native hosts. Default uninstall preserves user data.
- Publication requires the complete ten-file signed release set. The signed update sequence is 8.

## Downloads and verification

Apple Silicon, Intel Mac and Windows x64 installers were built on matching native hosts from the same clean main commit: `54a0ef30afa4e3d653e400a637d4aa8eb4abbb75`.

[Native build and installed checks](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34293608792) cover installed startup, credential-free onboarding/recovery, bundled plugin modes, the four pinned upgrade paths and default uninstall with user data preserved. [Complete publication and public-byte readback](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34305249020) verified the ten-file set after the draft became public.

Check the downloaded installer against `SHA256SUMS` before running it. Office and Memory start enabled. Messaging, speech recognition, voice generation and Companion start disabled.

## Known boundaries

macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode signature**. GitHub-hosted Windows runners observed Defender realtime monitoring already off with broad `C:\` / `D:\` exclusions before Penglai; Penglai did not mutate Defender. That is **not** default-OS Defender-on proof. Private account delivery and real provider responses are not inferred from credential-free tests. UOS/LoongArch is not a release target.

## 中文

蓬莱 0.5.12 使用未经修改的官方 DeepSeek Harness `0.1.3-alpha.2`（tag `dsh-v0.1.3-alpha.2`，commit `82a5fd61…`，263 包队列）。DSH 仍是唯一 Agent 核心。三端安装包来自同一干净 main 提交 `54a0ef30afa4e3d653e400a637d4aa8eb4abbb75`，并验证从 0.5.8、0.5.9、0.5.10、0.5.11 升级与默认卸载保留用户数据。新增 PDF 页预览与捆绑 Poppler 由 Owner 推迟，不是 PASS。macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。托管 Windows 上的 Defender 默认开启未取证。无凭据测试不代表真实账号送达。已发布的 0.5.10 与 0.5.11 未被改写。
