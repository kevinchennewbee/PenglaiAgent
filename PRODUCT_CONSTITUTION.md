# 蓬莱产品宪法

> 生效日期：2026-08-16；历次公开边界记录于决策日志。2026-08-24 Owner 授权公开发布 **Penglai 0.5.6**。2026-08-27 Owner 授权发布 **Penglai 0.5.7**，并决定不随包分发 WhatsApp 社区协议 runtime，以避免其 GPL 传递依赖带来的发行风险。2026-08-28 Owner 进一步决定：**Penglai 永久不再支持、接入、展示、实验或规划 WhatsApp**。2026-08-29 Owner 固定 0.5.8 的 DSH 源码基线为 `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`。2026-08-30 Owner 决定 0.5.8 使用该固定官方源码建立可复现本地包闭包，不等待官方 npm，并授权完成三端发布。2026-08-31 Owner 决定 **Penglai 0.5.9** 整体迁移到官方 npm `alpha` 通道的 DSH `0.1.2-alpha.2` 完整 cohort，并要求同步全部第一方插件与插件中心，在完整门禁后合并、构建三端并发布；已经公开的 0.5.8 保持不可变。2026-09-03 Owner 授权 **Penglai 0.5.10** 完整开发、正常测试、推送与 PR 合并、三端原生构建、完整发布及 README/官网收尾，固定官方 DSH `0.1.2-rc.1` npm cohort；明确排除两小时测试。本地操作 SOP 不进入公开仓库。本文是仓库内最高产品约束。用户最新明确指令高于本文；方向改变时必须先同步本文和决策日志，再开始编码。

## 一句话定义

**蓬莱是以官方 DeepSeek Harness（DSH）为唯一核心的本地桌面发行版：把固定并验证过的 DSH、运行时、官方 DSH Web UI、Pi 多模型 BYOK 首次引导，以及经过兼容性门禁的蓬莱插件中心，打包成普通用户可以安装和使用的软件。**

微信、飞书、Moss TTS、ASR、记忆及以后所有蓬莱增强能力，全部以 DSH 插件存在；它们不是第二套 Agent、第二套会话系统或第二套前端。

架构上可把 DSH 理解为蓬莱所发行的平台，把蓬莱理解为面向普通用户的 DSH 产品发行版：安装向导完成后，即使不启用任何蓬莱增强能力，用户也必须能直接使用完整 DSH；蓬莱负责易安装、易配置、可靠更新、品牌体验与经过审核的插件组合。这个类比只说明责任边界，不表示复制 Linux/Ubuntu 的具体技术实现。

## 不可违反的十二条规则

