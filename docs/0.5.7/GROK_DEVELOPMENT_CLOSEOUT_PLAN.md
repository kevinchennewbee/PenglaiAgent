# PenglaiAgent 0.5.7 — 开发交接与发布收口计划

> 计划日期：2026-08-26
> 开发分支：`0.5.7`
> Draft PR：`#94`，目标分支 `main`
> 本文最初交给 Grok Build 执行开发。Owner 后续已授权 Codex 接管开发、Windows
> 真机、审查、合并准备和打包；是否创建公开 tag/Release、切换官网下载与正式发布，
> 仍必须等待 Owner 最终明确批准。

> 2026-08-26 Codex 接管状态：P0 权限/事务、九平台源码、Office、Memory、Windows
> 进程与供应链修复已进入候选验证；本文第 1 节分数是接管前历史基线，不是当前发布分。

## 0. 先读：这轮到底要完成什么

0.5.7 不是“把 DSH-IM 装进蓬莱”，也不是只把九个平台画成九张卡。

0.5.7 的完整目标是：

1. **唯一 Agent 核心仍是官方 DeepSeek Harness。** 固定 `@deepseek-ai/dsh@0.1.1-rc.2`，不再造 Agent、Session、Turn、聊天页或第二套运行时。
2. **唯一消息插件仍是 `@penglai/im`。** 参考 DSH-IM 的协议、交互和工程经验，在蓬莱自己的 Owner、Vault、Artifact、Workspace、Session、Turn 和恢复规则内重写。
3. **真实多平台连接。** 能扫码的平台必须真正做到“点连接 → 展示官方二维码 → 扫码 → 收消息 → 官方 Turn → 回复 → 重启恢复 → 退出清理”；官方本来不支持二维码的平台必须提供最短的官方 Token/App 接入，不得伪造二维码。
4. **办公插件达到普通用户可用的闭环。** 不只是底层有五个窄操作，而是能安全读取、创建、修改、预览差异、生成新 Artifact，并交给支持文件的平台发送。
5. **记忆插件达到可解释、可追溯、可控制的闭环。** Mnemon 仍是唯一记忆引擎；Workspace 隔离、个人记忆、自动整理、检索、纠正、遗忘和来源撤销必须遵守 Main Owner 权限。
6. **把 0.5.6 审计遗留真正关掉。** Owner Broker、首次 profile 事务、Windows 进程回收、Artifact 生命周期、Plugin Center 恢复、IPC、SBOM/许可证和公开声明都属于 0.5.7，不得因为 IM 工作量大而遗忘。

Grok Build 的职责是把源码开发完成并推送到 `0.5.7`。Codex 保留独立审查、Windows 真机安装、真实账号、真实 DeepSeek 全流程、三端原生、合并、打包和正式发布权。

## 1. 当前基线与真实进度

### 1.1 权威仓库

- 权威代码：公开仓库的 `0.5.7` 分支工作树
- 当前本地 HEAD：`4d2ccb886912a585900391a71c2caaec5b03433e`
- 当前远端 `origin/0.5.7`：同上
- `origin/main`：`3102135c6821a044fe4f9b50638c91ce9f5e9cd1`
- PR #94：Draft、OPEN、BLOCKED
- 相对 `origin/main`：47 个提交、263 个文件、约 `+9434/-979`
- 旧 `gh-pages`/历史混合工作树不得作为 0.5.7 源码权威，也不得在那里开发或提交。

### 1.2 上游状态

