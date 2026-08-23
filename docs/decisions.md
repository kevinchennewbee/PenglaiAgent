# 决策日志

本文记录 2026-08-16 0.5.0 跨平台重基线后的当前决策。更早决策保留在 Git 历史；与 `PRODUCT_CONSTITUTION.md` 或下方更新决策冲突者自动失效。

状态：`ACCEPTED` 必须执行；`DEFERRED` 不进入本版；`REJECTED` 不得改名绕回；`SUPERSEDED` 仅作历史。

## Accepted

### D-001 — Penglai 是 DSH 发行版

- 状态：ACCEPTED
- 决定：official DSH 是产品本体；Penglai 提供安装、监管、引导、插件生态和可靠性。
- 后果：不得让 Electron 自制控制面、第二 Agent 或第二聊天 UI 成为产品核心。

### D-002 — DSH 是唯一 Agent/Web 核心

- 状态：ACCEPTED
- 决定：Agent、Workspace、Session、Turn、工具、审批、模型和基础 Web UI 均由 pinned official DSH 拥有。
- 后果：Penglai 只能经官方服务和 UI seams 组合能力。

### D-003 — official DSH Web 是主界面

- 状态：ACCEPTED
- 决定：bootstrap 完成后同一 BrowserWindow 加载经认证代理的 official DSH Web。
- 后果：恢复页只在异常时出现；installed E2E 看到恢复页即 FAIL。

### D-004 — BYOK 复用 DSH Pi/Models

- 状态：ACCEPTED
- 决定：provider/model 目录、发现、配置和默认模型使用 `dsh-llm-pi-ai`、official Models 和 agent-default-model。
- 后果：禁止 Penglai provider registry、HTTP gateway 或重复表单。

### D-005 — 0.5 secret 统一使用 official credentials-local

- 状态：ACCEPTED
- 决定：API key、微信 token、飞书 App Secret 均经 DSH `credentials` service，生产 provider 为 app-private `@deepseek-ai/dsh-credentials-local` YAML。
- 后果：renderer 不读回明文；macOS目录0700/文件0600，Windows当前用户ACL，原子写；Keychain/MemoryVault/env/SQLite不是生产fallback。

### D-006 — 所有增强能力都是 DSH 插件

- 状态：ACCEPTED
- 决定：微信、飞书、MOSS-TTS、ASR、Context、Memory、Budget、Companion通过host/client plugin和official slots/settings进入DSH。
- 后果：每个能力需 manifest、permissions、migration、compatibility、rollback 和 evidence。

### D-007 — 一个统一 `@penglai/im`

- 状态：ACCEPTED
- 决定：微信/飞书共享 adapter registry、binding、commands、causal router、SQLite、outbox 和 worker supervisor。
- 后果：adapter 只处理厂商协议，不碰 Agent。

### D-008 — IM 保留精确因果链

- 状态：ACCEPTED
- 决定：`MessageId → claimed Turn → durable final output → original route` 是外发硬前提。
- 后果：unknown/desktop/other route fail closed，不按时间或活跃 Session 广播。

### D-009 — Plugin Center 由 loader inventory 定义实际状态

- 状态：ACCEPTED
- 决定：UI 注册 DSH settings slot，host 管 catalog/transaction；actual state 读取 official loader inventory。
- 后果：0.5只管理app签入的离线受信包，无任意npm/Git URL。

### D-010 — 自包含 embedded runtime 与私有 DSH_HOME

- 状态：ACCEPTED
- 决定：Penglai.app 包含固定 Node、DSH closure、profile seed 和第一方插件；运行状态写 app-private DSH_HOME。
- 后果：生产无 PATH/repo fallback、无首次联网 npm install，不默认触碰 `~/.dsh`。

### D-011 — UI 与业务 RPC 只走 official seam

- 状态：ACCEPTED
- 决定：client modules、slots、settings/onboarding 与 Typert `Remote` 是首选。
- 后果：最小 overlay 需 exact version/checksum/ADR/regression；无 schema ad-hoc 管理 HTTP 端点必须移除。

### D-012 — 只保留 main

- 状态：ACCEPTED
- 决定：不创建 branch、worktree、PR 或 tag；清晰小提交普通 push main。
- 后果：push 前 pull --ff-only；未知 owner work 或分叉停线。

