# Penglai 0.6.1 public copy

Bound to immutable GitHub Release [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1).
Original public readback is `PUBLIC_READBACK_PASS`. Source SHA
`7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`. This file is the publication-truth
note for README and both websites. Exact ten-asset table:
[`docs/PUBLICATION_MANIFEST_0.6.1.md`](../PUBLICATION_MANIFEST_0.6.1.md).
Do not guess hashes. Historical 0.6.0 and older releases stay immutable.

Prepared surfaces: `README.md`, `SECURITY.md`, `docs/RELEASE_NOTES_0.6.1.md`,
`docs/PUBLICATION_MANIFEST_0.6.1.md`, `website/index.html`,
`website/zh/index.html`, `website/en/index.html`. Current-release download
scope is Apple Silicon, Windows x64, and UnionTech UOS 20 LoongArch: three
installers, ten assets, signed updater Apple Silicon and Windows. Intel Mac
is excluded from 0.6.1. Historic screenshots stay version-labeled as installed
0.5.5 UI references. Brand artwork `website/art/readme-hero-060.png` is
versionless and reused. Live signed catalog remains `plugin-catalog-v1.000006`.

## English

Penglai 0.6.1 installs official DeepSeek Harness `0.1.5-rc.1` (tag
`dsh-v0.1.5-rc.1`, commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`, 279 npm
packages) on Apple Silicon, Windows x64, and UnionTech UOS 20 LoongArch.
DSH remains the only agent core. Office and Memory start on.
Mobile Messaging, speech recognition, voice generation, and Companion stay
optional and default off.

Fresh install uses the official DeepSeek catalog, including `deepseek-flash`
(DeepSeek-V41-Flash). Existing explicit model choices stay in official
settings. Users can attach files in chat; the assistant reads them with tools.
Picture input follows the selected model's vision capability. Office inspects,
creates, previews, and exports with confirmation on writes. The generic
sidebar is a plain-text preview, not a formatted Office viewer. Project memory
stays in the current Workspace. Personal memory is an explicit separate
choice. WeChat and Feishu can send files into the bound conversation. Missing
session errors stay durable with `/projects` and `/new`. An optional macOS
iMessage private-text channel is default off, requires Full Disk Access and
Messages automation, and is unsupported on Windows and UOS. Native iMessage
live evidence is not claimed (`LIVE_NOT_RUN`). Optional account IM was not
run. WhatsApp is not a Penglai channel.

Release URL: `https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1`.
Three exact installers from source `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`:

- [`Penglai_0.6.1_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_aarch64.dmg) — 284,369,412 bytes · SHA-256 `91393e2e760871694e836c2582b903f6fee509e9fa11391724567e472f9946e9`
- [`Penglai_0.6.1_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_windows_x64_setup.exe) — 371,266,017 bytes · SHA-256 `d4fb670edea847024abcb2a1ac760cc2f7c5814d0c60f77f80ec647c59f51791`
- [`Penglai_0.6.1_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_uos_loong64.deb) — 293,074,470 bytes · SHA-256 `cd38c06e37151f226e7f9eb2519dba0800fc9ed7f4449d2b7edd5a282efb5934`

Intel Mac is not a 0.6.1 installer. Published 0.6.0 remains immutable. The
public release set is three installers and ten assets. The signed updater
covers Apple Silicon and Windows x64. Linux amd64 and Windows ARM are not
targets. Mac/Windows embed Node `22.23.2` and Electron `43.6.0`
(Chromium 150). UOS 20 old-world embeds vendor Node `22.16.0` and Loongson
Electron `31.7.7` (Chromium 126). Native UOS install, startup, and function
are `OWNER_POST_RELEASE`. Do not mark PASS from source or cross-build
evidence. The 0.6.0 UOS `OWNER_POST_RELEASE` record is historical for that
release only. macOS is ad-hoc signed and not notarized. Windows has no
Authenticode. Native Windows checks used the hosted runner's existing
configuration; default Defender-enabled Windows was not verified. File,
image, Office, and Memory GUI journeys were completed on the preceding 0.6.1
package with matching product files. A new Workspace live conversation on the
final package was not run. Those excluded product surfaces stay absent from
README and both websites as PASS claims.

Published v0.5.10, v0.5.11, v0.5.12, and v0.6.0 stay immutable.

## 中文

蓬莱 0.6.1 使用官方 DeepSeek Harness `0.1.5-rc.1`（tag `dsh-v0.1.5-rc.1`，
commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`，279 包），面向 Apple 芯片、
Windows x64 与统信 UOS 20 龙芯。DSH 仍是唯一 Agent 核心。办公和记忆默认开启。
手机消息、语音识别、语音生成、主动陪伴仍为可选且默认关闭。不可变发行版
[`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1)
已公开回读通过，源码 `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`。

全新安装使用官方 DeepSeek 目录，含 `deepseek-flash`（DeepSeek-V41-Flash）。
用户已经明确选过的模型保留在官方设置里。聊天里可以附上文件，助手用工具来读。
能不能看图取决于你选的模型。办公负责检查、创建、预览和导出，写入要确认。
通用侧栏是纯文本预览，不是完整排版的办公视图。项目记忆只留在当前
Workspace；个人记忆是另一次明确选择。微信和飞书可以把文件发进绑定的会话。
会话不可用时，错误可处理（`/项目`、`/新建`）。可选的 macOS iMessage 私聊文本
默认关闭，需要完全磁盘访问和 Messages 自动化，在 Windows 与 UOS 上不可用。
真机 iMessage 未取证。可选账号消息未运行。不提供 WhatsApp。

三个精确安装包使用稳定的 `v0.6.1` 下载地址，并带公开大小与 SHA-256。
Intel Mac 不是 0.6.1 安装目标；已发布的 0.6.0 保持不可变。公开发布集为三个
安装包、十个文件。签名升级覆盖 Apple 芯片和 Windows x64。Linux amd64 与
Windows ARM 不是目标。Mac/Windows 内嵌 Node `22.23.2` 与 Electron `43.6.0`。
UOS 20 旧世界内嵌厂商 Node `22.16.0` 与龙芯 Electron `31.7.7`。0.6.1 真机
安装/启动/功能为 `OWNER_POST_RELEASE`。macOS 未公证，Windows 无 Authenticode。
Windows 原生检查使用托管运行器现有安全配置，尚未验证默认开启 Defender 的系统。
不宣称三端原生界面全部 PASS。已发布的 0.5.10、0.5.11、0.5.12、0.6.0 保持不可变。
