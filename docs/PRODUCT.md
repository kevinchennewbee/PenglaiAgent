# Penglai 0.5.6 product contract

## English

### 1. Product promise

Penglai is an installable desktop distribution of official DeepSeek Harness
(DSH). DSH is the only agent core and owns agents, models, tools, approvals,
Workspaces, Sessions, Turns, and the conversation UI. Penglai owns packaging,
first run, process supervision, local data boundaries, assisted updates,
uninstall, and a reviewed set of DSH plugins. It does not ship a second agent,
provider gateway, session store, or chat page.

Version 0.5.6 targets Apple Silicon, Intel Mac, and Windows x64 with official DSH
`0.1.1-rc.2`. A fresh user brings a provider credential, selects an official
model and Workspace, receives a real first DSH reply, and then uses the official
DSH Web interface.

### 2. Supported platforms

| Device | Exact installer |
| --- | --- |
| Apple Silicon, macOS 13+ | `Penglai_0.5.6_macos_aarch64.dmg` |
| Intel Mac, macOS 13+ | `Penglai_0.5.6_macos_x64.dmg` |
| Windows 10+ x64 | `Penglai_0.5.6_windows_x64_setup.exe` |

The app contains its target Electron, Node, DSH closure, profile seed, bundled
plugins, licenses, and integrity metadata. It never falls back to a system Node,
pnpm, Python, ffmpeg, or DSH installation. Every support claim requires a build
and installed test on the matching native platform.

### 3. Fresh-install capability set

| Surface | Fresh state | Product behavior |
| --- | --- | --- |
| Plugin Center | Active | Shows real DSH loader state and signed catalog transactions |
| Penglai Office | Active | Inspect, create, plan edits, preview, commit, export/return, and undo DOCX/XLSX/PPTX/PDF |
| Penglai Memory | Active | Automatic current-Workspace memory, explicit personal memory, authorised sources, provenance, and graph views |
| Mobile Messaging | Disabled | Live Weixin and Feishu adapters only |
| Speech Recognition | Disabled | Local SenseVoice transcription after explicit model installation and microphone action |
| Voice Generation | Disabled | Local MOSS-TTS preview, conversation Read, and supported channel audio |
| Companion | Disabled | Opt-in scheduled contact with quiet hours, budget, and an exact IM route |

Optional plugins must remain inert when disabled, unconfigured, offline, or
missing model weights. Their failure cannot block ordinary DSH conversation.

### 4. First run

The pre-DSH wizard is a temporary bootstrap surface, not a second product UI. It
covers language, privacy, the official provider/model catalog, a real credential
test, an official Workspace, and the first official DSH Turn. It supports Back,
retry after a failed credential, restart/resume, and rejection of application or
data directories as Workspaces. Completion means the provider returned a real
first reply.

Credentials are stored through the official DSH credentials-local seam in an
app-private YAML file. The renderer cannot read values back. File permissions or
the current-user Windows ACL reduce accidental exposure but are not Keychain,
hardware-backed storage, or protection from another process running as the same
OS user.

### 5. Penglai Memory

The fresh mode is smart automatic Workspace memory. On official `turn/end`, a
separate official Agent uses the current provider/model with all tools denied.
Its output is parsed by a closed host schema and local risk policy. Safe project
facts may be persisted in the exact current Workspace. Secrets, sensitive text,
instruction-injection patterns, malformed output, and personal/global promotion
are skipped without failing the user Turn.

Before a later official model step, confirmed records from the current Workspace
and explicitly accepted personal records can be recalled within fixed item/token
limits. Another Workspace is never searched or selected implicitly. Users can
choose Off, Review first, or Smart Workspace organization.

Personal memory, forgetting, correction, import, authorised-source revoke, and
SOP promotion use action-specific Owner approval. Source indexing never modifies
the original files; revoke removes the derived index and leaves the source
untouched. Mnemon 0.2.4 is the only recall engine and is bundled per target.

### 6. Office and artifacts

Office exposes a closed typed operation set. A model cannot invent a host path,
run macros, or silently write. Input/output values are host-issued opaque
`artifact:<uuid>` references bound to Workspace and Session scope. Intake checks
magic/type, size, symlink/device/directory escape, encrypted or macro-bearing
content, executables, nested archives, and quota. Identical bytes in two
Workspaces remain two bindings.