### D-013 — 大版本一次验收

- 状态：ACCEPTED
- 历史决定：Grok连续完成0.5的RC0–RC15；Codex最后对exact三平台release set独立验收一次。该三平台范围已被 D-054 的 Apple Silicon 首发决定取代。
- 后果：非账号硬门全绿前，不请求 Owner 反复输入 key、扫码或配置飞书。

### D-014 — 0.5 只做两渠道私聊文本（已取代）

- 状态：SUPERSEDED（D-041）
- 决定：旧“私聊文本only”由私聊text+voice取代。
- 后果：群聊、图片、普通文件、视频、富卡片仍在进入模型前确定性拒绝。

### D-015 — 微信采用官方 iLink 行为合同

- 状态：ACCEPTED
- 决定：固定 Tencent `@tencent-weixin/openclaw-weixin@2.4.6`/commit `cef0bfc390393f716903e16d50408118047f87e0` 作为协议参考，独立实现 QR、验证、redirect、getUpdates、send、recovery、logout。
- 后果：不引入 OpenClaw runtime；每请求生成正确 `X-WECHAT-UIN`；扫码者默认成为唯一允许身份。

### D-016 — 飞书基础连接不使用 Device Flow（已取代）

- 状态：SUPERSEDED（D-048）
- 决定：历史把企业 App ID/Secret 向导当作飞书默认路径，并禁止任何飞书二维码。
- 后果：由 D-048 改为官方 app/registration 一键扫码；用户 Device Flow 仍禁止。

### D-017 — 飞书固定 official SDK

- 状态：ACCEPTED
- 决定：固定 `@larksuiteoapi/node-sdk@1.73.0` 和官方 repo commit `f54b49f3566c52b54c598194b7ed3015e3e24224`；接收使用 `WSClient`/`EventDispatcher`，发送使用 `Client`。
- 后果：事件先在 3 秒内持久入队，再异步调用 DSH；不引入 `openclaw-lark` runtime。

### D-018 — `/新建` 与所有 Turn 都使用 official DSH

- 状态：ACCEPTED
- 决定：命令通过 workspace/default-model/create/followup/resume 等 official API。
- 后果：不自建 session，不让模型解释控制命令。

### D-019 — evidence 从 runner 生成

- 状态：ACCEPTED
- 决定：acceptance registry 唯一定义 ID，聚合器读取真实 runner result。
- 后果：硬编码 PASS、缺 ID、旧 SHA、重复 ID、secret 或假 live 直接 FAIL。

### D-020 — alpha.3 是 IM Complete Local Candidate（已取代）

- 状态：SUPERSEDED（D-033）
- 决定：历史alpha.3目标由0.5.0跨平台公开候选取代。
- 后果：全部alpha artifact/evidence/READY作废。

### D-021 — alpha.3 采用 ad-hoc local candidate（已取代）

- 状态：SUPERSEDED（D-034）
- 决定：旧单机local candidate由三平台community-verified publication candidate取代。
- 后果：仍诚实记录ad-hoc/no notarization，但需完整三平台发行链。

### D-022 — exact release set 是唯一验收对象

- 状态：ACCEPTED
- 决定：private source/tree、public-export tree、三安装包、runtime manifests、signatures、SBOM/notices、native evidence和live nonce共同定义候选。
- 后果：冻结后任何源码、依赖、资源、配置或asset byte变化都作废对应候选并重跑受影响全链。

### D-023 — GitHub Actions 当前不可用

- 状态：ACCEPTED
- 决定：Actions quota不是硬门；使用本地Apple Silicon、Intel/Rosetta预验与native Windows/Intel runner的统一evidence协议。
- 后果：仍须`HEAD=origin/main`、dirty=false；translated/emulated不能冒充native。

### D-024 — 实际分发由用户授权

- 状态：ACCEPTED
- 决定：Grok/Codex只构建和验收private 0.5 publication candidate。
- 后果：Codex PASS前后都不会自动创建公开Release、上传、公告或推进channel；需要用户新的明确授权。

### D-025 — 旧 Keychain profile 显式迁移（已取代）

