# Penglai 0.6.1 staged public copy

Not a public-byte claim. This unpublished local branch prepares post-publication
README and website wording for **after** immutable GitHub Release `v0.6.1`
bytes exist. Do not deploy, push, or present these files as live public
downloads. Integration and site deploy require immutable `v0.6.1` public
readback, then binding of installer sizes, SHA-256, and the peeled release
source SHA. Those values are omitted here on purpose.

Prepared surfaces on this branch: `README.md`, `website/index.html`,
`website/zh/index.html`, `website/en/index.html`. Current-release download
scope is Apple Silicon, Windows x64, and UnionTech UOS 20 LoongArch: three
installers, ten assets, signed updater Apple Silicon and Windows. Intel Mac
is excluded from 0.6.1; published 0.6.0 remains immutable. Historic
screenshots stay version-labeled as installed 0.5.5 UI references. Brand
artwork `website/art/readme-hero-060.png` is versionless and reused. Live
signed catalog remains `plugin-catalog-v1.000006` (zero installable extra
entries, historic office-reader revocation).

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
live evidence is not claimed (`LIVE_NOT_RUN`). WhatsApp is not a Penglai
channel.

Release URL: `https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1`.
Three exact installers use the stable `v0.6.1` URL shape:

- [`Penglai_0.6.1_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_aarch64.dmg)
- [`Penglai_0.6.1_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_windows_x64_setup.exe)
- [`Penglai_0.6.1_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_uos_loong64.deb)

Intel Mac is not a 0.6.1 installer. Published 0.6.0 remains immutable. The
intended public release set is three installers and ten assets. The signed
updater covers Apple Silicon and Windows x64. Linux amd64 and Windows ARM
are not targets. Mac/Windows embed Node `22.23.2` and Electron `43.6.0`
(Chromium 150). UOS 20 old-world embeds vendor Node `22.16.0` and Loongson
Electron `31.7.7` (Chromium 126). Native UOS install, startup, and function
are `OWNER_POST_RELEASE`. Do not mark PASS from source or cross-build
evidence. The 0.6.0 UOS `OWNER_POST_RELEASE` record is historical for that
release only. macOS is ad-hoc signed and not notarized. Windows has no
Authenticode. This copy does not claim a three-target native GUI PASS or
live provider replies on every target. Those excluded product surfaces stay
absent from README and both websites.

Published v0.5.10, v0.5.11, v0.5.12, and v0.6.0 stay immutable.

## 中文

蓬莱 0.6.1 使用官方 DeepSeek Harness `0.1.5-rc.1`（tag `dsh-v0.1.5-rc.1`，
commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`，279 包），面向 Apple 芯片、
Windows x64 与统信 UOS 20 龙芯。DSH 仍是唯一 Agent 核心。办公和记忆默认开启。
手机消息、语音识别、语音生成、主动陪伴仍为可选且默认关闭。

全新安装使用官方 DeepSeek 目录，含 `deepseek-flash`（DeepSeek-V41-Flash）。
用户已经明确选过的模型保留在官方设置里。聊天里可以附上文件，助手用工具来读。
能不能看图取决于你选的模型。办公负责检查、创建、预览和导出，写入要确认。
通用侧栏是纯文本预览，不是完整排版的办公视图。项目记忆只留在当前
Workspace；个人记忆是另一次明确选择。微信和飞书可以把文件发进绑定的会话。
会话不可用时，错误可处理（`/项目`、`/新建`）。可选的 macOS iMessage 私聊文本
默认关闭，需要完全磁盘访问和 Messages 自动化，在 Windows 与 UOS 上不可用。
真机 iMessage 未取证。不提供 WhatsApp。

三个精确安装包使用稳定的 `v0.6.1` 下载地址。Intel Mac 不是 0.6.1 安装目标；
已发布的 0.6.0 保持不可变。公开发布集为三个安装包、十个文件。签名升级覆盖
Apple 芯片和 Windows x64。Linux amd64 与 Windows ARM 不是目标。Mac/Windows
内嵌 Node `22.23.2` 与 Electron `43.6.0`。UOS 20 旧世界内嵌厂商 Node
`22.16.0` 与龙芯 Electron `31.7.7`。0.6.1 真机安装/启动/功能为
`OWNER_POST_RELEASE`。macOS 未公证，Windows 无 Authenticode。不宣称三端原生
界面全部 PASS。已发布的 0.5.10、0.5.11、0.5.12、0.6.0 保持不可变。