Write, export, return, and undo approval binds the exact job, source/result
digest, destination, Workspace, Session, and revision. Approval completes only
after the mutation or delivery succeeds.

Official DSH rc.2 conversation Turns support text and images, not generic file
blocks. Penglai therefore does not claim ordinary composer DOCX/XLSX/PPTX/PDF
attachments. Official images continue through the official image store. Files
received through live IM or selected through Office use the scoped artifact
service without DOM injection or a second conversation engine.

### 7. Messaging

`@penglai/im` is the only messaging plugin. It owns bindings, deterministic
commands, causal routing, persistence, recovery, outbox, and adapter lifecycle.
Adapters cannot call a parallel agent or guess the current Workspace/Session.

Weixin and Feishu are the only live adapters in 0.5.6. Text, supported images,
files, and audio enter the bound official DSH Session. Inbound bytes are attached
only after official Turn acceptance; callback failure does not duplicate a Turn.
Binding/rebinding/removal requires an Owner approval bound to the exact channel,
account, peer, Workspace, and Session.

DingTalk, WeCom, QQ, Slack, Telegram, Discord, and WhatsApp are roadmap entries
only. They have no Connect action and cannot bind or send. Penglai does not fake
QR availability. WhatsApp is explicitly community-protocol, account-risk, and
default-off.

### 8. Local voice

ASR and TTS code ships in every installer; large pinned weights download only
after explicit user action. The desktop requests audio input only after a current
gesture. Camera, video, Bluetooth, and unrelated capture permissions are denied
or absent from packaged metadata.

Settings preview and conversation Read use one playback controller. Play, stop,
ended, error, stalled, cancellation, latest-wins, and temporary URL cleanup are
observable states. Read speaks the original assistant response; translation is
outside this feature.

### 9. Plugin Center and Owner authority

Plugin Center trusts only immutable signed catalog assets whose identity,
archive digest, DSH compatibility, platform, permissions, migration, and
rollback checks pass. UI state is never proof of installation or health; the
official loader inventory is authoritative.

Repository, documentation, and issue links are signed HTTPS catalog values.
Electron Main validates and opens them only after user confirmation. Arbitrary
npm names, Git repositories, local paths, and download URLs are not accepted.

One Main-process Owner broker serves Office, Memory, IM, Plugin Center, and
persistent artifacts. Renderer booleans, model text, or UUID-shaped strings are
not authority. Approval binds the action and relevant object/scope/digest and is
consumed only after the real operation succeeds.

### 10. Data, updates, and uninstall

Penglai has no account, telemetry service, cloud memory sync, or cloud ASR/TTS.
Model calls still send the context required for a task to the provider selected
by the user. Diagnostics and evidence exclude secrets, QR data, chat bodies,
account identities, private paths, memory bodies, transcripts, and private media.

Versions 0.5.1 and later use a signed assisted update: discover an immutable
Release, verify identity/hash/signature/target, download after user action, and
hand off to the OS installer. Updates are not silent. Version 0.5.0 requires a
manual overlay. External Workspaces and the `Penglai/0.5` data generation are
preserved.

Default uninstall removes the application and cache while preserving user data.
Complete delete uses an exact category plan and a one-shot capability. It must
never recursively delete a Workspace, authorised source, home/root, legacy
generation, symlink, junction, or reparse escape.

### 11. Trust tier and success condition

macOS is ad-hoc signed and not notarized. Windows has no Authenticode.
Gatekeeper or SmartScreen may warn. Penglai Ed25519 signatures protect updater
and plugin bytes but do not provide Apple or Microsoft publisher identity.

0.5.6 succeeds only when one clean source SHA produces all three native
installers, source/security/privacy gates pass, installed evidence exists on
each matching runner, the Apple Silicon provider path receives a real first
Turn, and the immutable ten-asset Release passes public byte-for-byte readback.

## 中文

### 1. 产品承诺

蓬莱是官方 DeepSeek Harness（DSH）的桌面发行版。DSH 是唯一 Agent 核心，拥有
Agent、模型、工具、审批、Workspace、Session、Turn 和会话 UI。蓬莱负责安装包、
首次引导、进程监管、本地数据边界、辅助升级、卸载和经过审核的 DSH 插件，不另造
Agent、模型网关、Session 存储或聊天页。