- 状态：SUPERSEDED（D-035）
- 决定：0.5不再迁移旧Keychain/profile；只读检测legacy generation并要求fresh配置。
- 后果：0.5不枚举、读取、复制或删除旧secret/data。

### D-026 — IM 控制面使用 Typert Remote

- 状态：ACCEPTED
- 决定：host service 继承 `TypertRemoteService`，方法以 `@Remote` 暴露，client 使用生成的 `TYPERT_REMOTE`。
- 后果：DTO 严格、无 secret-returning method；只有必要的短期 QR binary endpoint 可在 ADR 后保留，并须 same-origin/no-store/capability 保护。

### D-027 — 微信扫码者默认单人授权

- 状态：ACCEPTED
- 决定：confirmed 返回的 scanner identity 初始化 owner allowlist；其他身份 fail closed。
- 后果：扩大允许范围需在 DSH Web 中显式操作并留下非敏感审计。

### D-028 — 飞书只请求 0.5 最小权限

- 状态：ACCEPTED
- 决定：基础范围只包含私聊文本/audio接收、resource download、机器人文本/audio upload/send所需权限，订阅 `im.message.receive_v1`；群权限不为未来功能预取。
- 后果：Doctor 必须区分凭据、权限、事件订阅、应用发布和网络错误。

### D-029 — 渠道 worker 是插件生命周期的一部分

- 状态：ACCEPTED
- 决定：enabled 且 configured 的 adapter 由单一 supervisor 自动启动；disable/unload/logout 必须 abort、flush/标记 outbox 并清理 listener。
- 后果：不能依赖 `PENGLAI_IM_START_WORKERS` 决定产品是否工作。

### D-030 — Moss/TTS/ASR/Memory只留迁移台账（已取代）

- 状态：SUPERSEDED（D-041、D-042）
- 决定：旧台账项中的Voice/Context/Memory/Budget/Companion已进入0.5硬范围；任意第三方市场仍不实现。
- 后果：这些插件只有完整实现后才能显示，空卡和“即将可用”开关仍禁止。

### D-031 — Penglai 二次开发保持 DSH capability parity

- 状态：ACCEPTED
- 决定：Penglai 替换 product identity、默认中文 onboarding 并添加插件，但完整保留 official DSH light/dark/system、system 动态响应、zh/en、Models、Workspace、Session、conversation、tools、approvals、permissions 和 settings。
- 后果：建立 machine-readable upstream baseline 和 installed parity suite；任一 missing/hidden/degraded core capability 都阻止候选。

### D-032 — Center 承载分层插件生态

- 状态：ACCEPTED
- 决定：Center区分official-core、Penglai built-in、Penglai first-party和future community-reviewed。0.5内置Center/IM/ASR/MOSS-TTS/Context/Memory/Budget/Companion；社区插件须经来源、许可证、签名/完整性、权限、兼容、隔离、迁移、回滚与安全审核。
- 后果：本版建立 provenance schema/badge/policy 扩展点，但不联网、不接受任意 npm/Git/URL、不显示尚未实现或未审核的假卡。

### D-033 — 当前候选是 Penglai 0.5.0 三平台公开准备版

- 状态：ACCEPTED
- 决定：版本统一为0.5.0，candidateKind=`public-publication-candidate`；用户安装包固定为macOS arm64 DMG、macOS x64 DMG、Windows x64 Setup。
- 后果：旧alpha版本和单DMG计划全部失效；少一target、改名复用或跨arch closure均不能Ready。

### D-034 — 0.5.0 采用 community-verified trust tier

- 状态：ACCEPTED
- 决定：沿用用户认可的0.4.1公开信任边界：macOS ad-hoc/not notarized，Windows无Authenticode；installer/updater/checksums使用独立minisign/Ed25519完整性签名。
- 后果：文档/UI必须诚实提示系统信誉警告，不指导关闭安全机制；未来OS-trusted需另build/重验。

### D-035 — 0.4.1 到 0.5.0 是 clean-generation install

- 状态：ACCEPTED
- 决定：不做自动updater bridge，不迁移会话、credential、config或DB，不删除旧data；0.5使用隔离generation root。
- 后果：只读legacy detector显示fresh安装说明；Workspace与旧data永不进入0.5 delete plan。

### D-036 — 0.5 使用 signed assisted upgrade

