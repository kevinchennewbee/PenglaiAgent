# Penglai 0.5.7 architecture

## English

### 1. Composition and authority

```text
Penglai.app / Penglai.exe
├─ Electron distribution shell
│  ├─ bootstrap, recovery, secure loopback proxy, process supervision
│  ├─ Owner approval broker, OS permission broker, updater, uninstall
│  └─ embedded target Node + pinned official DSH closure
└─ official DSH host + official DSH Web
   ├─ Agent / model / tool / approval / Workspace / Session / Turn
   ├─ credentials-local / settings / loader / inventory / client modules
   └─ Penglai DSH plugins
      ├─ plugin-center
      ├─ office ───────────────┐
      ├─ memory + Mnemon       ├─ scoped Artifact Service / Owner Broker
      ├─ im ─ Weixin / Feishu ┘
      ├─ asr / moss-tts
      └─ companion / hidden budget control / hidden conformance fixture
```

Official DSH is the single runtime authority. Penglai does not own a second
provider registry, agent loop, Workspace/Session store, tool executor, approval
system, or conversation renderer. The bootstrap wizard disappears after
completion; the long-lived main window is official DSH Web with DSH client
modules and settings sections.

### 2. Process and trust boundaries

#### Electron Main

- resolves read-only bundle resources and the platform-specific app-private data
  root;
- starts embedded Node with an absolute official DSH entrypoint and no system
  PATH fallback;
- owns the DSH process tree, restart budget, shutdown, orphan cleanup, splash,
  recovery, and authenticated loopback proxy;
- owns OS dialogs, external-link opening, microphone permission, updater launch,
  uninstall, and the Owner approval broker; and
- enforces `contextIsolation`, sandboxing, disabled Node integration, narrow
  navigation/window-open policy, Electron fuse policy, and target/architecture
  identity.

#### Official DSH host

- owns agents, models, tools, approval semantics, Workspaces, Sessions, Turns,
  credentials, settings, loader inventory, and client module composition;
- loads Penglai first-party plugins through official DSH/Cordis contracts; and
- provides the official events used by Memory (`turn/end`, `agent/pre-step`), IM
  Turn submission, Office tools, and settings surfaces.

#### Renderer

- receives only narrow preload methods and typed DSH Remote services;
- cannot read filesystem paths, environment, credential values, signing keys,
  raw databases, arbitrary IPC, or OS permissions; and
- can propose an Owner action but cannot approve or fabricate authority.

#### External systems

Provider APIs, GitHub Releases, Weixin, Feishu, downloaded models, plugin
archives, office documents, memory source documents, and all inbound messages
are untrusted inputs. They pass scheme/host, size, type, signature, identity,
scope, dedupe, and retention checks before use.

### 3. App-private data layout

The logical data generation is `Penglai/0.5`, resolved from Electron's platform
paths rather than a hard-coded home directory.

```text
<Penglai 0.5 user data>/
├─ release/             updater ledger, journals, current identity
├─ dsh-home/            official settings, profile, credentials, plugins
├─ owner/               approval broker state and completed-action ledger
├─ artifacts/           scoped CAS, bindings, staging, retention index
├─ im/                  SQLite, adapter state, inbox/outbox, bindings
├─ memory/              candidates, confirmed records, Mnemon indexes, sources
├─ office/              jobs, previews, backups, exports
├─ voice/               installed models and short-lived media
├─ companion/           schedules and bounded audit metadata
├─ diagnostics/         redacted structured diagnostics
├─ cache/
└─ uninstall/           exact deletion capabilities and journals
```

The bundle is read-only. Runtime files never write into the application. The
official credentials YAML contains secrets; other stores keep credential refs
or non-secret descriptors. Diagnostics and evidence exclude bodies, secrets,
QR payloads, account identity, full local paths, filenames from private sources,
memory text, transcripts, and private media.

macOS uses 0700/0600 for relevant directories/files. Windows applies a
current-user ACL and rejects junction/reparse escape. These are filesystem
controls, not hardware-backed secret isolation.

### 4. Bootstrap state machine

```text
WELCOME
  → PRIVACY_ACCEPTED
  → APPEARANCE_AND_LOCALE_SET
  → PROVIDER_SELECTED
  → CREDENTIAL_CONFIGURED
  → MODEL_TEST_PASSED
  → DEFAULT_MODEL_SET
  → WORKSPACE_READY
  → CORE_READY
  → FIRST_OFFICIAL_TURN
  → COMPLETE
```

