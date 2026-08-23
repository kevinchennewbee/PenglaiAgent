# Penglai v2 架构 — 0.5.0 跨平台发行版

## 1. 总体组合

```text
Penglai desktop (Penglai.app / Penglai.exe, zh-CN first)
├─ Electron distribution shell
│  ├─ bootstrap / recovery / process supervisor / secure local proxy
│  ├─ embedded Node + pinned official DSH
│  └─ app-private DSH_HOME + Penglai data root
└─ official DSH host + official DSH Web implementation
   ├─ DSH Agent / Workspace / Session / Turn / tools / approvals
   ├─ Pi providers / Models / credentials-local / default model
   ├─ Penglai composition client
   │  ├─ product brand + zh-CN preference + versioned onboarding
   │  ├─ Plugin Center client
   │  ├─ Penglai IM/voice clients
   │  └─ Context/Memory/Budget/Companion clients
   ├─ @penglai/plugin-center host
   ├─ @penglai/asr + @penglai/moss-tts hosts
   ├─ @penglai/memory host（分层记忆 + 授权资料 + 来源卡 + 图谱）
   ├─ @penglai/budget + @penglai/companion hosts
   └─ @penglai/im host
      ├─ Typert Remote service
      ├─ adapter supervisor
      ├─ binding / commands / causal router
      ├─ SQLite / inbox / correlation / outbox
      ├─ Weixin iLink adapter
      └─ Feishu official SDK adapter
```

“界面叫蓬莱”与“DSH 是核心”不冲突：Penglai 是产品品牌和发行 composition，official DSH Web 仍提供所有 Agent/会话/工作区/基础交互。品牌层不得复制或替换 DSH runtime。

## 2. 产品品牌与中文层

### 2.1 用户可见身份

- macOS/Windows app name、bundle/display name、window title、HTML product suffix、菜单、About、首次欢迎页、sidebar wordmark、shortcut 和设置中的产品名统一为“蓬莱 / Penglai”。
- official DSH 归属、版本、许可证和“Powered by DeepSeek Harness”保留在 About、诊断和开源许可证，不占据主产品品牌。
- 运行健康判断不能继续依赖 `document.title === "DeepSeek Harness"`；改用 pinned asset manifest、root marker、host handshake 和 authenticated health proof。

### 2.2 实现优先级

1. 使用 DSH 可配置 HTML title、locale service、slots 和 client modules。
2. 用 `locale.preference=zh` 作为 fresh profile 默认值，允许用户在设置切换中文/English。
3. Penglai-owned 文案全部注册 zh/en dictionary；0.5.0 核心旅程的默认界面必须中文。
4. rc.8 的 sidebar/hero brand 使用 official slots；其余没有公开 seam 的 document title、首次披露、hero copy/background 允许一个 exact `@deepseek-ai/dsh@0.1.0-rc.8` 的最小 UI overlay：不改 Agent/runtime/network；记录原文件 checksum、patch checksum、适用版本、反向补丁和 DOM regression。
5. overlay 版本不匹配立即 fail closed，不能模糊 patch `node_modules`。

### 2.3 中文质量门

- 欢迎、隐私、Models onboarding、provider 选择、API 测试、Workspace、IM、错误恢复、删除数据完整中文。
- provider/model 官方名称、API、URL、App ID 等专有词可保留英文。
- diagnostics 可显示技术 id/code，但操作说明必须中文。
- 关键页面不得出现无解释的英文按钮、DSH/Harness 主品牌或中英混杂占位符。

### 2.4 DSH capability parity

Penglai composition 是加法：

- 完整保留 official appearance service 和设置中的 light/dark/system 三态；system 通过官方 media/host 行为动态响应，不另造主题状态。
- 完整保留 locale zh/en，fresh seed 只把 preference 设为 zh，不移除 English dictionary/selector。
- 完整保留 Models、Workspace/Session、conversation、tools、approvals、permissions、plugins、general settings 的 client/host modules 与 slots。
- Penglai Center 与每个已启用的第一方插件都直接使用 rc8 official `settings.section` 注册页面，按连续 order 排在“蓬莱”概览之后；这让页面进入 official Settings 左栏，避免在内容区制造第三列。未安装/未启用插件不注册页面，单插件卸载只撤销自己的 official entry 与 host 资源。Center 事务成功后应用内 reload 一次以让 official client loader 重新计算模块闭包；不得打开系统浏览器或复制第二套 settings runtime。
- overlay manifest 同时列 `changed surfaces` 与 `must-remain-official packages`；后者 hash/behavior 漂移即失败。
- 每次 DSH pin/overlay 更新运行 upstream capability matrix 与 installed parity suite。