- 状态：ACCEPTED
- 决定：从0.5开始检查canonical signed manifest、下载并验签当前平台installer、用户确认后打开原生DMG/Setup，使用update journal完成迁移与恢复。
- 后果：没有Developer ID时不宣称macOS silent auto-update；未来autoUpdater需OS-trusted ADR与真机升级验收。

### D-037 — 升级与卸载属于0.5发布硬能力

- 状态：ACCEPTED
- 决定：Windows提供current-user NSIS与uninstaller；macOS提供设置内数据/卸载向导。默认卸载保留data，complete delete按类别和二次确认。
- 后果：root/home/Workspace/legacy/symlink/junction/reparse、locked failure必须fail closed；不能为方便强删。

### D-038 — 本地native runner取代GitHub Actions依赖

- 状态：ACCEPTED
- 决定：Apple Silicon本机、Intel Mac/等价native runner、Windows x64本机/VM使用统一release contract与evidence bundle。
- 后果：Rosetta/ARM模拟只能预验；缺native时先完成其余工作，最后精确AWAITING，不能伪绿。

### D-039 — deterministic public-export是未来开源同步边界

- 状态：ACCEPTED
- 决定：private source通过allowlist生成可重复public tree与tree hash；三平台artifact绑定private source和public export。
- 后果：未来public commit SHA可不同，但产品树必须等价；验收后不得从不同源码重建资产偷换。

### D-040 — Codex验收先于任何公开操作

- 状态：ACCEPTED
- 决定：本轮只冻结private candidate和publication manifest，开源repo/tag/Release/channel保持未执行。
- 后果：即使Codex PASS，也需用户新的明确授权才开始公开任务。

### D-041 — 0.5 私聊支持 text+voice

- 状态：ACCEPTED
- 决定：微信/飞书授权私聊同时支持文本和语音；入站语音调用`@penglai/asr`，exact durable final可按binding调用`@penglai/moss-tts`。
- 后果：微信硬保证可见可播放audio附件+文本回落，native气泡只凭live capability；飞书使用official native audio。群/图片/普通文件/视频/卡片仍拒绝。

### D-042 — 0.5 恢复Penglai已验证的原生优势

- 状态：SUPERSEDED_BY_D-057
- 决定：早期候选曾将`@penglai/context`与`@penglai/memory`作为两个插件；0.5.5不再采用该包装。
- 后果：保留为历史决策记录，不能用来恢复独立Context产品卡或loader项。

### D-043 — DSH已有能力只复用

- 状态：ACCEPTED
- 决定：Goal/Todo/Skills/MCP/Web/Attachments/Schedule/TokenMeter继续由pinned official DSH拥有；Penglai只做parity、帮助/IM命令composition和差异化插件消费。
- 后果：禁止恢复0.4.1 EpisodeRunner、Task/Run control plane、Skill/MCP/model registry或第二计量/调度核心。

### D-044 — Context与Memory采用显式scope/consent

- 状态：ACCEPTED
- 决定：Context只索引用户显式授权realpath并只删派生数据；Memory分global L1/Workspace/candidates，global/SOP长期写入需visible diff和Owner确认，SOP复用official Skills。
- 后果：来源状态由host验证；模型不能修改源文件、跨Workspace污染或无确认写global/SOP。

### D-045 — Companion默认关闭且无无人值守工具

- 状态：ACCEPTED
- 决定：Companion复用official Schedule与dedicated DSH Turn，fresh关闭；启用需exact binding、quiet-hours、rate、budget与text/voice consent，权限封顶plan/no-unattended-tools。
- 后果：不得伪造用户消息、执行shell/审批、读新目录、群发或扩大allowlist；disable/logout后资源与外发为零。

### D-046 — IM音频转换使用随包固定WASM闭包

- 状态：ACCEPTED
- 决定：微信入站使用`silk-wasm@3.7.1`；飞书双向使用`libopus-wasm@0.2.0`与Penglai受限Ogg容器实现。两者作为`@penglai/im`运行依赖随包携带、锁定integrity/license/runtime hash。
- 后果：安装包不依赖ffmpeg、Homebrew、PATH、Python、PowerShell、postinstall或首次联网；codec magic/checksum/时长/采样率/声道/大小与取消均fail closed。

