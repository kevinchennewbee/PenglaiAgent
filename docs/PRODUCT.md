# Penglai 0.6.5 development contract

## English

### 1. Product promise

Penglai is an installable desktop distribution of official DeepSeek Harness
(DSH). DSH is the only agent core and owns agents, models, tools, approvals,
Workspaces, Sessions, Turns, and the conversation UI. Penglai owns packaging,
first run, process supervision, local data boundaries, assisted updates,
uninstall, and a reviewed set of DSH plugins. It does not ship a second agent,
provider gateway, session store, or chat page.

Version 0.6.5 targets Apple Silicon, Windows x64, and UnionTech
UOS 20 `linux-loong64`. Intel Mac is excluded from this version. It consumes
official DSH `0.1.6-alpha.2` (307-package npm cohort). v0.6.3 remains the current
public download until immutable v0.6.5 GitHub Release bytes are published and
read back. A fresh
user brings a provider credential, selects an official model and Workspace,
receives a real first DSH reply, and then uses the official DSH Web
interface. Published 0.5.10, 0.5.11, 0.5.12, 0.6.0, 0.6.1 and 0.6.2 remain immutable.

### 2. Supported platforms

| Device | Exact installer |
| --- | --- |
| Apple Silicon, macOS 13+ | `Penglai_0.6.5_macos_aarch64.dmg` |
| Windows 10+ x64 | `Penglai_0.6.5_windows_x64_setup.exe` |
| UnionTech UOS 20 loong64 | `Penglai_0.6.5_uos_loong64.deb` |

The app contains its target Electron, Node, DSH closure, profile seed, bundled
plugins, licenses, and integrity metadata. It never falls back to a system Node,
pnpm, Python, ffmpeg, or DSH installation. Every support claim requires a build
and installed test on the matching native platform. Current 0.6.5 native
lifecycle is fresh install, restart, and default uninstall on Apple Silicon and
Windows. The older installed-upgrade journey is `OWNER_EXCLUDED`. UOS native
install/startup/function for 0.6.5 is `OWNER_POST_RELEASE`: the Owner tests
the published installer. That is not a native PASS.

### 3. Fresh-install capability set

| Surface | Fresh state | Product behavior |
| --- | --- | --- |
| Plugin Center | Active | Shows real DSH loader state and routes package operations through the exact official DSH alpha.2 plugin manager |
| Penglai Memory | Active | Automatic current-Workspace memory, explicit personal memory, authorised sources, provenance, and graph views |
| Mobile Messaging | Active | Bundled and enabled by default, with no account or channel connected automatically. Eight established first-party connectors plus optional macOS iMessage (nine adapter implementations). WeChat/Feishu keep native media. iMessage is private text, independently default off, and Darwin-only. Account connectivity is reported only with actual evidence; iMessage native live is `LIVE_NOT_RUN`. WhatsApp is excluded. |
| Speech Recognition | Disabled | Local SenseVoice transcription after explicit model installation and microphone action |
| Voice Generation | Disabled | Local MOSS-TTS preview, conversation Read, and supported channel audio |

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
untouched. Mnemon 0.2.8 is the only recall engine and is bundled per target.

### 6. Files and excluded document scope

Official DSH remains responsible for its own generic file Turn support. Penglai
0.6.5 does not provide or advertise LibreOffice, PDF conversion/preview,
document editing, or a Penglai Office plugin. Office/PDF, Budget, and Companion
are absent from the profile, catalog, runtime closure, installers, and product
acceptance. Penglai adds no DOM injection or second conversation engine to fill
that excluded scope.

### 7. Messaging

`@penglai/im` is the only messaging plugin. It owns bindings, deterministic
commands, causal routing, persistence, recovery, outbox, and adapter lifecycle.
Adapters cannot call a parallel agent or guess the current Workspace/Session.

Nine first-party adapters exist in 0.6.5. WeChat and Feishu keep native media.
Slack, Telegram, and Discord use official token/manifest flows and must not
fake QR. Optional macOS iMessage is private text, default off, Darwin-only, and
unsupported on Windows/UOS; native live evidence is `LIVE_NOT_RUN`. WhatsApp
is not displayed, supported, planned, or bundled. Binding, rebinding, and
removal require an Owner approval bound to the exact channel, account, peer,
Workspace, and Session.

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

One Main-process Owner broker serves Memory, IM, Plugin Center, and
persistent artifacts. Renderer booleans, model text, or UUID-shaped strings are
not authority. Approval binds the action and relevant object/scope/digest and is
consumed only after the real operation succeeds.

### 10. Data, updates, and uninstall

Penglai has no account, Penglai-operated telemetry backend, cloud memory sync,
or cloud ASR/TTS. Official DSH bundles a session-telemetry adapter and a dormant
DeepSeek OTLP endpoint. Penglai hard-disables that row after all profile patches,
so DSH constructs no SDK provider or upload pipeline in the owned desktop process.
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

0.6.5 succeeds only when one clean source SHA produces its exact three
installers, source/security/privacy gates pass, Mac and Windows installed
lifecycle evidence passes, the UOS package/ABI/runtime closure passes, and the
immutable ten-asset Release passes public byte-for-byte readback. Native UOS use
remains `OWNER_POST_RELEASE`. Credential-free gates do not establish an external model
reply or account delivery. Account-based results are recorded only when executed.
Normal functional tests apply; a two-hour installed soak is not required or pending.
This development authorization stops before native candidate work, so all three
installers, installed lifecycle checks, and public readback remain `NOT_RUN`.
The 0.6.3 to 0.6.5 installed upgrade is excluded by the Owner, so it is not
claimed; that is a recorded exclusion, not a missing result. Native UOS use
remains `OWNER_POST_RELEASE`.
See [the current acceptance delta](0.6.5/ACCEPTANCE_DELTA.md).