1. **DSH 是唯一核心。** Agent loop、Workspace、Session、Turn、工具、审批、模型目录和基础 Web UI 均由官方 DSH 拥有。
2. **主窗口就是 DSH Web UI。** 安装、首次引导、修复等短暂页面可以由外壳提供；完成引导后，不得用蓬莱自制聊天页、健康页或控制台替代官方 DSH Web。
3. **BYOK 复用 DSH 的 Pi 模型体系。** 复用官方 Models、模型发现、默认模型和 `credentials` service；不得另造模型 registry、供应商 gateway 或平行密钥库。
4. **0.5 使用官方 YAML credentials。** API key、微信 token、飞书 App Secret 等都通过官方 `credentials.set/describe/resolve/unset` seam 管理，由 `@deepseek-ai/dsh-credentials-local` 写入 app-private `DSH_HOME/.credentials.yaml`；renderer 永远不能读回明文。Keychain 不是 0.5 产品路径。macOS 用目录/文件 mode 收紧，Windows 用当前用户 ACL 收紧。
5. **增强能力都是可独立组合的 DSH 插件。** Host 能力和 Web 界面通过 DSH/Cordis 插件、client module、slot、settings/onboarding 扩展点接入。任一可选插件缺失、disabled、未配置或升级失败，都不能阻断 DSH core 或无关插件；组合能力只通过标准类型化 service 形成。上游确无扩展点时，只能做有版本门、checksum、ADR 和回归测试的最小 overlay。
6. **IM 是一个第一方插件。** `@penglai/im` 内含统一绑定、命令、因果路由、持久化、恢复和 adapter registry；微信、飞书只是 adapter，不能各自直接调用 Agent。ASR/TTS/Context/Memory/Budget/Companion 都是独立 DSH 服务插件，IM 只能通过类型化能力接口调用，不能把这些引擎复制进 adapter。
7. **IM 连接必须诚实。** 0.5.7 的历史发行边界为八个平台连接入口，WhatsApp 当时仅保留不可操作的兼容性说明卡且未分发 runtime、设备绑定或二维码。从 0.5.8 起，现行产品面、catalog、manifest、路由、adapter/runtime、依赖、安装包、测试矩阵和路线图都不得再出现 WhatsApp；它不是延期、实验或未来能力。微信使用真实 iLink QR，飞书只使用官方应用注册/凭据路径。Slack、Telegram、Discord 禁止伪装扫码。QQ 只做官方 Bot 路径。扫码或配置成功后仍需绑定 exact official Workspace/Session；不得按最近窗口猜 scope。
8. **插件中心属于 DSH Web。** 蓬莱插件中心嵌入 DSH Plugins settings，并以真实 loader/profile inventory 为唯一事实源；desired/config 写入不能冒充 installed/active。0.5 可把审核过的插件代码离线预装进安装包，但用户仍可在 DSH 内自行组合；未下载模型、未授权目录、未设策略或未同意主动外发时，插件必须保持真实惰性状态。
9. **安装包必须自带可运行产品。** 干净 Mac/Windows 不应预装 Node、pnpm、Python、系统 ffmpeg 或 `dsh`。包内固定目标平台运行时、完整 DSH 闭包、profile seed、第一方插件（含语音 native/WASM engines）、许可证、SBOM 与完整性清单；生产禁止静默回退系统 PATH。大型 ASR/TTS 权重可在用户明确操作后按 immutable manifest/hash 按需下载，不得成为 DSH 启动依赖。
10. **二次开发不得删减 DSH。** Penglai 可以替换产品名、字标、欢迎/引导文案和默认组合，并增加 Center/IM；但 official DSH 的浅色、深色、跟随系统动态主题、中英文切换、Models、Workspace、Session、工具、审批和设置能力必须保留。中文是 fresh install 默认值，不是删除 English。
11. **安装、升级、卸载是产品能力。** 0.5.0 必须提供 fresh install、首次引导、0.5 系列后续升级、失败恢复和完整卸载/数据管理；升级或卸载不得误删用户 Workspace、旧版本数据或未明确选择的数据类别。
12. **公开发布只消费精确验收资产。** 0.5.0 的历史边界是单一 Apple Silicon DMG；0.5.1 之后（包括 0.5.7）声明三个 target：`darwin-aarch64`、`darwin-x86_64`、`win32-x86_64`，必须来自同一 source SHA。缺对应原生 runner 的 Intel/Windows 只能写 `BLOCKED`/`NOT_RUN`，不得写成 native PASS。公开 Release 必须上传验收过的同一 bytes，不能重建偷换。提交源文件不得伪造无法自引用的 commit SHA。

插件生态分三层：DSH official core plugins 原样保留；Penglai 原生插件由蓬莱维护并经 Center 事务管理（0.5.7 的用户产品为蓬莱消息连接、蓬莱办公、蓬莱语音识别、蓬莱语音生成、蓬莱记忆与蓬莱主动陪伴；旧 Context 仅作迁移）；社区插件未来只有在来源审核、签名/完整性、权限、兼容、隔离、迁移和回滚门完整后才可加入受控 catalog，绝不等同于任意 npm/Git 安装。社区代码在缺少运行时隔离时不得启用。

## 责任边界

| DSH 官方拥有 | 蓬莱发行层拥有 | 蓬莱插件拥有 |
| --- | --- | --- |
| Agent、Session、Workspace、Turn、工具与审批 | 发行安装器、启动器、进程监管、私有 `DSH_HOME`、升级、回滚、卸载、Doctor | 微信/飞书协议、Moss TTS、ASR、记忆等具体能力 |
| Pi 多供应商模型、Models、默认模型 | 首次引导编排和品牌说明 | 对应设置页、状态、权限说明和运行逻辑 |
| `credentials` service 与 credentials-local | 不替换官方 provider；确保目录/文件权限、迁移与诊断 | 只持有 CredentialRef；需要秘密时由 host 解析 |
| 官方 DSH Web UI 与 UI slots | 最小桌面菜单、窗口、安全代理 | 通过官方 client slot/settings 注入界面 |
| Cordis loader、profile 与 inventory | 受控 catalog、事务安装、兼容门与回滚 | manifest、迁移、健康与兼容测试 |

## 当前发行边界