The state ledger is app-private and resumable. Back/retry changes only the
allowed suffix. Credential failure cannot strand the user. Workspace validation
rejects application/data roots and unsafe aliases. `COMPLETE` is written only
after a real official DSH reply and a successful switch to official DSH Web.

### 5. Profile composition

Fresh profile invariants:

- official DSH `0.1.1-rc.2` is pinned with exact npm integrity and source tag;
- Plugin Center, Office, and Memory are installed and active;
- IM, ASR, MOSS-TTS, and Companion are present in the installer but disabled;
- the reference fixture and budget control are internal/hidden; and
- old `@penglai/context` is not loaded; migration may import only its authorised
  data after preview and schema checks.

Plugin Center updates use a lock, staging directory, exact catalog/package
identity, signature/digest/permission/compatibility checks, versioned profile
patch, atomic switch, official loader inventory readback, and rollback. Required
plugins cannot be disabled. Optional plugin failure cannot block DSH.

### 6. Owner approval broker

Renderer or plugin code first proposes a closed action. Electron Main displays
the human-readable action/object/scope/destination. An approval receipt is
short-lived and bound to:

- plugin and action enum;
- object/job/binding/artifact identity;
- Workspace and Session where applicable;
- source/result/destination/permission digest and expected revision; and
- expiry and one-time reservation state.

The host revalidates the receipt before mutation. A reservation prevents replay
while work is in flight. Completion is recorded only after the actual write,
send, profile transaction, rollback, revoke, or delete succeeds. Denial, expiry,
mutation, scope drift, failed operation, and replay fail closed.

### 7. Artifact Service and Office

Artifact intake accepts bytes or a user/host-selected path and returns an opaque
`ArtifactRefV1` whose ID is `artifact:<uuid>`. The binding row contains exact
Workspace/Session/Turn scope, media type, size, content SHA-256, original label,
retention, and CAS identity. The ID itself is not a filesystem path or content
hash. Identical CAS bytes can back multiple isolated bindings.

Path intake uses no-follow semantics and refuses directories, devices, unsafe
links, type/magic mismatch, macro/encrypted/executable content, nested archives,
and quota violations. Read revalidates scope. Persistence requires Owner
approval; expiry/GC removes bindings and unreferenced CAS bytes.

Office jobs freeze source/result digests and preview revision. Commit, export,
return, and undo use the Owner broker. Destination becomes immutable after the
first commit. Backup identity includes operation, revision, and source digest.
The approval is completed after the output mutation or IM return, never before.

Official DSH rc.2 has text/image prompt parts only. Generic composer files are
therefore an explicit upstream boundary. Penglai uses official image storage for
images and the Artifact Service for Office/IM consumers without adding a second
Turn representation.

### 8. Memory pipeline

```text
official turn/end
  → no-tools official curator Agent (same provider/model context)
  → closed JSON parse + local risk/sensitivity/injection policy
  → candidate store
  → safe current-Workspace auto-save OR visible review

official agent/pre-step
  → current Workspace confirmed records
  + explicitly accepted personal records
  → bounded recall block
```

Curator failure is fail-open for the user's Turn and creates no partial accepted
memory. The model's confidence does not override local policy. Candidates never
enter recall before acceptance/auto-save. Personal/global scope is not inferred.
Conflict, rejection negatives, tombstones, correction, provenance, export/import,
and source revocation are durable and scope checked.

Mnemon is the only recall index engine. Authorised sources store descriptors and
derived indexes only. Source revoke is proposed in the renderer, approved by
Main, revalidated by the host against a hashed root, then removes derived indexes
without touching source files.

### 9. IM architecture

`@penglai/im` owns one adapter registry, durable inbox/outbox, bindings,
deterministic commands, correlation, causal routing, recovery, and diagnostics.
`LIVE_CHANNEL_IDS` is evidence-gated. Weixin and Feishu retain their distributed
adapter and migration paths from 0.5.6; that source/runtime continuity is not a
substitute for evidence bound to a later installed release.
The other six distributed platforms receive adapters in 0.5.7 and join
`LIVE_CHANNEL_IDS` only after acceptance. The user-facing surface exposes eight
connection actions plus a disabled WhatsApp compatibility card.

Inbound sequence:

1. validate channel/account/peer identity, schema, type, size, allowlist, and
   message/event dedupe;