## 3. 进程与网络边界

### Electron main

- 解析只读 bundle resources 和 app-private data root。
- 用绝对路径 spawn embedded Node + official DSH entry。
- 监管启动、ready、unexpected exit、shutdown、orphan cleanup。
- 创建随机 loopback proxy capability；BrowserWindow 不直接暴露 host secret。
- production BrowserWindow：`contextIsolation=true`、`sandbox=true`、`nodeIntegration=false`、窄 navigation/window-open policy。
- macOS 通过 owned process group 监管 DSH；Windows 通过 Job Object 或等价受测机制监管完整 process tree。
- target、Electron arch、embedded Node arch、runtime manifest 不一致时 fail closed，不回退系统运行时。

### DSH host

- 唯一 Agent runtime 与 plugin host。
- 持有 credentials service、WorkspaceRegistry、AgentHandle、settings、loader inventory。
- 运行 Plugin Center 与全部Penglai first-party hosts；adapter/Context/Memory/Budget/Companion不跨进程另建Agent/Session/Skill/Schedule/TokenMeter service。

### DSH Web renderer

- 运行 official DSH client composition。
- 通过 Typert generated Remote 调用 host。
- 不读取 filesystem、environment、credential value 或任意 IPC。

### 外部厂商

- Weixin adapter 仅连接 pinned iLink HTTPS endpoints。
- Feishu adapter 仅通过 official SDK 连接开放平台 token/message/WebSocket endpoints。
- 厂商 inbound 是不可信输入；先 schema/size/type/auth/dedupe，再进入持久队列。

## 4. app-private 数据布局

0.5 使用新的 generation root，与 0.4.1 完全隔离。逻辑 root 由 platform resolver 基于 Electron `app.getPath()` 生成：macOS 为 `~/Library/Application Support/Penglai/0.5/`，Windows 为 `%LOCALAPPDATA%\Penglai\0.5\`。

```text
<Penglai 0.5 userData>/
├─ release/
│  ├─ current.json
│  ├─ update-ledger.json
│  └─ journals/
├─ dsh-home/
│  ├─ cordis.yml
│  ├─ cordis.patch.yml
│  ├─ settings.yaml
│  ├─ .credentials.yaml
│  ├─ onboarding/
│  └─ plugins/
├─ im/
│  ├─ im.sqlite3
│  └─ migrations/
├─ voice/
│  ├─ models/
│  ├─ local-voices/
│  └─ temp/
├─ context/
│  ├─ grants.json
│  ├─ indexes/
│  └─ cache/
├─ memory/
│  ├─ global/
│  ├─ workspaces/
│  └─ candidates/
├─ budget/
│  └─ ledger.sqlite3
├─ companion/
│  ├─ schedules.json
│  └─ audit.sqlite3
├─ diagnostics/
├─ cache/
└─ uninstall/
```

- bundle resources 只读；运行态不得写入 `.app`。
- 不默认读取或修改用户 `~/.dsh`。
- 0.4.1 legacy detector 只能读取已知路径的存在、版本和大小；不打开旧 DB/credential，不迁移或删除。
- `.credentials.yaml` 包含 secret；其他 profile/DB 只保存 ref 和非秘密描述。
- IM DB 可以短期保存执行所需 inbound/outbound 文本，但必须有 retention、完成后清理和“清除消息记录”功能；evidence/diagnostics 不复制正文。
- Context只保存授权descriptor与派生index，外部source不归app管理；Memory/voice/Context/Companion内容按独立retention和删除合同，Budget不保存prompt/response正文。
- macOS 对 root/credential 实施 0700/0600；Windows 实施当前用户专用 DACL，拒绝 junction/reparse escape。

## 5. 首次引导状态机

引导是 **pre-DSH 前置向导**（ADR 0030）：ledger 未 COMPLETE 时主窗口加载经认证代理同源提供的 `/wizard` plain HTML/JS/CSS，不再在 DSH Web 内渲染全屏遮罩或注册 `settings.onboarding`。`penglaiOnboarding` Typert Remote 只编排 official `llm` / `credentials` / `settings` / `agents` / `workspaceRegistry` seam。状态机仍是：

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
  → IM_OFFERED
  → COMPLETE
```