- 当前产品与发布契约为 **Penglai v0.6.1**（D-071）。公开下载身份在不可变
  `v0.6.1` GitHub Release 回读前仍是已发布的 **v0.6.0**。已发布的
  **v0.5.10**、**v0.5.11**、**v0.5.12** 与 **v0.6.0** tag 与附件保持不可变。
  0.6.1 消费官方 DSH `0.1.5-rc.1` 完整 npm cohort（tag
  `dsh-v0.1.5-rc.1` / commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`，
  279 包）。机器可读候选身份来自 `packages/release-identity/src/pins.ts` 与
  `release-contract.json`。公开下载事实只来自不可变 GitHub Release 回读。
  蓬莱办公与蓬莱记忆为 required-builtin DSH 插件；消息连接、语音识别、
  语音生成、主动陪伴随包但默认关闭。UOS 20 原生安装/启动/功能为 Owner
  发布后验收（`OWNER_POST_RELEASE`），不得标 PASS。
- 四个 target key 全仓统一：`darwin-aarch64`、`darwin-x86_64`、`win32-x86_64`、
  `linux-loong64`（统信桌面操作系统 20 专业版 1070 / Loongson-3A6000-HV /
  内核 4.19.0-loongson-3-desktop，旧世界用户态；不是 V25）。0.6.0 目标安装包在身份改写后为
  `Penglai_0.6.1_macos_aarch64.dmg`、`Penglai_0.6.1_macos_x64.dmg`、
  `Penglai_0.6.1_windows_x64_setup.exe`、`Penglai_0.6.1_uos_loong64.deb`。
  禁止把 ARM Electron 改名成 Intel 包；禁止把 Windows 预检、交叉编译、QEMU
  或 linux-x64 写成龙芯 native PASS。可行性备忘或三端发布不能冒充四端完成。
- 0.5.0 已发布的 Apple Silicon 客户端只能手动覆盖安装到 0.5.1；0.5.1 之后同平台才走 PUDP。不得声称 0.5.0 可一键升级。Intel/Windows 在 0.5.0 没有客户端，视为全新安装。
- PPDP 是 0.5.1 产品能力，不是未来 TODO：签名目录、受限 GitHub 资产下载、默认禁用、主进程 Owner capability、DSH loader/profile 事务、inventory 回读。
- 本地语音与第一方插件合同：`@penglai/asr`、`@penglai/moss-tts` 必须进入真实 DSH loader/Center，并服务 DSH Web 与 live 微信/飞书的受支持能力。会话 Read 朗读原文，不冒充翻译。`@penglai/office` 与 `@penglai/memory` 是 required-builtin；`@penglai/im`、`@penglai/asr`、`@penglai/moss-tts`、`@penglai/companion` 随包且默认关闭。旧 `@penglai/context` 只用于迁移。Goal/Todo/Skills/MCP/Web/图片 Attachments/Schedule/TokenMeter 使用 official DSH。alpha.2 已有 official generic file Turn（uploadFile receipt）；仍不得用 DOM hack 或第二会话引擎补齐，也不得在 Penglai 未接线前宣称会话输入框支持普通文档。
- fresh 安装完成引导后必须先得到可独立使用的 official DSH core，并且 Office 与 Memory 已在 official inventory 中 `active`。IM、ASR、MOSS-TTS、Companion 默认未加载。
- 0.4.1 到 0.5.0 是明确的架构代际切换：不提供自动升级，不导入旧会话、凭据或配置，不删除旧数据。0.5.0 使用隔离的数据根 `Penglai/0.5`。0.5.1 必须提供 rc.8 → rc.1 的显式、可回滚数据迁移。
- community trust tier 不变：macOS ad-hoc / not notarized；Windows 无 Authenticode/SmartScreen 声誉。安装包及更新/插件清单仍须有 SHA-256、SBOM/notices，并诚实提示系统信誉警告。Penglai 自己的 Ed25519 更新/插件签名必须使用。
- GitHub Actions 与 required CodeQL 当前可用，但不能替代安装包验收。Apple Silicon 本机可产生 darwin-aarch64 候选；Intel 与 Windows 的 native PASS 必须来自对应原生 runner。交叉构建或 Rosetta 只能作为补充证据。
- 默认“智能整理 Workspace”：自动 curator 必须走 official Agent、禁用工具、Host 封闭校验，只能把安全项目事实写入 exact Workspace；个人/全局记忆仍需 Owner 确认，召回不得跨 Workspace。
- Owner 已授权 **Penglai 0.5.11** 完整开发、正常测试、推送与 PR 合并、三端原生构建、完整十项附件发布及 README/官网收尾；固定官方 DSH `0.1.2-rc.1` npm cohort；明确排除两小时测试。该授权已完成。已发布的 0.5.10 与 0.5.11 tag 与附件不得改写。临时 API key、聊天正文、二维码、账号身份、私有路径、profile、凭据或私钥仍不得上传。
- **0.5.11 发布授权**（D-067，已完成）：消费官方 DSH `0.1.2-rc.1` 完整 254 包 npm cohort；当时拒绝用不完整的 `dsh-v0.1.3-alpha.1` 标签混装。公开身份为 **0.5.11**。精确冻结记录见 `docs/0.5.11/COHORT_FREEZE.json`。
- **0.5.12 全流程授权**（D-068，已完成）：完整开发、上游升级适配、缺陷修复、正常测试、推送与 PR 合并、三端原生构建、精确十项附件不可变发布及 README/既有官网更新与公开回读。官方 DSH `0.1.3-alpha.2` 完整 263 包 npm cohort。该授权已完成。已发布的 0.5.12 tag 与附件不得改写。精确冻结见 `docs/0.5.12/`。
- **0.6.0 全流程授权**（D-070，已完成公开发布）：官方 DSH `0.1.5-alpha.1`、四端安装包与不可变 `v0.6.0` 附件。该授权已完成。已发布的 0.6.0 tag 与附件不得改写。UOS 真机安装/启动/功能仍为当时记录的 `OWNER_POST_RELEASE`，不是后续版本的自动 PASS。
- **0.6.1 源码与代表包授权**（D-071）：完整开发、官方 DSH `0.1.5-rc.1` 队列与第一方/伴随插件适配、审计缺陷修复、正常确定性测试、本地 `codex/0.6.1` 提交，以及供 Codex GUI 验收的 Apple Silicon 代表包。本阶段不创建 PR、不合并 `main`、不打 tag、不上传、不部署公开下载。包数以实际依赖图为准。明确排除两小时测试；`test:soak` 保留。UOS 真机仍须单独取证。精确冻结见 `docs/0.6.1/`。
- **0.6.1 IM 追踪与可选 iMessage**（D-072）：继续第一方改写追踪 dsh-im，不安装社区 runtime。已采用 rewrite-source 仍是 4.17.1 `464c0a9…`；当前已发布上游是 4.18.1 `d01bd34…`；未发布 `606ced1…` 只作为别名参考，不得写成 v4.18.1 字节。可选 iMessage 仅 Darwin、仅私聊文本、默认关闭；用户未明确启用并授予完全磁盘访问/自动化前，不得读取 Messages 数据或调用 Messages 自动化。权限不足或未配置不得记为已连接。Windows/UOS 只暴露不支持状态，不得调用 macOS helper。WhatsApp、wecom-app 回调、第二套管理 HTTP、Office 当 IM、DOM 注入与第二 Agent 核心仍禁止。Telegram Rich Draft 心跳不适用：保持官方终态投递。

0.5.8 的预览方向不改写已经公开的 0.5.7 tag、Release、附件或历史文档。迁移到新 DSH 时必须从现行源代码与产品表面移除 WhatsApp 的说明卡、channel identity、连接路径、adapter/runtime 接线、Baileys/libsignal 依赖以及任何支持或路线图声明；Git 历史与明确标注为历史的发行审计记录继续保留。移除完成后需用 catalog、依赖闭包、lockfile、SBOM、许可证、安装包内容和用户界面反向证明 WhatsApp 不再属于 Penglai。

0.5.8 以官方 DSH 轻量 tag `dsh-v0.1.2-alpha.1` 的精确 commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` 为源码基线。Penglai 使用未经修改的固定源码、上游冻结 lockfile 与官方 release packer 构建本地 tarball 闭包；上游并发打包造成的生成 `package.json` 键序漂移仅允许通过合同固定的递归键排序和无脚本重打包归一化，且归一化前后每个路径、内容、权限与链接必须一致。必须验证 commit/tree/archive、完整包集合、包摘要、许可证、生成产物、连续两次字节复现和 clean packed-install，不能用临时源码目录或复制 `lib/` 冒充产品闭包。官方 npm 不是开发或发布前置条件；未来出现时只做一次人工源码/包差异核对。源码闭包通过后，产品 manifest、lockfile、runtime、profile 与 release identity 原子切换到 alpha.1。Owner 已授权在 `0.5.8-preview` 完成开发与推送，并在全部门禁通过后创建 PR、合并 `main`、从同一最终 SHA 构建并发布三端客户端；0.5.7 公共字节保持不可变，README 与官网只在 0.5.8 Release 公网字节回读通过后更新。