0.5.6 固定 DSH `0.1.1-rc.2`，支持 Apple 芯片、Intel Mac 和 Windows x64。
用户自备模型密钥，选择 official 模型和 Workspace，收到第一条真实 DSH 回复后进入
official DSH Web。

### 2. 全新安装

插件中心、蓬莱办公和蓬莱记忆默认 active；手机消息、语音识别、语音生成、主动陪伴
随包但默认关闭。可选插件在 disabled、未配置、离线或缺少模型时必须保持惰性，不能
阻塞普通 DSH 会话。

首次向导只负责语言、隐私、official 模型、真实密钥测试、Workspace 和第一条 official
Turn。它支持返回、重试、重启续接和非法 Workspace 拒绝；完成条件是模型真实回复，
不是健康接口返回。

### 3. 记忆

全新 profile 默认“智能整理 Workspace”。official Turn 结束后，一个禁用全部工具的
official Agent 沿用当前供应商和模型，输出由 Host 封闭校验。安全项目事实可以自动
写入 exact Workspace；密钥、敏感内容、类似提示词注入、错误格式和个人/全局提升全部
跳过，不影响用户 Turn。

后续步骤只召回当前 Workspace 已确认记录和用户明确保存的个人记忆，绝不跨 Workspace。
用户可选关闭、先审阅或智能整理。个人记忆、遗忘、更正、导入、资料源撤销和 SOP 都
需要对应 Owner 确认。资料索引不修改源文件；撤销只删派生索引。

### 4. 办公、附件与确认

办公只提供封闭 typed operation。模型不能编造主机路径、运行宏或静默写入。文档和
音频使用绑定 Workspace/Session 的不透明 `artifact:<uuid>`；magic/type、大小、
symlink/device/directory、加密/宏、可执行文件、嵌套压缩和 scope 都由 Host 校验。

写入、导出、回传、撤销确认会绑定 job、摘要、目标、Workspace、Session 和 revision，
只有真实动作成功后才完成。official DSH rc.2 会话 Turn 只支持文字和图片，因此 0.5.6
不宣称输入框能直接发普通 DOCX/XLSX/PPTX/PDF。official 图片不变；IM 收到的文件或
蓬莱办公选择的 Workspace 文件走 artifact service，不做 DOM hack 或第二会话引擎。

### 5. IM 与语音

`@penglai/im` 是唯一消息插件。0.5.6 只有微信、飞书是 live adapter。钉钉、企业微信、
QQ、Slack、Telegram、Discord、WhatsApp 只显示路线图，没有连接按钮，也不能绑定或
发送；没有真实扫码协议时不会伪造二维码。WhatsApp 明确标注社区协议和账号风险。

ASR/TTS 代码随包，大模型权重只在用户明确操作后下载。麦克风必须由当前用户手势触发，
只申请 audio；相机、视频、蓝牙和无关 capture 权限不进入产品声明。设置页试听与会话
Read 共用播放状态机，正确处理播放、停止、结束、错误、卡住和资源释放；Read 朗读原文，
不是翻译功能。

### 6. 插件中心、隐私与升级

插件中心只接受不可变签名目录，逐项验证包身份、摘要、DSH 兼容、平台、权限、迁移和
回滚。official loader inventory 才是 installed/active 的事实。仓库、文档、问题链接
只能来自签名 HTTPS 值，用户确认后由 Electron Main 外部打开。

办公、记忆、IM、插件中心和持久附件共用 Main Owner Broker。renderer 布尔值、模型
文字或长得像 UUID 的字符串都不是授权；确认与具体动作、对象、scope、摘要绑定，并在
真实操作成功后才消费。

蓬莱没有账号、遥测、云记忆同步或云 ASR/TTS。诊断和证据不含密钥、二维码、聊天正文、
账号身份、私有路径、记忆正文、转写和私有媒体。0.5.1 以后使用签名辅助升级，不静默；
0.5.0 仍需手动覆盖。默认卸载保留用户数据，完整删除必须按精确类别确认，不能删除
Workspace、授权源、home/root、旧代数据或越界链接。

macOS 为 ad-hoc 签名且未公证；Windows 没有 Authenticode。0.5.6 只有在同一干净
源码 SHA 的三端原生包、三端安装证据、真实模型 Turn、隐私门禁和不可变十资产公网
回读全部成立时，才算发布完成。