### D-047 — 前置 pre-DSH 向导取代 DSH Web 内引导遮罩

- 状态：ACCEPTED
- 决定：未完成引导时主窗口加载同源 `/wizard`；ledger COMPLETE 后切入 official DSH Web。
- 后果：不是 DSH Web 内第二套引导，也不是长期自制主 UI。

### D-048 — IM 渠道默认官方一键扫码

- 状态：ACCEPTED
- 决定：微信、飞书和以后的渠道默认官方一键扫码。微信把 iLink `qrcode_img_content` 画成 PNG。飞书走 `accounts.feishu.cn/oauth/v1/app/registration` 创建 PersonalAgent，再把凭据写入 official credentials 并长连接。
- 后果：禁止假二维码和用户 OAuth Device Flow。手动 App ID/Secret 只作后备。

- 状态：ACCEPTED
- 决定：首次引导不再在 DSH Web 内渲染全屏遮罩或注册`settings.onboarding`。未完成引导时主窗口加载经认证代理同源提供的 `/wizard` plain HTML/JS/CSS 前置页；ledger `current === "COMPLETE"` 后切入 official DSH Web。见 ADR 0030。
- 后果：onboarding 不再依赖 DSH Web 先启动；`wizardFinished` 在 official 面加载成功后才下线 `/wizard`，失败则回滚；ledger 是唯一事实源，按非 symlink app-private 文件校验。DSH 的 theme/locale/Models/Workspace/Session/tools/approvals/settings 不变。

### D-048 — IM 渠道默认官方一键扫码

- 状态：ACCEPTED
- 决定：微信、飞书和以后的渠道默认官方一键扫码。微信把 iLink `qrcode_img_content` 画成 PNG。飞书走 `accounts.feishu.cn/oauth/v1/app/registration` 创建 PersonalAgent，再把凭据写入 official credentials 并长连接。
- 后果：禁止假二维码和用户 OAuth Device Flow。手动 App ID/Secret 只作后备。

### D-049 — 发行层拥有用户可见身份，不另造聊天 UI

- 状态：ACCEPTED
- 决定：向导、欢迎页和模型自称均为蓬莱/Penglai。模型身份走 official `system-prompt/assemble` 改写 `harness:identity`。About 保留 DeepSeek Harness 归属。不替换 official DSH 对话 chrome。
- 后果：用户问「你是谁」时不得再自称 DSH；不得借此做第二套 Agent/Session/聊天 UI。

### D-050 — IM 扫码后直接对话

- 状态：ACCEPTED
- 决定：对齐最新 Hermes Agent 与 PenglaiAgent 0.3：一键扫码后，扫码者/创建者私聊自动绑定 official 默认 Workspace/Session，直接发「你好」即可。微信确认后必须立刻 startReceive。飞书长连接后第一条私聊同样自动绑定。微信与飞书共享同一 official 默认 Session（0.3 `owner:default`）。
- 后果：`/绑定 <token>` 与绑定页不再是首次路径；它们只用于换官方会话或额外对端。不得按焦点或最近活动猜测 Session。无 official 工作区时仍 fail closed。覆盖旧“已连接不等于已绑定 / 必须先选 Workspace”作为默认个人路径。

### D-051 — 0.5.0 在冻结前升级到 official DSH rc.8

- 状态：ACCEPTED
- 决定：产品 pin 从 `@deepseek-ai/dsh@0.1.0-rc.7` 升到 GitHub official prerelease `dsh-v0.1.0-rc.8`（commit `141eb6fef83422698aef7a981029e843e8161534`，npm integrity `sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`）。npm `latest` 仍指向 rc.7、`next` 指向 rc.8，因此这不是无条件跟随 dist-tag，而是冻结前按 exact tag、hash、API 与 closure 复验后的显式选择。
- 后果：rc.8 新增的 `sidebar.brand.mark`、`sidebar.brand.name`、`conversation.hero.brand.mark` official single slots 承载 Penglai logo/wordmark，overlay 从四个 DSH 文件缩为 title、首次披露、hero copy/background 三个 UI-only 文件；不再 patch sidebar 或替换 hero icon 实现。rc.8 SQLite 格式与旧版不兼容，0.5 继续执行 clean-generation，不读取、迁移或删除 rc.7/0.4.1 数据。DSH Web 图片能力可透传，IM 的 text+voice-only 拒绝门不放宽。

