# Penglai 0.5.6 release notes

Trust tier: `community-verified`. Official DeepSeek Harness `0.1.1-rc.2`
remains the only agent core. This release is not silent auto-update.

## English

Penglai 0.5.6 focuses on the places where a feature could appear present in a
settings page without completing the real user action: automatic memory,
owner-approved writes, file handoff, speech playback, and messaging availability.

### Memory now works without a magic phrase

Fresh profiles use smart automatic Workspace memory. At the end of an official
DSH Turn, a separate no-tools official Agent uses the current provider/model to
propose closed, host-validated memory candidates. Safe project facts can be
stored in the current Workspace automatically. Secrets, sensitive material,
prompt-injection-like text, malformed output, and personal/global promotion are
never auto-saved.

Before a later model step, Penglai recalls confirmed records from the exact
Workspace plus personal facts that the user explicitly accepted. It never reads
another Workspace. Users can switch memory off, ask to review candidates, or
keep smart Workspace organization. Personal memory, source revocation,
forgetting, import, correction, and reusable SOP changes keep visible Owner
controls.

### Owner confirmation is tied to the action that really happened

Office writes/exports/returns, Memory mutations, IM binding changes, Plugin
Center lifecycle operations, and persistent artifacts use the same
Main-process Owner broker. An approval is bound to the exact action, object,
Workspace, Session where applicable, destination, revision/digest, permissions,
and expiry. Renderer booleans and model-provided IDs are not proof.

Approval is completed only after the underlying write, delivery, profile
transaction, rollback, or deletion succeeds. A failed operation cannot consume
an approval as if the requested result occurred.

### Files, voice, and Plugin Center

Office and Mobile Messaging now pass admitted documents/audio through opaque
`artifact:<uuid>` references. The same bytes in different Workspaces remain
separate bindings, and legacy digest references are accepted only when unique.
Inbound IM bytes are attached after the official Turn is accepted; a failed
artifact callback cannot submit the Turn twice.

MOSS-TTS Settings preview and conversation Read now share one playback state
machine. Buttons reflect play/stop/end/error/stalled state, stale playback is
cancelled, and temporary URLs are released. Read speaks the original assistant
message; it does not translate it.

Plugin Center cards can expose reviewed repository, documentation, and issue
links. Only signed HTTPS values are accepted, the user confirms the destination,
and Electron Main opens it outside the app.

### Honest messaging availability

Weixin and Feishu are the only live messaging adapters in 0.5.6. DingTalk,
WeCom, QQ, Slack, Telegram, Discord, and WhatsApp are listed as roadmap context
only and have no Connect action. Penglai does not manufacture QR codes for
platforms that do not offer the required flow. WhatsApp remains explicitly
default-off with community-protocol and account-risk wording.

### Installation and upgrades

- `Penglai_0.5.6_macos_aarch64.dmg` — Apple Silicon, macOS 13+ (`darwin-aarch64`)
- `Penglai_0.5.6_macos_x64.dmg` — Intel Mac (`darwin-x86_64`)
- `Penglai_0.5.6_windows_x64_setup.exe` — Windows x64 (`win32-x86_64`)

Versions 0.5.1 through 0.5.5 can discover the signed 0.5.6 Release under
**Settings → Penglai → Updates**, or users may install a same-platform overlay.
Version 0.5.0 predates the production updater trust path and still requires a
manual overlay. External Workspaces and the `Penglai/0.5` data generation are
preserved.

### Known limits

- Official DSH rc.2 conversation Turns support text and images, not generic document blocks.
  Ordinary composer DOCX/XLSX/PPTX/PDF attachment is therefore
  not claimed. Documents received through live IM and Workspace files selected
  through Penglai Office use the scoped artifact path instead.
- Real Weixin/Feishu accounts, physical microphone/speaker behavior, and provider
  replies are separate live evidence and require the user's own credentials or
  device permission.
- macOS is ad-hoc signed and not notarized. Windows has no Authenticode.
  Gatekeeper or SmartScreen may warn. Penglai Ed25519 signatures protect updater
  and plugin bytes but are not Apple or Microsoft publisher identity.
- Penglai has no account, Penglai-operated telemetry backend, cloud memory
  sync, or cloud ASR/TTS. Official DSH bundles a session-telemetry adapter and a
  dormant DeepSeek OTLP endpoint. Penglai hard-disables that row after profile
  patches, so the owned DSH process constructs no SDK provider or upload
  pipeline. Model calls still send the task context to the provider selected by
  the user.