0.5.9 以官方 npm `alpha` dist-tag 所指向的精确 DSH `0.1.2-alpha.2` 为唯一候选基线，并将其 tag `dsh-v0.1.2-alpha.2` 与 commit `0a53fb55bea101816fa226bb964ae2bed71c343b` 作为源码对应证据。Penglai 必须固定并验证完整的 257 包 DSH/vendor/Landlock cohort、每包 registry integrity、依赖与许可证，禁止 alpha.1/alpha.2 混装，也禁止用源码目录、Git 依赖或本地重打包冒充 npm 产品闭包。产品 manifest、lockfile、runtime closure、profile、release identity、全部第一方插件与插件中心必须原子迁移；RemoteError、会话 projection、独立 DSH Home generation、连接生命周期、安装事务、签名/摘要/权限/兼容与回滚都要重新验证。alpha.2 仍是预发布版本，不能表述成 DSH stable。三端候选必须来自同一干净 main SHA；README、官网、Release Notes 与公开下载观察值只能在 v0.5.9 不可变公网字节回读通过后更新，0.5.8 tag、附件和历史叙事不得改写。

## 反偏航自检

任何提交若对以下任一问题回答“是”，必须停止并纠正：

- 用户完成引导后看到的不是官方 DSH Web UI 吗？
- 没有蓬莱自制模块时，DSH 的 Agent、会话或模型能力会消失吗？
- 是否复制或平行实现了 DSH 已有的模型、会话、工作区、插件加载或聊天 UI？
- 某项能力是否只能在 Electron 自制页面运行，而不是作为真实 DSH 插件加载？
- 安装包是否依赖开发机的全局 Node、pnpm、DSH、仓库目录或首次联网安装？
- 任一目标包是否携带了错误 OS/arch 的 Electron、Node、DSH closure 或原生依赖？
- Plugin Center 的状态是否可能与 DSH loader inventory 不一致？
- 微信、飞书或可选 iMessage 是否绕过统一 binding、commands、causal router 或 DSH AgentHandle？
- 是否在用户未启用 iMessage、未绑定对端/Workspace/Session 或未授予系统权限时读取 Messages 数据库或调用 Messages 自动化？
- ASR/TTS 是否创建了第二 Agent/session/UI，或 IM adapter 是否直接拥有模型引擎而不是调用 DSH plugin service？
- Context/Memory/Budget/Companion 是否复制了 DSH 的 Workspace/Session/Turn/Skills/Schedule/TokenMeter，或按最近项目/窗口猜 scope？
- Context 是否能越过用户授权根、修改源文件或让模型伪造来源状态？Memory 是否允许模型无确认写 global/SOP？Companion 是否能无人值守执行工具或绕过 quiet-hours/budget/IM binding？
- 语音是否依赖系统 ffmpeg/Python/PATH、未固定模型下载，或把原始音频/转写/声音参考泄漏到日志/evidence？
- 任一 renderer、日志、数据库、evidence 或截图是否能读到真实 secret、二维码或聊天正文？
- 飞书是否用假二维码或用户 OAuth Device Flow 冒充一键扫码，或把官方 `app/registration` 落地页 URL 直接当图片地址？
- 是否重新引入、展示或规划了 WhatsApp，或保留了其可操作入口、channel identity、adapter/runtime、设备绑定、二维码、Baileys/libsignal 依赖或打包路径？
- 品牌或中文 overlay 是否隐藏、破坏了 DSH 原有主题、语言、模型、会话、工作区、工具、审批或设置能力？
- 升级/卸载是否可能静默迁移或删除 0.4.1 数据、用户 Workspace 或未选择的数据类别？
- 是否把 ad-hoc 安装包写成已公证，或把缺少原生 runner 的 Intel/Windows 写成 0.5.7 已支持？
- 是否把下载目录、renderer `confirmed: true` 或未进入 DSH inventory 的包写成插件已启用？

只要存在一个“是”，该候选就不是本产品定义下的蓬莱。

0.5.10 固定官方 DSH `dsh-v0.1.2-rc.1` / `a66e4702047846cdaa10c66c9d3df3951f5ea70d`，消费完整 254 包官方 npm cohort，验证原始 tarball、registry 签名、源码 manifest 与冻结依赖。消息、预算和陪伴回放使用官方 `snapshotEvents()`；0.5.8、0.5.9 升级均保留旧 Home，并在独立 rc.1 代际健康检查通过后切换。正常测试、三端原生证据、完整草稿验签、不可变公开字节和双语文档/官网分别取证；历史发行记录不改写。