## 中文

### 1. 产品承诺

蓬莱是官方 DeepSeek Harness（DSH）的桌面发行版。DSH 是唯一 Agent 核心，拥有
Agent、模型、工具、审批、Workspace、Session、Turn 和会话 UI。蓬莱负责安装包、
首次引导、进程监管、本地数据边界、辅助升级、卸载和经过审核的 DSH 插件，不另造
Agent、模型网关、Session 存储或聊天页。

当前公开版本为 v0.6.3（十项附件不可变，公网逐字节回读已通过）。开发候选消费官方
DSH `0.1.6-alpha.2`（307 包），目标为 Apple 芯片、Windows x64，以及统信 UOS 20
`linux-loong64`（`Penglai_0.6.5_uos_loong64.deb`）。Intel Mac 不在本版发布。用户自备模型密钥，
选择 official 模型和 Workspace，收到第一条真实 DSH 回复后进入 official
DSH Web。原生生命周期要求 Apple 芯片与 Windows 全新安装、重启与默认卸载；
0.6.3 到 0.6.5 的真实安装版升级由 Owner 标记为 `OWNER_EXCLUDED`，不作为发布 PASS。
UOS 真机安装/启动/功能为 `OWNER_POST_RELEASE`。已发布的 0.5.10、0.5.11、0.5.12、0.6.0、0.6.1、0.6.2
保持不可变。

### 2. 全新安装

插件中心、蓬莱记忆和手机消息默认 active；消息账号与通道不会自动连接。语音识别和
语音生成的插件与受支持目标运行时随包但默认关闭，模型权重不随包。
LibreOffice、PDF/办公插件、预算与主动陪伴不进入 0.6.5。可选插件在 disabled、未配置、离线或缺少模型时必须保持惰性，不能
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

### 4. 文件与明确排除范围

official DSH 自己的 generic file Turn 仍由 DSH 负责。Penglai 0.6.5 不提供或宣传
LibreOffice、PDF 转换/预览、文档编辑或蓬莱办公插件；Office/PDF、预算与主动陪伴
不进入 profile、catalog、运行闭包、安装包或产品验收。Penglai 不用 DOM hack 或
第二套会话引擎补齐这些明确排除的范围。

### 5. IM 与语音

`@penglai/im` 是唯一消息插件。0.6.5 提供九个第一方 adapter。微信和飞书保留原生
媒体。Slack、Telegram、Discord 走官方 Token/Manifest，禁止伪装扫码。可选 macOS
iMessage 仅私聊文本、默认关闭、只在 Darwin 可用，Windows/UOS 为不支持；真机 live
记 `LIVE_NOT_RUN`。WhatsApp 不展示、不支持、不列为规划，也不捆绑运行时。

ASR/TTS 代码随包，大模型权重只在用户明确操作后下载。麦克风必须由当前用户手势触发，
只申请 audio；相机、视频、蓝牙和无关 capture 权限不进入产品声明。设置页试听与会话
Read 共用播放状态机，正确处理播放、停止、结束、错误、卡住和资源释放；Read 朗读原文，
不是翻译功能。

### 6. 插件中心、隐私与升级

插件中心只接受不可变签名目录，逐项验证包身份、摘要、DSH 兼容、平台、权限、迁移和
回滚。official loader inventory 才是 installed/active 的事实。仓库、文档、问题链接
只能来自签名 HTTPS 值，用户确认后由 Electron Main 外部打开。

记忆、IM、插件中心和持久附件共用 Main Owner Broker。renderer 布尔值、模型
文字或长得像 UUID 的字符串都不是授权；确认与具体动作、对象、scope、摘要绑定，并在
真实操作成功后才消费。

蓬莱没有账号、蓬莱运营的遥测后端、云记忆同步或云 ASR/TTS。official DSH 自带的
session-telemetry adapter 也包含一个休眠的 DeepSeek OTLP 地址。蓬莱会在所有 profile
patch 之后硬性禁用该行，因此 owned DSH 进程不会创建 SDK provider 或上传管线。诊断和
证据不含密钥、二维码、聊天正文、账号身份、私有路径、记忆正文、转写和私有媒体。
0.5.1 以后使用签名辅助升级，不静默；
0.5.0 仍需手动覆盖。默认卸载保留用户数据，完整删除必须按精确类别确认，不能删除
Workspace、授权源、home/root、旧代数据或越界链接。

macOS 为 ad-hoc 签名且未公证；Windows 没有 Authenticode。0.6.5 只有在同一干净
源码 SHA 的三个精确安装包、Mac/Windows 安装生命周期、UOS 包/ABI/运行闭包、
隐私门禁和不可变十资产公网回读全部成立，且当前 README 与双语官网同步后，才算
完成正常发布；UOS 真机功能保持 `OWNER_POST_RELEASE`。无凭据测试不能证明真实模型
Turn 或账号消息送达；账号验证只记录实际执行结果。两小时测试不运行，也不是待办。