ledger `current === "COMPLETE"` 后 `wizardFinished` 先验证 official DSH Web 面，成功才下线 `/wizard`（410）并切换；失败则回滚保留向导可达。向导是临时 bootstrap 面，不是长期第二 UI，不提供第二聊天面/模型网关/Session store。

### 状态事实源

- welcome/privacy：versioned durable completion record。
- provider/credential：official settings + credentials.describe。
- model test：official DSH temporary test Turn 的 nonce digest/result，不是 UI flag。
- default model：official agent-default-model。
- Workspace：official WorkspaceRegistry。
- IM offered：versioned onboarding record；adapter actual state 仍来自 supervisor。

### 多 API 选择

- provider cards 从 `llm.providers` live directory 动态生成，不在 Penglai 复制静态目录。
- 优先展示官方 catalog 中可配置 providers；支持 official custom OpenAI-compatible route 的 display name、base URL、protocol、model list。
- key 写入 official credentials service；不显示环境变量名或明文回读。
- “测试连接”先用 official provider/model discovery（若支持），最终必须通过 official DSH AgentHandle 创建低 token、无工具的临时 nonce Turn。
- 测试失败保留草稿并显示 provider/network/auth/model 稳定错误；不得标记 core ready。
- 测试通过、默认模型和 Workspace 就绪后，official DSH core、Office与Memory可用；IM/ASR/MOSS-TTS/Budget/Companion仍为可选并默认未安装、未加载。

## 6. DSH profile composition

fresh profile 至少包含：

- official credentials-local、settings、locale、Pi provider、default-model、Workspace/Session/Agent/Web 全套。
- `@penglai/plugin-center` enabled。
- `@penglai/im` bundled catalog only；fresh `not-installed/disabled`，用户安装后两个 adapter 初始 `not_configured`。
- `@penglai/asr` bundled catalog only；fresh `not-installed/disabled`，安装后 model 初始 `not_installed`。
- `@penglai/moss-tts` bundled catalog only；fresh `not-installed/disabled`，安装后 model 初始 `not_installed`。
- `@penglai/memory` required-builtin；fresh安装并active，初始记忆与授权来源均为空。旧`@penglai/context`不进入catalog/profile/inventory，其索引数据仅由0.5.5迁移接管。
- `@penglai/budget` bundled catalog only；fresh `not-installed/disabled`，安装后初始 `unlimited`。
- `@penglai/companion` bundled catalog only；fresh `not-installed/disabled`，安装后 product state 仍为 `disabled_by_user`。
- `@penglai/plugin-reference` bundled catalog only and disabled。
- 不包含 `@penglai/credentials-keychain`、smoke plugin或旧Host/Skill/MCP/Memory runtime。

### 6.1 插件来源模型

- `official-core`：DSH 随 pin 提供，Penglai 保持 capability parity，不由 Center 假装重新拥有。
- `penglai-builtin`：随 app 离线签入的 Center/IM，Penglai 负责 manifest、迁移、权限、健康和回滚。
- `penglai-first-party`：0.5包含完整ASR/MOSS-TTS/Context/Memory/Budget/Companion；以后新增能力也只有完成同等合同后由Center受控交付。
- `community-reviewed`：未来经过审核、签名/完整性、license、permission、compatibility、sandbox、migration/rollback 的社区包。

0.5.0 schema/UX 要能表达四种来源，但 catalog 不能借此显示未实现或未审核包，也不能接受任意 URL。

profile seed/upgrade 使用 revision、journal、staging、atomic rename 和 loader inventory 验证。现有 profile 每次升级只应用 versioned migration，不能整文件覆盖用户设置。

## 7. Typert IM Remote

host service：

```text
PenglaiImRemote extends TypertRemoteService
├─ getOverview()
├─ getOnboardingReadiness()
├─ listWorkspacesAndSessions()
├─ createBinding(input)
├─ deleteBinding(input)
├─ listBindings()
├─ beginWeixinQr()
├─ submitWeixinVerification(input)
├─ cancelWeixinQr()
├─ reconnectWeixin()
├─ logoutWeixin(input)
├─ configureFeishu(input: appId + writeOnlySecret?)
├─ verifyAndConnectFeishu()
├─ disconnectFeishu()
├─ logoutFeishu(input)
├─ getDiagnostics()
└─ subscribe/status revision mechanism
```

