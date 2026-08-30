# `@penglai/im` 完整产品与协议合同

> 0.5.8 用户只看到一个「消息连接」插件。八个平台都有真实连接入口，不再把新增渠道
> 显示为路线图。manifest 的 `live` 是历史兼容字段，表示 0.5.8 包含真实 adapter
> 实现，不表示当前用户已启用或已通过 live-account 验收。没有
> 对应 live evidence 时，不得把该平台写入 README/官网/Release 的“全部支持”
> 声明，也不得把图片/文件/音频/Markdown/线程/群聊标为 `true`。Slack、Telegram、
> Discord 禁止伪装扫码。WhatsApp 在 0.5.8 中不展示、不支持、不列为规划，也不捆绑
> 运行时。下文微信/
> 飞书合同继续约束已有 live 路径；新渠道只有通过 adapter、health、send-reject
> 和 live evidence 后才能进入 `LIVE_CHANNEL_IDS`。

## 1. 定位

`@penglai/im` 是一个同时包含 DSH host 与 client module 的第一方插件。微信和飞书是内部 adapter，共享配置、binding、commands、causal routing、SQLite、outbox、supervisor 和 diagnostics。私聊语音通过`@penglai/asr`/`@penglai/moss-tts`的typed services处理；Context/Memory/Budget/Companion通过各自typed services与official Turn组合，adapter不拥有这些引擎。

可以参考 ZCode 的图形设置、`/帮助`、`/项目`、`/会话` 和清楚的连接状态，但不复制其私有代码；厂商协议必须来自官方资料或可审计参考实现。

## 2. 默认行为

- fresh 0.5.8 profile 离线携带并登记 `@penglai/im`，但默认 `disabled`，不会进入 active loader roster，也不会启动 adapter 网络活动。
- 用户在 Center 明确选择“安装并启用”后，package transaction 才写入 profile、启用 loader，并验证 actual active/healthy；此后未配置 adapter 时不联网、不启动 auth poll。
- 未配置 adapter 时不联网、不启动 auth poll，但 Remote/UI/diagnostics 可用。
- official Models API key 测试、default model 和 Workspace 就绪后，onboarding 自动进入“连接消息渠道”步骤。
- 用户可选“连接微信”“连接飞书”“稍后”；稍后不阻止 DSH 使用，设置入口与非打扰 badge 保留。
- 一键扫码成功后，扫码者/创建者的第一条私聊自动绑定 official 默认 Workspace/Session（引导时创建的那一个），直接对话。不必再发 `/绑定 <token>`。
- 绑定页与 `/绑定` 只用于换官方会话或额外对端；不得按焦点或最近活动猜测。
- fresh binding 默认接收 private text、受支持图片/文件和 audio，reply mode 为 mirror-input；ASR/TTS model 未就绪时显示确定性安装指引并 text 降级。

## 3. UI 结构

UI 位于 official DSH Web 的“设置 → 蓬莱 → 消息连接”嵌套子菜单，不是另一个窗口或内容区第三列。`@penglai/im` 使用 official `settings.section` 与保留的 `penglai-*` section id 注册自己的页面；固定的 DSH 0.1.2-alpha.1 源码没有父子 section schema且会丢弃未知 option，因此 exact-hash settings renderer overlay 只按该 id 命名空间渲染嵌套组，不改变 DSH settings/Agent/runtime。停用 IM 只移除 active 页面与相关 host 资源，不影响 DSH 或其他蓬莱插件。首次启用后，Center 明示状态并应用内 reload client roster，随后子菜单出现“消息连接”，其微信/飞书页只提供厂商真实支持的连接流程。

“绑定”页必须为每个真实 binding 提供可视化 `inputMode`、`replyMode` 与 MOSS `voiceId` 控件；它们与 `/语音`、`/声音` 写入同一个 IM core 持久策略。ASR/TTS 未安装或模型未 ready 时显示实际能力状态并安全降级，不能显示假开关。微信原生语音必须先从该页发送 live probe，再由用户确认客户端里确实出现可播放气泡；仅 API 成功不自动启用。