2. persist durable inbox state;
3. resolve an explicit binding to exact Workspace/Session;
4. consume deterministic commands before the model;
5. submit one official DSH Turn;
6. after acceptance, admit supported file/audio bytes with the exact route and
   Turn scope; callback failure is recorded but never resubmits the Turn;
7. correlate the durable final and enqueue outbound to the original route.

Binding/rebinding/removal uses Owner reservations completed after the mutation.
Group enable stays Owner-gated and allowlisted. Connection methods are a closed
union (QR, OAuth, Manifest, Token, Device Link, Manual fallback). Slack,
Telegram, and Discord must not return QR. Guided steps never return a live state
or fake QR. WhatsApp has no connection method because its runtime is not bundled.

### 10. Voice and OS permissions

ASR obtains a short-lived microphone nonce from Main immediately before
`getUserMedia({audio:true})`. Main denies camera/video/unknown media requests.
Packaged macOS metadata contains the bilingual microphone purpose and strips
Electron's unrelated default camera, Bluetooth, and capture permissions.

MOSS-TTS preview and conversation Read share one controller with a monotonically
increasing generation token. A newer request cancels the older playback. The
controller awaits `play()`, publishes playing/stopped/ended/error/stalled state,
aborts model/download work, and revokes temporary URLs. TTS failure never blocks
text conversation or forces an IM audio send.

### 11. Update and release identity

The updater runs in Electron Main. It discovers immutable versioned GitHub
Releases, verifies the embedded updater key ID, manifest signature, monotonically
increasing sequence, minimum/current version, target, GitHub asset ID, size,
SHA-256, detached installer signature, release-manifest digest, and public-export
tree. Update-manifest and release-manifest identities must be distinct. Renderer
cannot select a feed or execute a payload. The OS installer runs only after user
confirmation.

Every release uses one source SHA and one deterministic public-export tree. The
native workflow builds each target on a matching host and embeds source/target
identity. The release assembler accepts only a draft containing the exact three
installers, validates GitHub digests, signs metadata with the offline key that
matches the embedded public identity, and emits exactly ten assets. Public
readback downloads and verifies the immutable bytes again.

### 12. Forbidden architecture

- a Penglai chat page, agent loop, provider gateway, Workspace/Session store, or
  tool/approval engine beside DSH;
- renderer filesystem, secret, signing-key, raw database, or arbitrary IPC access;
- model-provided paths or booleans treated as Owner approval;
- DOM injection or image masquerading to invent generic DSH file Turns;
- an adapter calling a parallel agent or guessing scope from the focused window;
- non-live IM manifests presented as connected, or fake QR shortcuts;
- optional plugins blocking core startup or required plugins being disabled;
- system PATH/runtime fallback, mutable “latest” assets, unsigned catalogs, or
  rebuilt bytes substituted after acceptance; and
- release claims that confuse source, package, native, installed, live, and
  public evidence.

## 中文摘要

0.5.7 仍以 official DSH 为唯一 Agent/模型/工具/审批/Workspace/Session/Turn/UI
核心。Electron Main 负责进程、Owner Broker、OS 权限、升级和卸载；renderer 只能用
窄 preload 与 typed Remote，不能读文件、密钥或任意 IPC。

办公、IM 文件与持久附件统一使用绑定 scope 的 `artifact:<uuid>`；确认与具体动作、
对象、Workspace/Session、摘要、目标和 revision 绑定，真实写入/发送/事务成功后才完成。
official DSH rc.2 没有通用 file Turn，0.5.7 不做 DOM hack 或第二会话表示。

记忆在 official `turn/end` 运行禁用工具的 official curator Agent，Host 做封闭格式和
本地风险校验；安全项目事实只自动写当前 Workspace。`agent/pre-step` 只召回当前
Workspace 与明确个人记忆，绝不跨 Workspace。资料撤销删派生索引，不动源文件。

IM 始终只有一个 `@penglai/im` 控制平面。微信、飞书、钉钉、企业微信和 QQ 只在
供应商协议真实提供时显示 QR/device-link；Slack、Telegram、Discord 使用官方
Manifest/Token，不伪造二维码。WhatsApp runtime 不随 0.5.7 分发，说明卡没有连接
动作。ASR 麦克风需要当前手势并只申请 audio；TTS 试听和 Read 共用一个可观测播放
状态机，Read 朗读原文。

三端安装包必须来自同一干净 SHA 和 public-export tree，在对应原生 runner 验收。
升级 manifest、release manifest、GitHub asset ID、大小、哈希和三端签名相互绑定；
正式发布后再从公网下载十个资产逐字节回读。