约束：

- 方法用 `@Remote` 和生成的 `./typert`、`./remote`；client 用 `TYPERT_REMOTE` mount。
- input/output 都过 closed schema；unknown fields 拒绝。
- output 不含 secret、raw token、QR payload、verification code、真实聊天正文或完整身份。
- mutating method 有 operation id、revision、timeout、rate limit 和 stable error code。
- QR 图像优先由 client 根据短期非可复用 display payload 本地生成；若必须传 binary，使用单次 capability/no-store/same-origin endpoint，并写 ADR。

## 8. IM host lifecycle

`@penglai/im.apply(ctx, config)` 必须：

1. 注入 official credentials、agents、workspaceRegistry、settings、inventory。
2. 打开并迁移 SQLite；失败不启动 intake。
3. 注册 Remote service 与 client module。
4. 构造统一 Router/CommandEngine/Correlation/Outbox。
5. 构造 Weixin/Feishu adapters，secret 只以 CredentialRef 传入。
6. 启动唯一 Supervisor；对 enabled+configured adapter 自动连接。
7. 恢复 inbox/correlation/outbox，再接受新消息。
8. `ctx.effect` cleanup 时先停 intake、abort workers、关闭 SDK/socket/timer、标记 uncertain send、close DB、unregister Remote。

Supervisor 状态与 transition 持久化非敏感摘要，支持 crash、network、sleep/wake、credential rotation 和 plugin reload。

## 9. 微信 adapter

```text
UI begin
 → get_bot_qrcode(bot_type=3, local_token_list)
 → render short-lived QR
 → long-poll status (wait / scaned / confirmed / expired / redirects / verify)
 → credentials.set(long-lived token)
 → persist bot/account/scanner descriptors
 → getUpdates(cursor, suggested timeout)
 → inbox → binding → command/Turn
 → outbox → sendmessage
```

协议要点：

- 固定 QR origin；confirmed/redirect 返回的 base URL 必须真正应用于后续 transport。
- 每请求 `X-WECHAT-UIN` 为 base64 random uint32，不使用常量 `0`。
- QR TTL、35s status poll、最多刷新次数、cancel/AbortController、验证码状态与安全错误分类可测试。
- cursor 原子持久；auth failure 停止重试并进入 expired；transient error 指数退避+jitter+budget。
- scanner identity 初始化单 owner allowlist；未知 sender 在 Agent 前拒绝。

## 10. 飞书 adapter

```text
UI official app/registration QR
 → poll client_id/client_secret
 → credentials.set(App Secret) + store App ID
 → Lark.Client credential/bot probe
 → Lark.EventDispatcher.register(im.message.receive_v1)
 → Lark.WSClient.start(dispatcher)
 → p2p text event → durable inbox within 3s
 → binding → command/Turn
 → outbox → Lark.Client.im.message.reply/create
```

- official SDK pin：`@larksuiteoapi/node-sdk@1.73.0`。
- 默认一键扫码：`accounts.feishu.cn/oauth/v1/app/registration`，把 `verification_uri_complete` 画成 PNG。
- 用户 OAuth Device Flow 不在基础路径；手动 App ID/Secret 只作后备。
- event id/message id dedupe；只接受 p2p text 和配置租户/bot identity。
- 事件 handler 先 durable enqueue 并快速返回，不能等待模型完成。
- SDK reconnect 有 single client owner；credential/config revision 变化时原子替换。

## 11. Binding、命令与因果路由

binding key 至少包含 channel、account/tenant、peer、WorkspaceId、SessionId、revision。一个 route 同时只有一个 owner binding；删除/变更需 revision CAS。

Inbound 流程：

1. schema/type/size/auth/allowlist。
2. message/event id 去重并 durable insert。
3. 查显式 binding；无 binding 返回确定性帮助，不调用模型。
4. slash command 先消费。
5. 普通文本 claim 一个 DSH Turn，保存 messageId/turnId/route。
6. 监听该 Turn 的 durable final；stream partial、desktop output、unknown turn 不发送。
7. enqueue outbox；adapter 发送后保存 receipt/delivery classification。