### D-052 — fresh 是纯 DSH core，可选蓬莱扩展按需安装

- 状态：ACCEPTED
- 决定：安装包离线携带所有已审核第一方 tarball，但 fresh profile 只安装并加载承载品牌、引导续接和目录事务的 `@penglai/plugin-center`。IM、ASR、MOSS-TTS、Context、Memory、Budget、Companion 与 reference 默认不写入 profile `node_modules`、不进入 loader；用户点击“安装并启用”后才验 hash/manifest/DSH/target、事务式安装并读取 actual inventory。
- 后果：DSH 在没有任何可选蓬莱能力时必须独立可用；可选插件页面只随各自 client fiber 出现。Center 是发行管理组件而非可卸载扩展。disable 保留已安装包供以后重启用；uninstall 仍须走资源归零和事务回滚。品牌 single slots 使用 `priority=-100` shadow official priority 0，避免重复注册且保留 official fallback。

### D-053 — Penglai 设置使用嵌套子菜单，语音策略同时提供可视化与命令入口

- 状态：ACCEPTED
- 决定：Center 是“蓬莱”一级设置项；已启用的第一方插件使用保留的 `penglai-*` section id 命名空间。rc.8 official `settings.section` 没有父子字段且 SlotCore 会丢弃未知 option，因此 exact-version/hash 的 settings renderer UI-only overlay 按 id 命名空间把这些 section 渲染为嵌套子菜单，不建内容区第三列。每个 IM binding 在设置页直接管理接收语音、回复模式与 MOSS voice，同时保留 `/语音`、`/声音` 快捷命令；两套入口写同一持久策略。
- 后果：插件未安装/未启用时不出现子项；ASR/TTS 模型下载显示真实进度/速度并复用 operation id。微信 native bubble 只有“发送 live probe → 用户确认可见”后才能启用，失败或未确认继续使用可播放音频附件与 text fallback。

### D-054 — 0.5.0 首发收敛为 Apple Silicon 单一安装包

- 状态：ACCEPTED（Owner 2026-08-20 明确授权）；0.5.1 范围由 D-055 扩展，0.5.0 已发布边界不变
- 决定：0.5.0 公开 release set 只包含 `Penglai_0.5.0_macos_aarch64.dmg`。Intel macOS 与 Windows 的构建、NSIS、ACL、Job Object 等工程资产保留为后续路线，但不属于 0.5.0 支持矩阵、Hard registry 或 Release 资产。Owner 同时授权把脱敏 public-export 替换开源 `PenglaiAgent` 的 `main` 工作树、更新官网并创建 `v0.5.0` Release。
- 后果：发布文案必须明确 Apple Silicon/macOS 13+、ad-hoc/not notarized、0.4.1 clean-generation 边界；不得声称 Intel/Windows 已发布。公开 main 通过普通提交替换旧 Pi/Tauri 产品树，不重写 Git 历史；Release 必须使用私有 main 构建并验收的 exact DMG bytes。

### D-055 — 0.5.1 冻结 DSH 0.1.1-rc.1 并声明三端

- 状态：ACCEPTED（本地工程，尚未授权 push/tag/Release）
- 决定：0.5.1 以 `@deepseek-ai/dsh@0.1.1-rc.1`（tag `dsh-v0.1.1-rc.1`，commit `528c682e061696f5a160f363f236ecbf53cbd006`，npm integrity `sha512-HVauMT0F7MWUctkxzBcu5PMFc8j0lm0kX+4IbcUsA7Oh+/xv7xhigEDP0SaSOM/kR48U/BldHbZru116DcZz0w==`）为唯一核心。release target 为 `darwin-aarch64`、`darwin-x86_64`、`win32-x86_64`。0.5.0→0.5.1 仅手动覆盖；PPDP 与后续同平台 PUDP 属于 0.5.1。
- 后果：不得跟随 npm `latest`/`next`；Intel/Windows 缺原生 runner 时该 target 为 BLOCKED；不得把 ARM Electron 改名成 x64。