## 中文

蓬莱 0.5.6 重点修复“设置页看起来有功能，但真实动作没有走完”的问题：自动记忆、
Owner 确认、文件交接、语音播放和 IM 平台可用性。

### 记忆不再依赖一句特殊口令

全新 profile 默认使用“智能整理 Workspace”。每个 official DSH Turn 结束后，蓬莱会
创建一个禁用全部工具的 official Agent，沿用当前供应商和模型，产出封闭格式的记忆
候选，再由 Host 校验。安全的项目事实可以自动保存到当前 Workspace；密钥、敏感信息、
类似提示词注入的内容、格式错误输出，以及个人/全局记忆都不会自动保存。

后续模型步骤会召回当前 Workspace 已确认记录，以及用户明确保存的个人记忆；绝不会
读取另一个 Workspace。用户也可以关闭记忆，或改成先看候选再决定。个人记忆、撤销
资料源、遗忘、导入、更正和 SOP 仍然保留可见的 Owner 确认。

### 确认与真实动作绑定

办公写入/导出/回传、记忆修改、IM 绑定、插件中心事务和持久附件统一经过 Main 进程
Owner Broker。确认会绑定具体动作、对象、Workspace、必要时的 Session、目标位置、
revision/摘要、权限和有效期。renderer 的布尔值或模型给出的 ID 都不能当作授权。

只有底层写入、发送、profile 事务、回滚或删除真的成功后，确认才会完成。动作失败时，
不会把确认误记成已执行。

### 文件、语音和插件中心

办公与手机消息使用不透明的 `artifact:<uuid>` 传递文档和音频。同一份字节进入不同
Workspace 时仍是不同绑定；旧 digest 引用只有在唯一时才兼容。IM 收到的文件会在
official Turn 接受后附加，附件回调失败不会重复提交 Turn。

MOSS-TTS 的设置页试听和会话 Read 共用一个播放状态机。播放、停止、结束、错误、卡住
都会正确反馈，旧播放会取消，临时 URL 会释放。Read 朗读原始回复，不负责翻译。

插件卡可以显示经过审核的仓库、文档和问题链接。只接受签名目录里的 HTTPS 地址，
用户确认目标后由 Electron Main 在外部打开。

### IM 平台不再制造“好像能连”的错觉

0.5.6 真正可连接的 adapter 只有微信和飞书。钉钉、企业微信、QQ、Slack、Telegram、
Discord、WhatsApp 只作为路线图展示，没有“连接”按钮，也不能绑定或发送。平台没有
真实扫码协议时，蓬莱不会伪造二维码。WhatsApp 继续默认关闭，并明确标注社区协议与
账号风险。

### 安装与升级

- `Penglai_0.5.6_macos_aarch64.dmg`：Apple 芯片，macOS 13+
- `Penglai_0.5.6_macos_x64.dmg`：Intel Mac
- `Penglai_0.5.6_windows_x64_setup.exe`：Windows x64

0.5.1 到 0.5.5 可以从 **设置 → 蓬莱 → 更新** 发现签名的 0.5.6，也可以手动覆盖
同平台安装包。0.5.0 早于生产升级信任链，仍需手动覆盖。外部 Workspace 和
`Penglai/0.5` 数据代际会保留。

### 已知限制

- official DSH rc.2 的会话 Turn 只支持文字和图片，没有通用文档 block，因此 0.5.6
  不宣称会话输入框可直接发送 DOCX/XLSX/PPTX/PDF。微信/飞书收到的文件，以及用户从
  蓬莱办公选择的 Workspace 文件，走受 scope 约束的 artifact 管线。
- 真实微信/飞书账号、物理麦克风/扬声器、供应商回复属于单独 live 证据，需要用户自己
  的凭据或设备权限。
- macOS 为 ad-hoc 签名且未公证；Windows 没有 Authenticode，Gatekeeper 或
  SmartScreen 可能提示。蓬莱 Ed25519 签名保护升级和插件字节，不代表 Apple 或
  Microsoft 发布者身份。
- 蓬莱没有账号、蓬莱运营的遥测后端、云记忆同步或云 ASR/TTS。official DSH 自带的
  session-telemetry adapter 也包含一个休眠的 DeepSeek OTLP 地址。蓬莱会在所有
  profile patch 之后硬性禁用该行，因此 owned DSH 不会创建 SDK provider 或上传管线。
  模型调用仍会把完成任务所需上下文发给用户选择的供应商。
