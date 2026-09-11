# Penglai 0.6.1

Immutable public release [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1),
published 2026-09-11 from source
`7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`. Observed public readback is
`PUBLIC_READBACK_PASS`. Exact bytes and SHA-256 are in
[`docs/PUBLICATION_MANIFEST_0.6.1.md`](PUBLICATION_MANIFEST_0.6.1.md).

Penglai 0.6.1 brings official DeepSeek Harness `0.1.5-rc.1` to the desktop, with
the complete 279-package registry cohort pinned to upstream commit
`183f08e9c6dde7e36cd2318eaee70b0da08fb35e` (tag `dsh-v0.1.5-rc.1`). DSH remains
the only agent core. Office and Memory start enabled; optional plugins start
disabled.

## Changes

- Fresh setup uses the official model catalog, including `deepseek-flash` and
  its text/image capabilities. Existing explicit model choices are preserved.
- Office document creation works with real providers and still requires
  confirmation for writes and exports. Confirmed Memory facts persist in Mnemon
  and remain separated by workspace.
- Add workspace works from the sidebar and new conversations, with cancel,
  retry and invalid-folder recovery. Uploaded documents can be read with tools;
  the generic sidebar is not a visual DOCX renderer.
- Messaging preserves file delivery and recovers completed turns through
  official DSH session APIs. Optional macOS iMessage supports private text,
  starts disabled and requires the user's OS permissions. Live iMessage and
  other private-account IM journeys are not claimed as tested.
- File-name handling avoids polynomial regular-expression work. Plugin and
  persisted-profile checks read the file they validated, and reject oversized
  profile files before and after reading. The Office Sharp dependency is
  updated to 0.35.4.

## Installers and verification

The three installers come from source commit
`7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`: Apple Silicon Mac, Windows x64 and
UnionTech UOS 20 LoongArch. Intel Mac is excluded from this release. The
[build and acceptance run](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34548435454)
records the exact artifact identities. Use the architecture that matches your
computer and check the download against `SHA256SUMS`.

Mac and Windows acceptance covers fresh installation, startup, onboarding
recovery, bundled plugin modes, normal restart and default uninstall with user
data preserved. The final Apple Silicon package passed independent identity,
signature and real-provider connection checks, including invalid-key rejection
and a real-provider retry. File, image, Office action-confirmed write, and
Memory A-B isolation plus restart GUI journeys, including English Dark, were
tested on the preceding 0.6.1 package with matching relevant product code (331
relevant product files unchanged at the final source; only two tests differed).
A new real-account Workspace conversation in the final package remains a
supplemental unrun check (`NOT_RUN`) after the session was interrupted; live
account repeats are supplemental and are not a mandatory gate. Optional account
IM was not run. Old-version installed upgrade and a two-hour soak were excluded
from this release's acceptance (`OWNER_EXCLUDED`).

UOS packaging and old-world ABI checks are separate from native execution.
Physical UOS installation, startup and function remain `OWNER_POST_RELEASE`;
the Owner will test the published installer. MOSS-TTS is unavailable on UOS
LoongArch.

This release contains all ten contract files: three installers, release
metadata, signed update metadata, checksums, the SBOM, third-party notices and
the public source-export manifest. Signed updater coverage is Apple Silicon Mac
and Windows x64.

## Known limits

macOS packages are ad-hoc signed and not notarized. Windows has no Authenticode
signature. Native Windows checks used the hosted runner's existing security
configuration; a default installation with Defender enabled was not verified.
The Penglai signatures verify file integrity; they do not provide Apple or
Microsoft publisher trust. UOS uses Loongson Electron 31.7.7 / Chromium 126 and
vendor Node 22.16.0, an unmaintained version that does not offer the same
security baseline as Mac/Windows Electron 43.6.0 / Node 22.23.2.

The dependency graph retains the unpatched
[adm-zip advisory](https://github.com/advisories/GHSA-vwc7-r8mq-g2x9). Its ONNX
installation-script extraction path is disabled in the release build, and
Penglai does not call it from the product runtime. Packaged PDF page-image
preview remains deferred. Private account delivery is not inferred from tests
that use no credentials.

Published v0.5.10, v0.5.11, v0.5.12, and v0.6.0 tags and assets stay immutable.

## 中文

蓬莱 0.6.1 使用官方 DeepSeek Harness `0.1.5-rc.1` 的完整 279 包依赖组，DSH
仍是唯一 Agent 核心。办公和记忆默认开启，可选插件默认关闭。不可变发行版为
[`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1)，
源码 `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`。公开回读为
`PUBLIC_READBACK_PASS`。

本版接入官方 `deepseek-flash` 模型及图像能力，修复办公创建、记忆持久化与工作区隔离、消息文件交付和工作区选择。办公写入与导出仍须用户确认。可选 iMessage 仅支持 macOS 私聊文本，默认关闭，须用户授予系统权限；没有宣称已完成真实账号消息测试。文件名处理、插件文件校验和启动证明读取也补上了安全边界。

Apple Silicon Mac、Windows x64 和 UOS 龙芯三个安装包来自同一源码提交 `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`。本次不发布 Intel Mac 安装包。Mac/Windows 已做全新安装、引导恢复、插件模式、正常重启和默认卸载验证；Apple Silicon 最终包另通过身份、签名和真实模型连接检查。文件、图片、办公与记忆界面流程已在相关产品代码相同的前一份 0.6.1 包上实测；最终包新增工作区的真实账号会话未复测，仍单列为补充未运行项。旧版本已安装升级和两小时 soak 不在本次验收范围。

UOS 的打包与 ABI 验证不等于实机运行。UOS 真机安装、启动和功能由 Owner 发布后验证，状态为 `OWNER_POST_RELEASE`；龙芯上不提供 MOSS-TTS。macOS 未公证，Windows 无 Authenticode；Windows 原生检查使用托管运行器现有安全配置，尚未验证默认开启 Defender 的系统。UOS 使用的 Electron 31.7.7 / Chromium 126 已停止维护，安全基线不等同于 Mac/Windows。依赖图保留尚无补丁的 adm-zip 公告，其 ONNX 安装脚本解压路径在发布构建中禁用，产品运行时不调用该路径。下载后请核对 `SHA256SUMS`。