命令：`/帮助 /绑定 /解绑 /项目 /会话 /新建 /状态 /插话 /停止 /清空队列 /语音 /资料 /记忆 /预算 /陪伴`。命令 parser 独立于模型，严格参数/权限/状态机；长期记忆写入和首次陪伴启用必须回DSH Web确认。

## 12. 持久化与恢复

核心表：schema_migrations、accounts、adapter_configs、bindings、inbox、claims、turn_correlations、outbox、vendor_reply_targets、cursors、dedupe、command_audit、worker_state。所有 id/token/body 以最小需要保存；secret 永不入 DB。`peerRef` 是隐私索引，不能替代真正发送所需的受控 vendor target。

恢复顺序：DB integrity/migration → credentials descriptors → bindings → incomplete inbox/claims → uncertain outbox policy → adapters connect → accept new inbound。

exactly-once 不做不真实承诺；目标是 durable at-least-once intake + idempotent claim + dedupe + fail-closed uncertain send。厂商未提供幂等 key 时，uncertain send 不盲重发，显示人工恢复。

## 13. 安装、升级与卸载架构

- 0.5.0 的 Apple Silicon target 使用 machine-readable release contract 与 target-specific Electron/Node/DSH closure；Intel/Windows 保留为后续 target。
- 0.4.1 → 0.5.0 是 clean-generation install；旧 data 不进入 migration graph。
- 0.5 updater 在 Electron main 中检查 canonical signed manifest；renderer 只显示状态并请求用户操作，不能指定 feed 或执行 payload。
- community trust macOS 的后续版本使用 assisted upgrade：下载/验签后打开 DMG。安装前 drain owned DSH/IM/voice/indexer/distiller/budget subscriptions/companion schedules、写 update journal；新版本启动后 verify/commit/rollback。0.5.0 本身不发布 updater channel。
- Windows uninstaller 默认删 app/shortcuts/cache、保留 userData；macOS 设置页提供数据清理和移入废纸篓向导。
- complete delete 由 exact deletion plan 控制，拒绝 root/home/Workspace/legacy/symlink/junction/reparse point。
- Context source directories永不删除；Context indexes、Memory、Budget、Companion与voice data分项预览/确认。

详细状态机见 `docs/UPDATE_UNINSTALL.md`，平台闭包见 `docs/PLATFORM_MATRIX.md`。

## 14. Public-export 与来源同一性

private source 先通过 allowlist 产生 deterministic public-export tree。0.5.0 Apple Silicon artifact 绑定 `candidateSourceSha` 与 `publicExportTreeSha256`；开源 commit 可以有不同 Git SHA，但产品树必须与已验收 export tree 内容等价。公开资产不能在验收后重新构建偷换。

## 15. Overlay 与上游升级

每个 overlay manifest 记录：DSH npm version/integrity、upstream commit、target file hash、patch hash、reason、owned visual delta、reverse patch、DOM/behavior tests。升级 DSH 时先在隔离 runtime 应用；hash 不匹配立即阻止 build。不得手改安装后的 bundle。

## 16. 不允许的架构

- Electron 内自制主聊天或 IM 主窗口。
- Penglai 模型 gateway/provider registry/session store。
- adapter 直接 create/followup Agent，绕过统一 Router。
- Context/Memory/Budget/Companion复制official Workspace/Session/Turn/Skill/Schedule/TokenMeter，或按最近窗口猜scope。
- Companion默认启用、无人值守使用工具，或未经exact binding/quiet-hours/budget从IM外发。
- renderer 读取 credentials value、filesystem 或任意 Keychain。
- env flag 决定 production worker 是否启动。
- 飞书用户 Device Flow 或假二维码冒充 bot 基础认证。
- 运行时 patch 用户 `node_modules`，或版本不匹配仍继续。
- 为了“蓬莱化”而删除主题模式、English 或任何 official DSH core setting/module。
- 自造无签名 updater、没有 Developer ID 却宣称 silent auto-update，或让 renderer 直接执行安装包。
- 0.5 自动导入/删除 0.4.1 数据，或卸载器递归用户 Workspace。
- 用同一错误 arch closure 改名生成两个 DMG，或用 translated/emulated evidence 冒充 native。