### 总览

- core：DSH health、IM plugin actual active、DB/migration、supervisor。
- channel cards：configuration、connection、binding、queue、last safe error。
- 快捷操作：连接微信、连接飞书、管理绑定、查看诊断。
- 扫码成功后应显示已连接，并可直接对话。绑定页不是首次必经步骤。

### 微信

- “连接微信”主按钮。
- QR modal：二维码、剩余时间、真实状态、刷新次数、取消。
- `wait`、`scaned`、`confirmed`、`expired`、`scaned_but_redirect`、`need_verifycode`、`verify_code_blocked`、`binded_redirect` 的中文状态与操作。
- verification code 安全输入；不记录、不回显历史。
- connected 后显示脱敏 account descriptor、owner-only、receive/send health、重新连接、重新扫码、注销。

### 飞书

- “连接飞书”主按钮走官方 `accounts.feishu.cn/oauth/v1/app/registration` 一键扫码创建 PersonalAgent。
- QR 区域：把官方 `verification_uri_complete` 画成 PNG、剩余时间、真实状态、取消。禁止假二维码，禁止把落地页 URL 塞进 `<img src>`。
- 扫码确认后 host 把 `client_id`/`client_secret` 写入 official credentials，再校验并长连接；renderer 永不看到 App Secret。
- 用户 OAuth Device Flow（`/oauth/v1/device_authorization`）不是基础连接。
- 手动 App ID/Secret 与企业向导只作扫码不可用时的后备；App Secret write-only，保存后只显示“已配置”。
- connected 后提供 disconnect、重新扫码、logout/delete credential。

### 绑定

- 从 official WorkspaceRegistry/Session 列表选择，不允许自由输入伪 id。
- 显示 channel/account/peer 的脱敏 route、Workspace、Session、revision、createdAt。
- 微信 confirmed scanner 的私聊自动绑定 official 默认 Workspace/Session；飞书首次真实私聊同样自动绑定同一默认会话。
- 单 route 单 active binding；微信与飞书可共享同一个 official 默认 Session。CAS 更新。`/解绑` 后下一条 owner 私聊会再次自动绑定默认会话。

### 命令与诊断

- 命令说明、权限、示例均中文。
- diagnostics 只返回稳定 code、状态、时间、版本、queue/voice operation counts 和恢复动作，不返回 body/token/QR/identity/raw audio/transcript。

## 4. Typert Remote API

host 继承 `TypertRemoteService`，方法用 `@Remote`；client 只使用生成 remote。最小 DTO：

```ts
type ChannelState = {
  channel: "weixin" | "feishu";
  configured: boolean;
  connection: "not_configured" | "ready" | "connecting" | "connected" | "degraded" | "expired" | "blocked" | "disabled" | "failed";
  boundRoutes: number;
  pendingInbox: number;
  pendingOutbox: number;
  lastReceiveAt?: string;
  lastSendAt?: string;
  error?: { code: string; action: string };
  revision: number;
};
```

所有 mutation 带 operation id 和 expected revision。Remote 不提供 generic execute、filesystem path、raw config、secret read 或任意 provider fetch。

## 5. credential refs

- Weixin：`penglai-im/weixin/<account>/token`。
- Feishu：`penglai-im/feishu/<account>/app-secret`。
- App ID、base descriptor、enabled、allowlist hash可在普通config/DB；真实vendor reply target按最小需要保存在受限IM DB，UI/diagnostics只显示peerRef。
- QR payload/challenge/verification code 只在进程内，TTL 后清零。
- adapter 需要 secret 时由 host `credentials.resolve(ref)`；value 不进入 adapter state serialization。

## 6. 微信协议状态机

