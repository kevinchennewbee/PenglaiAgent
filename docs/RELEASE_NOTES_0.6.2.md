# Penglai 0.6.2

Status: immutable public release. All ten assets were published once and passed
public readback. The exact sizes and SHA-256 values are recorded in the
[publication manifest](PUBLICATION_MANIFEST_0.6.2.md). The installer source is
`83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6`.

Penglai 0.6.2 adopts the complete official DeepSeek Harness `0.1.5-rc.2` npm
cohort: 265 DSH packages, nine vendor packages, and five native packages. DSH
remains the only agent core and official conversation UI.

This release keeps the new upstream feedback surface while making its actual
boundary clear: feedback stays on this device and conversation content is not
uploaded by Penglai. It also restores the installed 0.6.1 to 0.6.2 upgrade
journey on Apple Silicon and Windows x64. The native gate preserves settings,
sessions, plugin choices, and Memory data before and after upgrade and default
uninstall.

The indirect `adm-zip` dependency used by the ONNX packaging toolchain is
locked to `0.6.1`, which refuses extraction through an existing destination
symlink. Install scripts remain disabled, and the archive helper is not called
by the installed product runtime.

Office and Memory start enabled. Messaging, speech recognition, voice
generation, and Companion remain optional and default off. iMessage is an
optional Mac-only private-text channel and remains `LIVE_NOT_RUN`. WhatsApp is
not bundled.

The [immutable `v0.6.2` release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.2)
contains exactly three installers plus the signed updater, release manifests,
checksums, and public source-export manifest named in `release-contract.json`.
Intel Mac, Linux amd64, and Windows ARM are not 0.6.2 targets. macOS remains
ad-hoc signed and not notarized; Windows has no Authenticode.

The UOS 20 LoongArch `.deb` is a complete installer containing Electron, Node,
official DSH, every first-party plugin, Office, Memory, Mnemon, and its local
runtime closure. `libatomic1` is required and `bubblewrap` is recommended.
MOSS-TTS is unavailable on LoongArch, and iMessage is Mac-only. The Loongson
Electron 31.7.7 / Chromium 126 runtime is no longer maintained. Native UOS
install, startup, UI, file picker, sleep/resume, and functional use remain
`OWNER_POST_RELEASE` for the Owner to test on the published package.

The two-hour installed soak is `OWNER_EXCLUDED`.

## 中文

蓬莱 0.6.2 已作为不可变公开版本发布，十项附件均完成公网回读。精确大小与
SHA-256 见[发布清单](PUBLICATION_MANIFEST_0.6.2.md)，安装包源码为
`83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6`。本版使用完整的官方 DeepSeek
Harness `0.1.5-rc.2` npm 依赖组，DSH 仍是唯一 Agent 核心和官方会话界面。
上游反馈入口按真实边界工作：反馈只留在本机，蓬莱不会通过该入口上传会话内容。

ONNX 打包工具链间接依赖的 `adm-zip` 已固定到 `0.6.1`，会拒绝通过目标目录中
已有的符号链接向外写入。依赖安装脚本仍保持关闭，安装后的产品运行时也不调用该
解压工具。

Apple 芯片 Mac 和 Windows x64 恢复 0.6.1 到 0.6.2 的真实安装版升级验收，逐项
检查设置、会话、插件选择和记忆数据在升级及默认卸载后仍被保留。办公和记忆默认
开启；消息连接、语音识别、语音生成和主动陪伴仍按需启用。iMessage 只在 Mac 上
提供可选私聊文本，真机 live 尚未取证；不提供 WhatsApp。

UOS 20 龙芯版是一个完整 `.deb`，带入 Electron、Node、官方 DSH、全部第一方插件、
办公、记忆、Mnemon 和本地运行闭包。系统需要 `libatomic1`，建议安装
`bubblewrap`。龙芯不提供 MOSS-TTS，iMessage 仅限 Mac。龙芯 Electron 31.7.7 /
Chromium 126 已不再维护。UOS 真机安装、启动、界面、文件选择器、休眠恢复与功能
由 Owner 在发布后手动测试，状态保持 `OWNER_POST_RELEASE`。

本版不含 Intel Mac、Linux amd64 或 Windows ARM。macOS 未公证，Windows 无
Authenticode。两小时安装版测试为 `OWNER_EXCLUDED`。
