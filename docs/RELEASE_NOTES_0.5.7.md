# Penglai 0.5.7 release notes

Trust tier: `community-verified`. Official DeepSeek Harness `0.1.1-rc.2`
remains the only agent core. This release is not silent auto-update.

## Exact release / 精确发布

The immutable [`v0.5.7` Release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.7)
was built from one reviewed source SHA and passed public byte and signature
readback.

- Source / 源码: `ce01d4dea59af72422071e357760a040f19b8e3d`
- Public export / 公开源码树: `8e0d6f27d54bef459e26c812453a968d19ab23c0c86b28dc2b8f1b5c947b3d67`
- Native run / 三端原生任务: [33067739020](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33067739020)
- Public readback / 公网回读: [33071811058](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33071811058)
- Release set / 发布文件: exactly 10 immutable assets, including a 1,212-component SBOM

## English

Penglai 0.5.7 continues the 0.5.6 work of making visible settings complete a
real action, and adds eight platform connectors under one Messaging
plugin. Automatic Workspace memory, the Main-process Owner broker, Plugin
Center, and opaque `artifact:<uuid>` file handoff remain. Official DSH rc.2
conversation Turns still support text and images, not generic document blocks.

The first-run model test and first conversation still wait for the official
durable `turn/end`, use a bounded first-reply budget, and run in an official
per-Session no-tools scope.

### Messaging

Users see one page titled Messaging / 消息连接, not “Penglai IM”. Eight
platforms have a connect/enable card: Weixin, Feishu, DingTalk, WeCom, QQ,
Slack, Telegram, and Discord.

A platform is supported only with live evidence: real connect or authorize,
inbound private text, the bound official Workspace/Session, outbound reply,
restart restore, and safe logout/unbind/delete credentials. Image, file,
audio, Markdown, thread, and group flags stay false until that evidence
exists. Slack, Telegram, and Discord use official token or manifest flows and
do not fake QR. QQ is official Bot QR, not personal QQ login. The WhatsApp
community runtime is not bundled in 0.5.7.

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

| Target | Installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon, macOS 13+ | [`Penglai_0.5.7_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_macos_aarch64.dmg) | 474,383,101 | `bfbaec4b9f4b627abd41e793abae6b68246d0f00d8e9c5ca003d079e1e3667c8` |
| Intel Mac | [`Penglai_0.5.7_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_macos_x64.dmg) | 401,056,681 | `ab696fc92a2b1af538eed6008c8389ddc945d9dce39d85b16053cf60d8e2655e` |
| Windows x64 | [`Penglai_0.5.7_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_windows_x64_setup.exe) | 355,918,104 | `cb4687e621d951d6d8ba4cf8428f4723f35c9827fa70ac542d4d3d928d5d882a` |

Versions 0.5.1 through 0.5.6 can discover a later signed 0.5 line under
**Settings → Penglai → Updates** after `v0.5.7` is public. There is no silent
auto-update. Version 0.5.0 still requires a manual overlay. External Workspaces
and the `Penglai/0.5` data generation are preserved.

### Known limits

- Official DSH rc.2 conversation Turns support text and images, not generic
  document blocks.
- macOS is ad-hoc signed and not notarized. Windows has no Authenticode.
  Gatekeeper or SmartScreen may warn.
- Penglai has no account, Penglai-operated telemetry backend, cloud memory
  sync, or cloud ASR/TTS.

## 中文

蓬莱 0.5.7 继续让设置页里的动作真正完成，并在唯一的「消息连接」插件下提供
八个平台的连接入口：微信、飞书、钉钉、企业微信、QQ、Slack、Telegram、Discord。

官方 DeepSeek Harness `0.1.1-rc.2` 仍是唯一 Agent 核心。办公与记忆默认启用；
消息、语音识别、语音生成、主动陪伴随包但默认关闭。0.5.7 不捆绑 WhatsApp
社区协议 runtime。

升级入口仍是 **设置 → 蓬莱 → 更新**。不会静默自动升级。macOS 为 ad-hoc 且未公证；
Windows 没有 Authenticode。

### 已知限制

- 官方 DSH rc.2 会话 Turn 支持文字和图片，不支持通用文档块。
- 蓬莱不提供账号体系、蓬莱运营的遥测后端、云端记忆同步或云端 ASR/TTS。