### D-056 — 0.5.2 修复 rc.1 首次引导并实测 0.5.1 辅助升级

- 状态：ACCEPTED（Owner 2026-08-22 明确授权修复、三端构建、发布和升级验收）
- 决定：0.5.2 继续固定 DSH `0.1.1-rc.1`，修正完成门禁对 rc.1 `storages/workspace.json`、`global.workspaceIds`、`sessions/**/session.jsonl.zstd` 与嵌套 `credentials.refs` 的读取；“上一步”必须回滚持久引导状态和依赖事实。发布前必须用临时 BYOK 在 Apple Silicon 安装包完成真实模型测试与第一条 Turn，并用公开版 0.5.1 的 PUDP 路径发现、下载和安装公开版 0.5.2。
- 后果：临时 secret 不得进入源码、命令输出、evidence 或 GitHub；Intel Mac 与 Windows x64 仍必须由对应原生 runner 构建并运行安装/插件兼容门禁。0.5.2 Release 继续使用现有离线 Ed25519 信任根、不可变 tag 资产和用户确认的系统安装器，不引入 silent update。

### D-057 — 0.5.5 只有一个蓬莱记忆插件

- 状态：ACCEPTED（Owner 2026-08-23 要求个人上下文与分层记忆真正融合）
- 决定：`@penglai/memory`是fresh profile、catalog、loader inventory与用户界面中唯一的记忆插件。授权资料、FTS5索引、来源卡、分层记忆、图谱、纠错/遗忘与official Skill沉淀编译进同一host/client包。旧`@penglai/context`只作为0.5.3升级输入被移除，其派生索引保留并由Memory接管。
- 后果：隐藏旧卡片或改标题不算融合；fresh/upgrade/installed证据必须反证独立Context package、profile项和inventory行。

## Superseded

已从执行面移出的决议正文：`D-014`、`D-020`、`D-021`、`D-025`、`D-030`。它们仍保留编号以便审计，但不得再当当前产品合同。

- 旧“Keychain 是 R2 必选 credentials provider”由 D-005 取代；旧Keychain迁移方案又由D-035取代。
- 旧“飞书 App 配置后必须走 OAuth Device Flow 才能建立基础 bot”由 D-016 取代。
- 旧“当前R2必须Developer ID/notarization才结束”和旧单机ad-hoc目标由D-034取代。
- alpha.1/alpha.2/alpha.3的READY、artifact hash、closure、soak或live声明不继承到0.5。
- D-033/D-038 的三平台 0.5.0 首发要求由 D-054 取代；跨平台工程保留为后续路线。
- 旧“0.5私聊文本only”由D-041取代；旧“Voice/Memory只留台账”由D-041/D-042取代。

## Deferred

- 微信/飞书群聊、图片、普通文件、视频、富卡片。
- browser/CUA、Companion无人值守高权限工具。
- 任意第三方在线插件市场和远程代码下载。
- silent auto-update、Mac App Store、Microsoft Store、Developer ID/notarization、Windows Authenticode。
- Intel macOS 与 Windows 客户端公开发布；等待后续 native runner、installed evidence 与独立版本决策。
- Linux与Windows ARM。
- 云账户、遥测、跨设备同步、Penglai 托管飞书应用。
- 飞书 user OAuth/Device Flow，直到出现明确 user-scope 功能。

## Rejected

- 自制控制面、第二 Agent runtime、第二主聊天 UI。
- 全局 Node/DSH/PATH 或 repo `node_modules` fallback。
- 独立 BYOK/模型 gateway。
- desired ledger 冒充 loader inventory。
- 微信/飞书各自直接连接 Agent。
- Keychain、MemoryVault、env 或 SQLite 作为本版生产 secret path。
- 飞书假二维码或用户 OAuth Device Flow 冒充 bot 基础连接。
- mock、浅层测试或绿色 CI 代替 installed/live。
- ad-hoc/not notarized artifact 被误称为已公证或 Developer ID 签名。
- 0.4.1数据自动迁移/删除，或卸载器递归Workspace/legacy。
- 未验签updater、可变feed、回退/重放，或无Developer ID却宣传silent auto-update。
- cross/translated/emulated结果冒充native平台通过。
- 未经 Owner 明确授权修改开源仓库、tag、Release或更新channel。
