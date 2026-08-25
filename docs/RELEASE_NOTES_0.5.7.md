# Penglai 0.5.7 release notes

Trust tier: `community-verified`. Official DeepSeek Harness `0.1.1-rc.2`
remains the only agent core. This release is not silent auto-update.

## Exact candidate / 精确候选

This file is a **CANDIDATE** template. Observed source SHA, native run, installer
bytes, and SHA-256 are filled only after public readback of an immutable
`v0.5.7` Release. Do not invent those values.

- Source / 源码: `NONE` (committed identity is a template)
- Public export / 公开源码树: pending clean-room export of the candidate SHA
- Native run / 三端原生任务: `NOT_RUN`
- Apple Silicon / Intel Mac / Windows x64: pending matching native builders

Live messaging evidence is tracked only in
[`docs/0.5.7/LIVE_IM_MATRIX.md`](0.5.7/LIVE_IM_MATRIX.md). Rows currently
`LIVE_NOT_RUN` are not claimed as supported in README, the website, or a
Release.

## English

Penglai 0.5.7 continues the 0.5.6 work of making visible settings complete a
real action, and adds nine-platform **connection entries** under one Messaging
plugin. Automatic Workspace memory, the Main-process Owner broker, Plugin
Center, and opaque `artifact:<uuid>` file handoff remain. Official DSH rc.2
conversation Turns still support text and images, not generic document blocks.

The first-run model test and first conversation still wait for the official
durable `turn/end`, use a bounded first-reply budget, and run in an official
per-Session no-tools scope.

### Messaging

Users see one page titled Messaging / 消息连接, not “Penglai IM”. Nine
platforms have a connect/enable card: Weixin, Feishu, DingTalk, WeCom, QQ,
Slack, Telegram, Discord, and WhatsApp. They are no longer described as a
roadmap list.

A platform is supported only with live evidence: real connect or authorize,
inbound private text, the bound official Workspace/Session, outbound reply,
restart restore, and safe logout/unbind/delete credentials. Image, file,
audio, Markdown, thread, and group flags stay false until that evidence
exists. Slack, Telegram, and Discord use official token or manifest flows and
do not fake QR. QQ is official Bot QR, not personal QQ login. WhatsApp is
experimental, community-protocol, default-off, and requires an explicit risk
acknowledgement. It is not WhatsApp Cloud API.

Weixin keeps Penglai iLink. Feishu keeps the official Lark SDK. Groups stay
Owner-gated and allowlisted.

### Owner, files, recovery

Office writes/exports/returns, Memory mutations, IM binding changes, Plugin
Center lifecycle operations, and persistent artifacts use the same
Main-process Owner broker. An approval is bound to the exact action, object,
Workspace, Session where applicable, destination, revision/digest, permissions,
and expiry. Renderer booleans and model-provided IDs are not proof. Approval
is completed only after the underlying write succeeds.

Profile seed and Plugin Center last-good use staging, validate, atomic swap,
and an independent immutable snapshot. A crash must not boot a half profile.

### Installation and upgrades

- `Penglai_0.5.7_macos_aarch64.dmg` — Apple Silicon, macOS 13+ (`darwin-aarch64`)
- `Penglai_0.5.7_macos_x64.dmg` — Intel Mac (`darwin-x86_64`)
- `Penglai_0.5.7_windows_x64_setup.exe` — Windows x64 (`win32-x86_64`)

Versions 0.5.1 through 0.5.6 can discover a later signed 0.5 line under
**Settings → Penglai → Updates** after `v0.5.7` is public. There is no silent
auto-update. Version 0.5.0 still requires a manual overlay. External Workspaces
and the `Penglai/0.5` data generation are preserved.

### Known limits

- Official DSH rc.2 conversation Turns support text and images, not generic
  document blocks.
- Live IM accounts, physical microphone/speaker behavior, and provider replies
  are separate live evidence and require the user's own credentials or device
  permission.
- macOS is ad-hoc signed and not notarized. Windows has no Authenticode.
  Gatekeeper or SmartScreen may warn.
- Penglai has no account, Penglai-operated telemetry backend, cloud memory
  sync, or cloud ASR/TTS.

## 中文

蓬莱 0.5.7 继续让设置页里的动作真正完成，并在唯一的「消息连接」插件下提供
九个平台的真实连接入口。不再把钉钉、企业微信、QQ、Slack、Telegram、Discord、
WhatsApp 写成路线图。公开“支持”声明只以 live 证据矩阵为准。

官方 DeepSeek Harness `0.1.1-rc.2` 仍是唯一 Agent 核心。办公与记忆默认启用；
消息、语音识别、语音生成、主动陪伴随包但默认关闭。WhatsApp 为实验性社区协议，
默认关闭，启用前必须明确风险确认。

升级入口仍是 **设置 → 蓬莱 → 更新**。不会静默自动升级。macOS 为 ad-hoc 且未公证；
Windows 没有 Authenticode。