- 官方 DSH 最新仍是 `dsh-v0.1.1-rc.2`，commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`；没有比 rc.2 更新的官方 tag 或分支。
- DSH-IM 当前复核基线已更新到 unsigned annotated tag `v3.0.5`，peeled commit
  `64587b3b6162fa34f1c3ddb335a254d4154c9175`。完整身份、哈希和取舍见
  `docs/0.5.7/provenance/dsh-im-v3.0.5.md`。
- v3.0.3–v3.0.5 的响应式状态布局和精确国际 iLink host 被选择性重写；企业微信
  中间思考输出和 WhatsApp 群聊被拒绝，后者也已被上游 v3.0.4 撤回。

### 1.3 Grok 已经完成的实质工作

以下不是口头进度，代码已经存在：

- ChannelAdapter V2、九平台注册表、明确连接状态和 fail-closed 入站信封。
- 微信、飞书原有路径继续保留；钉钉、企微、QQ、Slack、Telegram、Discord、WhatsApp 的适配器和连接 UI 已大量实现。
- 微信、飞书、钉钉、企微、QQ、WhatsApp 已有扫码或 device-link 入口；Slack、Telegram、Discord 正确标为官方凭据路径而不是假二维码。
- 九平台 Messaging 卡片、普通/高级设置分层、Owner 操作入口、部分反应状态和失败分类。
- 预算设置已经从 renderer 布尔确认转到 Main Owner receipt 的生产路径。
- IM 路由隔离、部分幂等、Vault 恢复、Plugin Center last-good 事务、supervisor 重启预算、Windows 打包路径、SBOM 截断等已有修复。
- Source CI 和三个 native CI job 在当前 Head 上成功；聚合 CodeQL check 仍失败，PR 仍是 Draft/BLOCKED。

### 1.4 尚未完成或不能算完成

接管前开发完成度按完整 0.5.7 目标约 **67/100**。这是历史开发审查分，不是当前发布分。

| 领域 | 接管前估计 | 当时结论 |
|---|---:|---|
| IM 源码 | 78/100 | 大量真实开发已完成，但新增七平台主要仍是私聊文本；扫码、恢复和发送没有 Codex 真实账号证据，WhatsApp 落盘仍有竞态 |
| Office/Artifact | 45/100 | 安全底座存在，但公开操作过窄，普通用户工作流和多平台文件交付没有闭环 |
| Memory | 65/100 | Mnemon、UI、来源和治理较丰富，但模型写/改/删仍可能把 DSH ask 当成 Owner 权限 |
| Owner/恢复/Windows | 62/100 | 预算和部分事务已修；Companion、首次 profile seed、Windows 孤儿回收仍有 P0/P1 |
| 供应链/文档 | 72/100 | 已有 pin、NOTICE、SBOM 和发布文档；当时最新上游、全部采用来源与 README 事实仍要重做 |

发布分必须等 Codex 完成真机与 live evidence 后重新打分；Grok 不得自行把本表改成 100。

## 2. 不可改变的架构和产品边界

### 2.1 必须保持

- 官方 DSH rc.2 是唯一 Agent 核心和唯一聊天界面。
- Office、Memory 是蓬莱自带、默认启用、可卸载后回到官方 DSH 的第一方插件。
- IM 是单一 `@penglai/im`，九个平台是其内部 adapter，不是九个用户可见插件，更不是整包 DSH-IM。
- Mnemon `v0.2.4` 是唯一记忆引擎；不新增第二个 SQLite/向量库/外部记忆服务作为产品运行时。
- Artifact Service 是 Office 与 IM 文件的唯一产品级文件边界；renderer/模型不得拿到真实绝对路径。
- 高影响动作必须由 Main Owner Broker 生成和消费一次性 receipt；`ownerConfirmed: true`、UUID、复选框和对话中的“我同意”都不是权限。
- 社区插件代码在 DSH 进程内运行，不具有强沙箱。0.5.7 不上线未经完整审核的社区插件商城。

### 2.2 禁止引入

- DSH-IM 的 `lib/**`、`bin/**`、`cordis.patch.yml`、Harness client、独立配置库、独立 Session/Agent/Office runtime。
- `dsh-univer-office` 的完整 Gateway/Viewer/Worktree/大量 `@univerjs-pro/*` insiders 依赖。
- `DSH-Office` 所依赖的外部 `zagens-office` 可执行程序；它不是当前蓬莱供应链的一部分。
- 任意未声明许可证、GPL/AGPL/SSPL/Commons Clause/非商业条款代码，除非产品负责人和法律审查另行批准。
- 社区 Memory 的整库、数据库、全局跨 Workspace 记忆或自动扫描整个磁盘。
- 为了“看起来支持”而返回假 QR、假 connected、SDK 初始化即 live、mock 成功或默认吞掉失败。

## 3. DSH 社区调研结论与采用原则

### 3.1 检索范围

本轮不是只看星数：

- 复核了官方 `deepseek-harness` 当前 refs。
- 当时复核到 DSH-IM v3.0.2；Codex 接管后继续复核到 v3.0.5。
- 检索 `awesome-dsh-plugin` 当前 2231 条插件元数据。
- 名称/描述初筛出 71 个 Memory 候选、21 个 Office/文档候选；其中包含名称误命中，不能把 92 个都称为有效 Office/Memory 项目。
- 对高相关仓库继续看 README、目录结构、源码/测试数量、CI、依赖、最近提交、DSH 版本和许可证，而不是按 stars 排序。

星数只说明关注度，不能替代源码质量、创新性、安全性、兼容性和许可证审查。

### 3.2 Office 高相关候选

| 项目 | 许可证/工程观察 | 0.5.7 决策 |
|---|---|---|
| `dream-num/dsh-univer-office` | 仓库 Apache-2.0；源码规模大、CI/测试链存在、预览/审阅体验有创新；但依赖大量 `@univerjs-pro/*` insiders、Gateway/Viewer/协作运行时，单个根许可证不能替代逐包许可证审计 | 不整包采用。借鉴“schema → edit → verify → preview/approve/discard”和版本化改动体验；自行在 `@penglai/office` 实现 |
| `kw78/dsh-office-tools` | MIT；工作区路径、realpath/symlink 防逃逸、闭合 model tools、Word/Excel/PPT 创建思路清楚，有 CI 和测试 | 高优先级设计参考。不得复制代码，除非先登记 exact commit/path 和 NOTICE；优先独立实现同类安全契约 |
| `didclawapp-ai/DSH-Office` | 插件本身 MIT、有参数测试；实际能力委托本机 `zagens-office` CLI，外部二进制许可证和供应链未进入蓬莱审计 | 不采用运行时；只借鉴 schema-first 的四工具表面 |
| `STARDUSTLC666/dsh-ppt` | MIT；HTML/PPTX 同源主题、manifest、跨平台和测试有创意；手写 OOXML 与现有 pptfast 路线冲突 | 只借鉴结构化 slide spec、主题和“产物+manifest”概念；继续用已审计 pptfast，不引入手写 OOXML |
| `Che-Year/dsh-unidoc` | 文档中心和沙箱 HTML 预览思路有价值；GitHub License API 为 Other，Office 预览实际仍提示不支持 | 不复制代码；仅把文件树/预览降级/未知格式不崩溃作为 UX 参考 |
| `geguanming/dsh-office-plugin` / `Fayelin12/dsh-office` | 名称叫 Office，实质是 Agent 像素办公室或会话面板，不是文档引擎 | 排除，不应误算 Office 能力 |

### 3.3 Memory 高相关候选

| 项目 | 许可证/工程观察 | 0.5.7 决策 |
|---|---|---|
| `00080000/dsh-project-memory` | MIT；rc.2、CI、测试、内容 hash、read-time indexing、BM25 和 `path:line` citation 设计扎实 | 借鉴“只索引已授权且实际读过的来源”、内容 hash 增量更新和可核验引用；不引入其数据库/引擎 |
| `GIT121995/dsh-memory-gate` | MIT；测试和回测较完整；`retrieved != injected`、use/verify/ignore、≤3 claims/1200 chars、审计反馈很有价值 | 借鉴有界注入、置信/裁决说明和审计；不引入第二个 SQLite/FTS5 |
| `Jesse-njx/dsh-memory` | MIT；以 DSH lossless session log 的 `(sessionId,eventRange)` 回指原始事件，测试存在但项目较新 | 借鉴精确会话来源引用；映射到蓬莱自己的 provenance schema |
| `JunNanLYS/dsh-layered-memory` | MIT；rc.2、分层召回和成本看板有创意；源码大但仓库没有明显测试文件，且引入 `sqlite-vec` | 只参考 L0-L3 分层和成本可见性；不引入 runtime/数据库 |
| `988hj7tczd-oss/harness-desktop` memory | MIT；使用官方 `ctx.storage` 和 prompt/tool 生命周期有参考意义；整个桌面项目仍停在较旧 DSH rc.7 | 只参考稳定服务生命周期；不吸收旧 DSH 桌面结构 |
| 其他 Memory/RAG 候选 | 许可证、范围、测试和跨 Workspace 边界差异很大 | 未经逐项晋级不得进入产品。catalog 收录不等于安全审查 |

### 3.4 社区采用四级账本

Grok 新建 `docs/0.5.7/provenance/COMMUNITY_RESEARCH_LEDGER.md`，每个被提及项目必须标一种模式：

1. `survey-only`：只看过，不形成产品设计；README 不宣称基于它。
2. `principle-reference`：借鉴通用思想，独立实现；记录 repo、commit、许可证、借鉴点和未复制代码声明。
3. `selective-rewrite`：阅读具体源码后重写；记录 exact path/commit、对应蓬莱文件、差异、安全边界、许可证和 NOTICE。
4. `vendored/dependency`：复制文件或安装依赖；必须 pin、hash、完整许可证、NOTICE、SBOM、更新/回滚/卸载和安全审查。

没有账本条目的社区项目不能进入源码、依赖、README 功能声明或 Release Notes。

## 4. 阶段 A — 先关闭 P0 权限与事务缺口

这些工作必须先于 Office/Memory 扩展。每项一个小提交，禁止混成大提交。

### A1. Companion Main Owner Broker

现状：

- `packages/companion/src/remote.ts` 仍直接接收 `ownerConfirmed: boolean`。
- renderer 仍发送 `ownerConfirmed: true`。
- `enable`、`disable`、`scheduleReminder` 的生产服务仍以布尔值授权。

要求：

- 新增 Companion 专用 proposal/receipt 路径，或复用现有 Main Owner Broker 的 closed action。
- action 至少闭合：`companion.enable`、`companion.disable`、`companion.scheduleReminder`。
- receipt 必须绑定 action、目标 binding/workspace/session 或 reminder id、可见 diff、过期时间和一次性消费。
- renderer 只请求 proposal 并提交 receipt；删除生产 Remote 的 `ownerConfirmed` 权限语义。
- DSH 对话、模型工具、任意 UUID、重复 receipt、错 action、错 object、过期 receipt 全部 fail closed。
- 增加 production wiring 测试，证明 renderer 布尔值不能启用、停用或创建提醒。

验收：`R57-OWNER-001` 覆盖 Budget、Companion、Memory、Artifact、IM 全部高影响入口，而不是只覆盖 Budget/IM。

### A2. 首次 profile seed 真正事务化

现状：

- `activatePrivateProfile()` 把 `lastGood` 写成即将删除的 `user.profileWeb`。
- 激活阶段先删除目标再复制 staging，不是独立 last-good + 原子切换。
- `recoverProfile()` 看见路径存在时只把 journal 改成 `rolled_back`，并没有恢复旧内容。

要求：

- 首次和后续 profile 激活统一使用独立事务目录：`staging`、`last-good-next`、`last-good`、`activation-backup`。
- 完成 seed、插件安装、package/profile 校验后才进入切换。
- 同卷 rename/swap；Windows 不支持完全相同原子语义时使用明确 phase journal + 可重放恢复，不能 `rm target → copy` 后祈祷不崩。
- 每个 crash point 有测试：staging 前、校验前、备份后、promote 前、promote 后、cleanup 前。
- 恢复必须实际还原可启动 profile，不只是改 journal 文本。
- 不允许 `lastGood` 指向 active target 本身。

### A3. Memory 模型写权限

现状：

- `penglai_memory_remember/correct/forget` 在 `tools/pre-execute` 返回 `kind: ask`。
- 工具真正执行时仍直接调用 Mnemon mutation；DSH ask 是交互提示，不是 Main Owner receipt。

要求（二选一，优先方案 1）：

1. 模型写工具改成 **proposal-only**：只产生候选和可见 diff，由 Main UI Owner receipt 接受后才写入；或
2. 工具执行必须携带并消费 Main Owner receipt，且模型不能自行构造。

同时：

- `search`、`why` 保持只读。
- personal/global 写、纠正、遗忘、来源撤销、导入确认全部使用 receipt。
- Workspace 自动 curator 只产候选；review 模式不得绕过 Owner。
- 增加 production wiring 测试证明 `kind: ask` 后直接 execute 不能写库。

### A4. WhatsApp 凭据与 Signal key 串行落盘

现状：`creds.update` 中 `void persist()`，并发更新可能乱序覆盖，异常也没有进入健康状态。

要求：

- 用单写队列/Promise chain 串行合并 `creds` 与 keys。
- 每次持久化基于最新内存 snapshot；旧写不能覆盖新写。
- 异常必须可观察、转为 degraded/failed，并阻止把连接误报为稳定。
- stop/logout 前 flush；logout 后原子删除加密 session；不在日志出现 JID、QR 或 key。
- 增加并发 `creds.update + keys.set + restart restore + logout` 测试。

## 5. 阶段 B — 真正完成多平台 IM

### B1. “一键扫码”的准确产品定义

以下六个平台必须开发 scan-first 流程：

| 平台 | 0.5.7 接入 |
|---|---|
| 微信 | iLink 官方二维码；二维码状态、辅助验证码、过期刷新、取消、重启恢复 |
| 飞书 | 官方 app/device QR 路径；无法扫码时折叠显示 app credentials fallback，不把创建应用伪装成纯登录 |
| 钉钉 | 官方 device-auth QR + Stream；只有 REGISTERED 且 Stream 已连接才算 connected |
| 企业微信 | 官方智能机器人 QR；只有真实 WebSocket/回调握手成功才算 connected |
| QQ | 官方 QQ Bot QR；C2C 私聊、被动回复额度和 markdown 能力按真实 API 限制 |
| WhatsApp | community Baileys device-link；默认关闭、先显示风险并消费 Owner receipt，再展示二维码 |

以下三平台不得显示二维码：

- Slack：App Manifest/OAuth/最小权限 + bot/app token。
- Telegram：BotFather token。
- Discord：Developer Portal、bot token、Message Content Intent。

它们的“一步式”含义是：一键打开官方页面/复制最小 manifest 或 scopes、一次性粘贴到 Vault、立即做真实握手诊断；不是生成假 QR。

### B2. 每个平台的源码闭环

Grok 必须逐平台完成：

1. `begin → poll/callback → cancel/expire` 状态机。
2. credential 保存到官方 DSH credentials + Penglai Vault；renderer 永远不能读回明文。
3. `start/stop/disconnect/logout/delete credentials` 语义分离。
4. 一条真实私聊入站只创建一个 Official DSH Turn。
5. 回复走原 route 的 channel/account/peer/workspace/session/revision，不猜当前窗口或最近 session。
6. 不确定发送不自动盲重试；有稳定 vendor id 时才幂等重试。
7. 每次重启从持久配置和 Vault 恢复，不能因为 SDK 已实例化就报 connected。
8. 私聊 text in/out 是 0.5.7 的所有平台最低门槛。
9. 群聊默认关闭；没有真实 allowlist/Owner/路由证据就保持 false。

### B3. 文件、图片和 Office 交付

- 保留当前微信/飞书 image/file/audio 能力。
- 为其余 adapter 审核官方 API：能安全发送 image/file 的，新增闭合 `sendArtifact`；不能或尚未实现的 capability 保持 false。
- `sendArtifact` 只接收 Artifact id、闭合 kind、文件名和大小上限；由 Host 取 bytes，不接受模型路径或任意 URL。
- 入站文件先过 Artifact admission，再进入 Office/Memory；不得让 channel adapter 直接把绝对路径交给模型。
- Office 输出发消息时必须创建新 Artifact，不覆盖用户原文件。
- capability 声明与实现、契约测试、README 和 live matrix 必须一致。

### B4. DSH-IM 当前账本

- 保留 `dsh-im-v3.0.2.md` 历史记录，并以 `dsh-im-v3.0.5.md` 作为当前复核基线。
- `third_party/sources.lock.json`、NOTICE 和 SBOM 使用同一 v3.0.5 tag/peeled/hash 身份。
- 明确记录每项采用、拒绝和上游撤回，不把“看过”写成已移植。
- 更新 `DSH_IM_PORT_LEDGER.md`：哪些源码路径形成 selective rewrite，哪些只是 principle，哪些明确拒绝。
- NOTICE 保留原作者、MIT 文本、exact tag/commit/hash；不得含糊写成“受到启发”来规避真实派生关系。

## 6. 阶段 C — Office/Artifact 从底层能力变成用户闭环

### C1. 统一安全入口

- DOCX/XLSX/PPTX/PDF 的 read/create/edit/import/export 全部先走 Artifact policy。
- OOXML zip 在解析前统一检测：magic/type mismatch、macro、ActiveX/OLE、external links、encryption、nested archive、symlink/reparse、zip bomb、单项/总大小/文件数上限。
- `packages/office/src/authorization.ts` 不能只 `readZip(bytes)`；必须复用 Artifact 的统一 admission verdict。
- 输出再次过 admission，再进 CAS；禁止 Office 私自写 workspace 持久文件。
- 原始输入 immutable；每次 edit 产生新 artifact id、parent id、operation digest 和 diff。

### C2. 0.5.7 最低可用操作集

保持 closed typed operations，扩充到普通办公任务能完成：

#### DOCX

- bounded inspect：标题、段落、表格、页眉页脚、警告，不输出整份大文档。
- structured create：标题、分节、段落、项目符号、简单表格、中英文常用字体。
- edit：replace paragraph、insert/append paragraph、replace table cell；按明确 index，不模糊搜全文件替换。
- content controls、复杂编号、宏、嵌入对象仍拒绝或 inspect-only。

#### XLSX

- bounded inspect：sheet、used range、公式/值、合并区域、警告。
- structured create：多 sheet、scalar grid、表头/基本格式、列宽。
- edit：setCell、setRange/batch cells、append rows；限制单次 cell 数和总字节。
- 公式只在输入明确标为 formula 时写入；外部链接、宏、受保护 workbook 拒绝。

#### PPTX

- bounded inspect：slide、标题、text run、图片/图表占位和警告。
- structured create：多页 title/body/bullets/notes/已入 Artifact 的图片，继续使用已审计 `@liustack/pptfast`。
- edit：按 slide + shape/text-run 的明确 id 替换；不再只替换每页第一个 `a:t`。
- 复杂母版、宏、未知嵌入对象保持 inspect-only；不引入手写 OOXML 新引擎。

#### PDF

- inspect：metadata、pages、bounded text、加密/签名警告。
- create：文本/简单报告，使用已审计 CJK 字体。
- edit：watermark、rotate、merge；merge 必须成为正式 closed operation。
- 不声称像 Word 一样编辑 PDF 段落。

### C3. 用户工作流

模型工具表面采用清楚的四段式，但不是复制第三方 runtime：

1. `office_inspect(artifactId)`
2. `office_create(spec)` / `office_edit(artifactId, operations)`
3. `office_preview(jobId)`：显示输入摘要、操作列表、结构化 diff、警告和输出摘要
4. `office_accept(jobId)` / `office_discard(jobId)`：accept 产生新 Artifact；持久化到 Workspace 仍需 Main Owner receipt

要求：

- 模型先取得 schema，再提交闭合 spec。
- preview 是诚实的结构化预览；没有真实渲染器时不得叫“像素级预览”。
- Office Settings 不再用固定 `B1`、slide 0、paragraph 0 冒充用户工作流。
- 十个模板从单字符串 demo 升级为结构化 spec，并覆盖中文简历、报告、会议纪要、合同/公文、预算、分析和汇报。
- 增加每种格式的 round-trip、恶意输入、限额、父子 Artifact 和 IM handoff 测试。

### C4. Artifact 生命周期

- 在生产启动或有界 maintenance tick 调用 `ArtifactService.gc()`；当前只有 deleteWorkspace/tests 调用不够。
- GC 有时间预算、批量上限和并发锁，不阻塞 DSH 启动。
- 正在 outbox、Office job、下载或持久化事务引用的 Artifact 不得回收。
- crash 后能清理过期临时 CAS，同时保留持久 Artifact 和审计记录。

## 7. 阶段 D — Memory 插件补全，而不是换引擎

### D1. 保持 Mnemon 唯一引擎

- `mnemon v0.2.4`、三端固定资产、hash 和数据目录保持不变。
- 不引入 `dsh-project-memory`、`memory-gate`、`dsh-memory`、`layered-memory` 的数据库或运行时。
- 所有社区借鉴通过 Penglai schema、Owner Broker、Workspace Registry 和 Mnemon adapter 独立实现。

### D2. 可核验来源

- 每条自动/手动记忆保存 provenance：scope、workspace hash、session id、event/turn range、授权来源、created/updated/supersedes。
- `why(id)` 返回可见的来源摘要和可展开引用；不得只说“模型记住了”。
- 文件来源引用尽量使用 `artifact id + logical path + bounded locator`，不暴露绝对路径。
- source 被撤销或文件 hash 改变后，对应记忆标 stale/withdrawn，不继续无提示注入。

### D3. 检索到不等于注入

- 搜索可以返回候选；进入 system prompt 前必须有 bounded gate。
- 默认最多 3 条、最多 1200 个字符或更严格 token budget；按实际 prompt budget 取更小值。
- 每条标 `use / verify / ignore` 及原因：scope、freshness、source availability、confidence、冲突状态。
- 冲突记忆不能同时作为确定事实注入；显示 verify 或保持候选。
- 近重复通过 supersedes/merge 关系处理，保留审计，不能静默覆盖。

### D4. 自动 curator 的成本和故障边界

- 保持单独官方 Agent、deny tools、当前 Workspace 隔离。
- 增加明确 timeout、max tokens、每 session/小时调用上限、并发 1、circuit breaker 和失败退避。
- curator 失败不阻断普通对话；不得无限重试或在每次启动重复整理全部历史。
- 内容 hash/turn watermark 防止重复整理。
- Budget 插件能看到 curator 成本类别，但 renderer 不能修改账本。

### D5. 来源索引

- 只索引 Owner 授权的 root/artifact，或 Agent 在官方 Workspace 内实际读过且 policy 允许的文件。
- 不后台扫描整个磁盘，不越 Workspace，不跟随 symlink/reparse。
- 内容 hash 未变化不重做；删除/撤销来源后索引和派生记忆进入可审计清理流程。
- 搜索结果是 untrusted facts，不把文件内容当系统指令。

## 8. 阶段 E — Runtime、Plugin Center、Windows 和性能余项

### E1. Windows 孤儿 DSH 回收

现状：`reapDshOrphans()` 的 win32 分支即使 native helper 存在仍直接返回 `[]`。

要求：

- 通过 bundled native helper 枚举由 Penglai 标记/拥有的 DSH process/job。
- 匹配 pid、start time、exe、cmdline digest、owner marker/app root；不允许按进程名广杀。
- 保留当前活跃 supervisor/job，只杀确认属于旧 Penglai generation 的孤儿。
- 返回实际 killed 清单用于红acted doctor，不暴露用户路径。
- 增加 helper contract、stale identity、PID reuse、非 Penglai node 不杀的 Windows 测试。

### E2. 第一方插件重复解包

- `activatePrivateProfile()` 当前已有 profile 时仍每次调用 `installFirstPartyPlugins`。
- 为每个 first-party archive 记录 sha256、size、manifest version 和 installed inventory。
- 全部一致时跳过解包；变化时 staging → verify → atomic promote。
- 不以 mtime 作为唯一真相；失败回到 last-good。

### E3. Plugin Center 和 IPC 复审

- 对已实现 last-good transaction 做 crash matrix，确认所有 phase 都可重放。
- DSH Web origin 只能使用健康、麦克风、Owner proposal 和受控 HTTPS；recovery/delete/open/update/restart 继续保持 origin/capability/expiry 限制。
- 社区代码默认禁用；没有真正进程隔离前不得在普通 Plugin Center 中显示“已审核可一键安装”。

### E4. CodeQL 聚合失败

- 单独确认失败 check 是 GitHub App/聚合配置还是源码/规则失败。
- 不通过重命名 required check、删除保护或把失败标 optional 来“变绿”。
- 若是外部 App 无效 check，记录 GitHub run/结论和仓库配置修复；PR 只有在 required checks 真实绿后才可 Ready。

## 9. 阶段 F — 全部采用项目、许可证、NOTICE 和 SBOM

### F1. 采用来源分类

完整盘点必须包括：

- 核心/运行时：DeepSeek Harness、Electron、Node、TypeScript、pnpm。
- Office：docx、mammoth（若实际 runtime 使用）、exceljs、pptfast、pdf-lib、fontkit、Noto Sans SC。
- Memory：Mnemon、历史 dsh-mnemon seam/reference。
- IM：DSH-IM reference、Tencent openclaw-weixin、Lark SDK、dingtalk-stream、Baileys，以及 Slack/Telegram/Discord/QQ/WeCom 直接 runtime dependencies。
- Voice：SenseVoice/sherpa-onnx、MOSS-TTS、onnxruntime、sentencepiece、silk/libopus 等实际 closure。
- 文案/模板：gongwen skill 等形成派生内容的来源。
- 本轮社区 principle/selective rewrite 项目。

### F2. 许可证门禁

- `scripts/audit-licenses.mjs` 不能只硬编码一小部分包；必须从实际生产 closure/SBOM 检查每个 runtime direct/transitive package 的 name、version、license、integrity。
- 每个 copied/modified file、native binary、model、font、protocol reference 都有 exact source、commit/tag、hash、许可证和使用方式。
- MIT/BSD 保留版权与许可文本；Apache-2.0 保留 LICENSE/NOTICE、修改说明及必要专利条款；OFL 字体保留 OFL/NOTICE。
- GitHub License API 为 `Other`/`null` 不等于不可用，也不等于可用；必须读仓库实际 LICENSE。未能确定时禁止复制/打包。
- 一个仓库的 Apache-2.0 不能自动覆盖其 `@univerjs-pro/*` 等所有依赖；逐包审计。
- `sources.lock.json`、NOTICE、README acknowledgment、SBOM 和 installer 内第三方声明必须一致。

### F3. 当前需纠正的记录

- Mnemon 当前官方仓库显示 Apache-2.0；统一 `sources.lock.json`、NOTICE、manifest 和 audit script，不再含糊写 `MIT + Apache-2.0`，除非有精确双许可文件证据。
- DSH-IM 加入 v3.0.5 当前 audit、选择性吸收和明确拒绝结论。
- README acknowledgment 增加 DSH-IM、pptfast 及实际形成产品能力但当前仅在 NOTICE 中出现的项目；中英文一致。
- 新平台 dependencies 全部进入 runtime license gate 和 SBOM，不只列在 lockfile。

## 10. 开源社区致谢和对外沟通规则

### 10.1 GitHub 习俗

- **不要为单纯说“谢谢”开空 PR。** PR 应包含对上游有价值、可审查的代码/文档/测试改动。
- **不要默认开“感谢 Issue”。** Issue 通常用于 bug、具体改进或可执行讨论；纯感谢会增加维护者的处理负担。
- 优先在 Penglai 的 README、NOTICE、provenance ledger 和 Release Notes 公开准确致谢，并链接 exact upstream。
- 若上游开启 Discussions，可在采用落地后发一条简短、事实清楚的 Showcase/Thanks；若没有 Discussions，只有在能提供真实使用反馈、兼容性结果或改进建议时才开 Issue。
- 若我们修复了上游可复用的问题，按对方 CONTRIBUTING 提交小而聚焦的 PR；先自审、带测试和上下文。

### 10.2 对外发出前的批准

Grok 不得替用户向任何外部仓库发 Issue、PR、Discussion 或评论。

Codex 在实际采用和最终审查后准备：

- 目标仓库与维护者可见的贡献指南。
- 我们实际采用的功能、Penglai 文件/版本、采用方式和许可证履行。
- 中英文草稿。
- 为什么选择 README/NOTICE、Discussion、Issue 或 PR。

由产品负责人逐条批准后再发。

### 10.3 中英文事实模板

仅在事实完全确定后使用，不得预填尚未发布的功能：

```text
中文：
您好，我们在开源桌面项目 PenglaiAgent 的 [具体模块/版本] 中，参考了贵项目
[repo] 的 [具体设计/具体文件]。我们保留了 [许可证/版权/NOTICE]，并在
[Penglai 链接] 记录了 exact commit 和我们的重写差异。特别感谢您在
[具体工程问题] 上的工作。如果我们的兼容性结果或文档能反向帮助项目，我们很愿意按
CONTRIBUTING 要求补充测试或提交一个小 PR。

English:
Hello! In PenglaiAgent's [module/version], we referenced [specific design/files]
from [repo]. We preserved the applicable [license/copyright/NOTICE] and recorded
the exact upstream commit and our rewrite differences at [Penglai link]. Thank
you especially for the work on [specific engineering problem]. If our
compatibility findings or documentation would be useful upstream, we would be
happy to contribute tests or a focused PR following your CONTRIBUTING guide.
```

## 11. 文档与公开事实更新

Grok 在源码工作结束后更新，但不得写发布成功：

- `README.md` 中英文功能、限制、致谢。
- `docs/PRODUCT.md`、`ARCHITECTURE.md`、`IM_PLUGIN.md`、Office/Memory capability matrix。
- `docs/0.5.7/ACCEPTANCE_DELTA.md` 增加 Companion、Memory mutation、Office、Artifact GC、Windows reaper、license closure acceptance ids。
- `docs/0.5.7/LIVE_IM_MATRIX.md` 仍保持 Codex 未跑的行是 `LIVE_NOT_RUN/BLOCKED`；Grok 不得填 PASS。
- `docs/0.5.7/PR94_BODY.md` 更新到真实新 Head，删除已经过期的 toolchain/CI 描述。
- `docs/RELEASE_NOTES_0.5.7.md` 写“候选功能”，不写 public SHA/Release URL/已上线。
- `website/` 只写已有源码能力，九平台“正式支持”仍由 Codex live evidence 决定。

## 12. Grok 的源码级测试职责

“不做本机真机测试”不等于不测试源码。Grok 必须完成：

- format/lint/typecheck。
- unit、contract、security、dependency、license、SBOM、secret scan。
- Owner production-wiring tests。
- IM 各平台 mock server/recorded fixture contract tests；fixture 不含真实 secret/QR/user id。
- Office round-trip、恶意文件、限额、事务和 Artifact tests。
- Memory provenance、bounded gate、Owner、curator budget 和 source revoke tests。
- Runtime crash-point、Windows helper contract 和 plugin extraction skip tests。
- 更新 CI workflow，使以上源码门禁在 GitHub 的 pinned Node/pnpm 上运行。

若 Grok 本机工具链不是仓库固定的 Node `22.22.2` / pnpm `10.14.0`，不要全局改用户电脑，也不要把错误版本产生的结果当 PASS；使用仓库/CI 固定工具链或记录 `BLOCKED_TOOLCHAIN` 后推送让 CI 跑。

## 13. 明确不属于 Grok 的工作

Grok 不要继续消耗时间做：

- Windows Setup 真机安装/卸载/重启/恢复 UI。
- 用户提供的 DeepSeek API key 全流程或任何真实 secret。
- 微信、飞书、钉钉、企微、QQ、Slack、Telegram、Discord、WhatsApp 真人账号扫码和收发。
- macOS ARM/Intel 真机安装、签名、公证。
- Release candidate 最终打包、哈希、公开下载 readback。
- PR Ready、merge main、tag `v0.5.7`、GitHub Release、官网部署。
- 向外部仓库发 Issue/PR/Discussion/评论。

这些全部由 Codex 独立复审并在产品负责人批准下执行。

## 14. 提交顺序

建议保持每个提交一个审查主题：

1. `fix(owner): bind companion mutations to main receipts`
2. `fix(runtime): make first profile activation crash-safe`
3. `fix(memory): make model mutations proposal-only`
4. `fix(whatsapp): serialize encrypted auth persistence`
5. `feat(im): close scan-first connection state machines`
6. `feat(im): add capability-gated artifact delivery`
7. `feat(office): unify artifact admission and typed jobs`
8. `feat(office): complete bounded create inspect edit operations`
9. `feat(memory): add cited bounded recall gate`
10. `fix(runtime): reap owned windows orphans and skip unchanged plugin unpack`
11. `fix(artifacts): run bounded production gc`
12. `build(supply-chain): close licenses notices and sbom`
13. `docs(0.5.7): refresh community ledger and candidate truth`

每个提交都应：

- 只包含该主题文件。
- 带相应测试。
- 不改 release identity 为已发布状态。
- 不包含 API key、token、二维码、手机号、账号 id、真实聊天内容或用户路径。

## 15. Grok 停线交接格式

完成源码开发后：

1. 确认只在 `0.5.7` 分支。
2. 提交并推送 `origin/0.5.7`。
3. 更新 Draft PR #94，但不要 Ready/merge。
4. 输出一个交接表：

| 字段 | 必填内容 |
|---|---|
| Head | full SHA |
| Commits | 本轮提交列表 |
| Scope | 每阶段完成/未完成 |
| Tests | 命令、exit、CI URL；区分 local/CI |
| P0 | 是否全部关闭；若否列 exact file/line/reason |
| IM | 每平台扫码/凭据、text、artifact、restore 的 source/contract 状态 |
| Office | 每格式 operation 和拒绝边界 |
| Memory | Owner、provenance、bounded gate、curator 状态 |
| License | 新增来源、许可证、NOTICE、SBOM |
| Deferred | 只列真正留给 Codex 的 native/live/release，不得把源码缺口甩给 Codex |
| Secrets | 声明未使用/未记录真实 secret |

Grok 的最后一句应是：

> Development complete on Draft PR #94 at `<full SHA>`. Native installed, live-account, merge, tag, release and deployment remain NOT_RUN and are reserved for Codex/Owner review.

## 16. Codex 最终阶段（不由 Grok 执行）

收到 Grok 新 Head 后，Codex 将从零独立验证：

1. 清洁 clone、diff/commit/provenance/secret/security review。
2. 固定 Node/pnpm 跑全部源码门禁和许可证/SBOM。
3. Windows x64 真机 Setup：Welcome、DSH、九张 Messaging 卡、Office、Memory、重启、升级/卸载、进程残留。
4. 使用环境变量注入真实 DeepSeek key，完成模型、工具、Memory、Office/Artifact 全流程；secret 不写 Git/文档/日志。
5. 按账号条件逐平台扫码/凭据、私聊收发、Official Turn、重启恢复、退出清理和 artifact 交付。
6. macOS ARM/Intel 原生候选、签名/公证、Windows 签名与三端 evidence。
7. 复核 PR checks 和所有 P0/P1；决定是否把 PR 标 Ready。
8. 只有产品负责人批准后才 merge main、tag、Release、readback、官网部署。
9. 根据真实采用结果准备上游中英文致谢/反馈草稿，逐条获得批准后再对外发送。

只有以上全部满足，0.5.7 才能从“开发候选”成为“100 分可发布版本”。