```text
DISCONNECTED
  → QR_CREATING
  → QR_WAITING
  → SCANNED
  → VERIFY_REQUIRED | REDIRECTING | CONFIRMED | EXPIRED | CANCELLED
  → CONNECTING_UPDATES
  → CONNECTED
  → DEGRADED
  → CONNECTED | EXPIRED | LOGGED_OUT
```

### QR

- POST fixed `get_bot_qrcode?bot_type=3`，传允许的 local token list。
- active challenge TTL 5 分钟；status long poll timeout 35 秒；最多自动/手动刷新次数有明确上限。
- begin/cancel/retry 幂等；同 account 同时只有一个 active challenge。
- QR local render 标记 `no-store`，不进截图/evidence/diagnostics/browser storage。
- redirect 状态必须验证 HTTPS/允许 host 并切换 subsequent base URL。
- verify code 长度/字符集/schema 校验；blocked/expired 有稳定恢复动作。

### transport

- 每个请求生成 random uint32 并 base64 为 `X-WECHAT-UIN`；禁止常量。
- request id、message id、context token 有 size/format gate。
- status/body/error 先 schema parse；未知响应 fail closed 并脱敏。

### confirmed 与 owner

- token 写 official credentials service 后再提交 account state。
- bot id、base URL、scanner identity 保存为最小 descriptor；scanner 初始化唯一 allowlist。
- credential write 或 state commit 任一失败都回滚，不留下“UI connected、host 无 token”。

### receive/send

- 持续 `getUpdates`，cursor 每批原子提交；同 cursor 响应可重放而不重复 claim。
- timeout 是正常 idle；DNS/TLS/5xx/429 有分类退避；401/auth invalid 进入 expired，不无限重试。
- app sleep/wake 后重建 request，避免多个 poller。
- send使用受控保存的original vendor route/context；hashed peerRef绝不能作为发送地址；保存receipt/classification，uncertain result不盲重发。
- logout 先停 intake/worker，处理 outbox，撤销/清除 credential，清理 account/binding 按用户选择执行。
- private VOICE item 在 auth/allowlist/dedupe/claim 后下载解密 SILK 并交 ASR；图片进入 official DSH image store，普通文件进入 exact Workspace/Session 的 Artifact Service；视频仍拒绝。
- TTS回复至少以可见可播放audio FILE attachment发送；native VOICE bubble只有current Tencent live capability通过才启用，API返回成功但客户端不可见仍算失败。

## 7. 飞书官方应用状态机

```text
NOT_CONFIGURED
  → CREDENTIAL_SAVED
  → VERIFYING
  → READY
  → WS_CONNECTING
  → CONNECTED
  → RECONNECTING
  → CONNECTED | BLOCKED | EXPIRED | DISCONNECTED
```

### setup contract

- 官方扫码创建 PersonalAgent，不依赖 Penglai 云；手动企业应用只作后备。
- 启用 bot capability。
- 最小权限：私聊消息只读与机器人发送（以当前官方 permission code 为准并由 contract fixture 固定）。
- event mode：long connection。
- subscribe：`im.message.receive_v1`。
- 创建版本并发布；可能需要管理员审批。

### SDK

- dependency pin：`@larksuiteoapi/node-sdk@1.73.0`。
- `Lark.Client({ appId, appSecret })` 做 API/send。
- `Lark.EventDispatcher.register({ "im.message.receive_v1": handler })`。
- `Lark.WSClient({ appId, appSecret }).start({ eventDispatcher })`（按 pinned SDK exact API 实证）。
- 一个 config revision 只有一个 WSClient；reconfigure 先成功建立新 client 再切换，或失败保持旧连接。

### event handling

- 验证 schema、tenant/app/bot、chat type=p2p、message type=text|image|file|audio、size/duration limit。
- event/message id durable dedupe。
- handler 在 3 秒内 durable enqueue/return，不等待 Agent；重复推送只复用 inbox result。
- p2p image/file/audio 在 durable enqueue 后用 message id+file key 异步下载；image 进入 official image store，file 进入 scoped Artifact Service，audio 交 ASR。group/video/unsupported card 明确拒绝，不下载、不调用模型。
- sender/open ids不进普通日志；DB为回复最小保存真实vendor target并用文件权限/ACL、字段访问和retention保护，UI/导出/evidence只使用HMAC/hash peerRef。

### send/reconnect/logout

- reply/create 使用 official Client；按 original message/peer route，不广播。
- rate limit、tenant token、permission、app unpublished、connection 错误分别分类。
- SDK 自动重连之外再有 supervisor budget，避免双重 storm。
- disconnect 保留 config/credential；logout 可选择删除 credential、account、bindings 和 retained messages。
- audio reply由MOSS生成、转mono 16k Opus、official file upload后以`msg_type=audio`发送；普通file不能冒充native audio。

## 8. Binding 合同

```ts
type Binding = {
  id: string;
  channel: "weixin" | "feishu";
  accountId: string;
  peerRef: string;
  replyTargetRef: string;
  workspaceId: WorkspaceId;
  sessionId: SessionId;
  revision: number;
  state: "active" | "disabled";
};
```

- Workspace/Session 必须通过 official API 验证存在、归属和可用。
- 首次路径绑定引导时创建的 official 默认 Workspace/Session，不按 current focus、last active 或 recent session 猜测。
- `/绑定` 是换会话的后备，不是扫码后的必经步骤；不能让任意 IM sender 自选任意 Session。
- 官方工作区不存在时 fail closed；binding 删除后下一条 owner 私聊重新自动绑定默认会话。

## 9. 命令

| 命令 | 行为 |
| --- | --- |
| `/帮助` | 本地生成中文命令清单，不调用模型 |
| `/绑定` | 返回安全绑定说明/一次性请求，不直接越权绑定 |
| `/解绑` | 请求并确认当前 route 解绑 |
| `/项目` | 列出允许的 Workspace 摘要 |
| `/会话` | 显示/选择本 Workspace 的 Session |
| `/新建` | official DSH 创建持久 Session |
| `/状态` | 返回 channel/binding/queue/Turn 脱敏状态 |
| `/模型 [序号\|provider/model]` | 读取/切换当前 official DSH Session 的模型；无独立 model registry |
| `/插话 <text>` | 对当前 claimed/active Session 的 official followup；严格状态门 |
| `/停止` | official AgentHandle stop/cancel |
| `/清空队列` | 清理本 route 可安全取消的 pending items，需确认 |
| `/语音 状态` | 返回ASR/TTS/model/reply mode脱敏状态，不调用模型 |
| `/语音 文字\|跟随\|同时` | 修改当前binding reply mode，CAS持久 |
| `/声音 [voice-id]` | 显示当前声音/设置指引，或修改同一 binding 的 MOSS voiceId |
| `/资料` | 显示当前binding Workspace的Context grant/index状态与DSH设置跳转；不回传文件名/正文 |
| `/记忆` | 显示global/Workspace memory摘要与待确认候选数；写入/删除必须回DSH Web确认 |
| `/预算` | 显示official TokenMeter今日用量/阈值摘要；修改/lift必须回DSH Web确认 |
| `/陪伴` | 显示当前Companion开关/quiet-hours/渠道；启用或扩大范围必须回DSH Web确认 |

parser 处理 Unicode whitespace、全角斜杠策略、未知命令、空参数、长度、重复操作；所有命令在 model context 前消费。

## 10. 因果路由

普通 inbound：

```text
vendor text/image/file/audio message/event
 → authenticated adapter route
 → durable inbox/media claim + dedupe
 → official image store | scoped Artifact Service | optional ASR exact audio digest
 → explicit Binding
 → claimed official DSH Turn
 → correlation(messageId, turnId, route, revision)
 → durable final output event
 → optional TTS exact final digest
 → outbox(original route only)
 → vendor receipt/classification
```

Hard rules：

- streaming partial 不发送。
- 一个 inbound 最多 claim 一个 Turn。
- output 必须匹配 exact turn id 和 binding revision。
- desktop-origin/other-channel/unknown/replayed final 不发送。
- binding 在 Turn 中途变更时按 claim snapshot 完成原 route，或进入明确 cancelled policy；不能发到新 route。
- crash recovery 重新加载 correlation，不按时间猜 output。

## 11. persistence 与 retention

SQLite表：accounts、adapter_configs、bindings、vendor_reply_targets、inbox、claims、correlations、outbox、cursors、dedupe、command_audit、worker_state、schema_migrations。

- inbound/outbound body 仅为执行/重试短期保存，默认完成后 24 小时内清理；用户可设更短，不能无限保留。
- secret、QR、verification code 不入 DB。
- 微信最新 `context_token` 视为厂商会话凭据，只通过 official credentials seam 保存；重启后可恢复 original-route reply/native voice probe，logout/revoke 必须与 bot token 一并删除，renderer/diagnostics/evidence 不可读取明文。
- raw audio/TTS temp不作为长期DB blob；只存短期AudioHandle/digest/state并按`docs/compatibility/VOICE_R3.md`清理。
- message/peer/vendor target只保存路由所需最小值；真实target与display peerRef分列并限制访问，diagnostics/evidence只使用digest。
- WAL/backup/rollback 与主 DB 同样受 retention/secret scan。

## 12. supervisor

- enabled+configured adapter 自动启动；不依赖环境变量。
- start/stop/reload 幂等，single owner，AbortController 贯穿网络调用。
- startup 先 recovery，再 intake。
- plugin disable、DSH shutdown、Electron quit 按 deadline drain；超时留下明确 recovery record。
- network offline/online、sleep/wake、clock shift、credential revision 触发单一 transition。
- outbox worker 持续运行并有公平/FIFO policy；不能只在 UI click 或 inbound 后 pump 一次。

## 13. 安全与隐私

- inbound 为不可信 prompt；DSH 原工具权限/审批不因渠道放宽。
- bound Turn调用Context/Memory时使用exact Workspace/Session scope；Budget在创建Turn前统一reserve/check。adapter不得直接查资料、注入记忆或绕过budget。
- Companion outbound必须携带durable trigger与exact authorized route，经同一outbox发送；IM聊天命令不能单独完成global memory写入或首次Companion启用。
- slash command 与控制字符不进入模型。
- size/rate limit：per route、account、global。
- logs/Doctor/evidence不含secret、QR、user/open id、vendor reply target、chat body或完整path；App ID仅在需要诊断时显示脱敏descriptor。
- UI mutation 有 CSRF/same-origin/capability/revision 防护。
- renderer compromise 不能调用 secret resolve 或 generic host method。

## 14. 自动测试层

- protocol fixtures：腾讯全部 QR/status/redirect/verify/text/image/file/SILK/audio-send/errors；飞书 SDK text/image/file/audio resource/upload/send/reconnect/errors。
- contract：headers、timeouts、schemas、credential refs、SDK pins。
- integration：两个 adapters + real Router + fake official DSH AgentHandle + SQLite。
- installed browser：真实 packaged app、中文 Penglai UI、Remote 操作、mock HTTP/WS workers。
- chaos：crash every transaction boundary、offline、sleep/wake、duplicate、out-of-order、uncertain send。
- live：exact installer 上微信扫码/private text/image/file/audio 与飞书 app/private text/image/file/audio；只保存 nonce、字节/文本 digest 和 opaque ids。

## 15. 明确非目标

群聊、视频、未审核富卡片、飞书 OAuth Device Flow、Penglai 托管应用、云路由、遥测，以及 adapter 独立 Agent runtime 均不在 0.5.8。图片必须走 official image store；普通文件必须走 scope-checked Artifact Service，不能把任意媒体伪装成文本或图片进入模型。
