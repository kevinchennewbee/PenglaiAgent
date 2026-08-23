# Penglai v2 产品规格 — v0.5.0 Apple Silicon 首发版

## 1. 产品承诺

Penglai 0.5.0 让 Apple Silicon Mac 用户安装一个自包含桌面应用，经过中文优先的 pre-DSH `/wizard` 前置引导（ADR 0030）填入自己的模型 API key，进入完整 official DSH Web，并在同一界面管理 Penglai 插件、扫码连接微信或配置飞书。Intel macOS 与 Windows 客户端保留为后续路线，不属于 0.5.0 首发支持范围。

它不是重新实现 DSH。DSH 的 Agent、Workspace、Session、Turn、工具、审批、模型和 Web UI 是产品核心；Penglai 负责发行、引导、品牌、进程、升级、卸载、插件中心和可靠的第一方插件。

默认安装的基础产品就是一个完成 BYOK 后可独立使用的完整 DSH 发行版。审核过的 Penglai 插件随包离线预装并在 Center 中可见，但不是使用 DSH 的前提；用户可从纯 DSH、IM text、IM+ASR、IM+TTS、完整语音链以及 Context/Memory/Budget/Companion 中自行组合。未配置的插件不得产生联网、索引、推理、拦截或主动外发副作用。

## 2. 目标用户

- 不想安装 Node/pnpm/dsh 的普通桌面用户。
- 想使用自己的模型 API key、在本机保存配置的个人用户。
- 希望从微信/飞书私聊文字或语音调度同一 DSH Workspace/Session 的用户。
- 希望在本机完成麦克风转写与回复朗读、音频不交给云 ASR/TTS 的用户。
- 希望授权本地资料后获得可核对来源、分 Workspace 记忆、预算护栏和可选主动陪伴的用户。
- 想保留 DSH 完整能力，同时获得中文默认、安装器和插件中心的开发者。

## 3. 支持平台与安装包

| 用户设备 | 安装包 |
| --- | --- |
| Apple Silicon Mac | `Penglai_0.5.0_macos_aarch64.dmg` |

该 DMG 自带目标架构的 Electron、Node、DSH 和第一方插件。Intel macOS、Windows、Linux、Mac App Store、Microsoft Store 不在0.5.0范围。

## 4. 核心用户旅程

### 4.1 安装与首次使用

1. 用户选择正确平台安装包并完成OS原生安装。
2. Penglai创建隔离的0.5数据根，检测但不读取/迁移0.4.1数据。
3. 用户选择语言/主题并理解本地数据与YAML credential边界。
4. 用户从official provider/model列表选择API，输入key并真实测试。
5. 用户选择Workspace，经official DSH创建Session/Turn并得到首轮回复。
6. 主窗口进入Penglai品牌化official DSH Web。
7. 此时完整DSH已经可用；用户可以完全不启用Penglai增强，或从Center自行组合已预装插件。
8. 用户现在可以连接IM或稍后从Settings处理；也可选择安装本地语音模型、授权资料目录、了解分层记忆，预算与主动陪伴保持默认未配置/关闭。

### 4.2 微信一键扫码

1. 设置→Penglai IM→微信→连接微信。
2. 界面显示真实二维码、倒计时和完整状态。
3. 扫码者确认后成为默认允许身份，并自动绑定引导时创建的 official 默认 Workspace/Session。
4. 用户直接发「你好」即可对话；绑定页只用于换官方会话。
5. 私聊文本或语音进入同一DSH因果链；语音由本地SenseVoice转写，最终文本/可听MOSS音频只回原微信路由。
6. 重启、睡眠、断网后自动恢复；用户可注销并清理credential。

### 4.3 飞书一键扫码并连接

1. 设置→Penglai IM→飞书点“连接飞书”，显示官方 app/registration 二维码。
2. 用户用飞书扫码创建 PersonalAgent；host 把官方返回的 App ID/Secret 写入 credentials，renderer 不读明文。
3. official SDK 长连接建立后，创建者的第一条私聊自动绑定同一 official 默认 Workspace/Session，直接发「你好」即可。
4. 私聊文本或 audio 走同一 DSH 因果链；audio 本地转写，MOSS 回复经 official Opus/audio API 回原飞书路由。
5. 扫码不可用时才使用手动 App ID/Secret 后备。

### 4.4 本地语音

1. Center真实显示并管理`@penglai/asr`与`@penglai/moss-tts`。
2. 用户明确操作后下载/导入固定hash的SenseVoice/MOSS权重；DSH core不等待模型。
3. DSH composer录音→本地转写→可编辑确认→official Turn；assistant final可手动/按Session朗读。
4. 用户可选择内置声音、试听、导出；本地声音参考只在明确许可后创建并可独立删除。
5. 微信原生voice bubble若厂商当前live不稳定，以可播放audio attachment可靠降级；飞书native audio是Hard。

### 4.5 升级

- 0.4.1→0.5.0必须fresh install，不迁移旧数据。
- 0.5.0开始，应用检查签名manifest，下载并验签当前平台安装器，让用户确认原生安装，迁移0.5内部schema并失败回滚。
- community trust版不宣称macOS silent auto-update。

### 4.6 蓬莱记忆、预算与陪伴

1. 用户显式授权 global 或 Workspace 本地资料目录；Penglai只在本机建立可删除派生索引，原文件不改。
2. Agent在official DSH Turn中调用蓬莱记忆提供的资料检索工具，回答显示host验证的current/stale/revoked/unavailable来源卡。
3. global L1与Workspace memory严格分层；长期global记忆和SOP写入必须展示diff并由Owner确认，SOP复用official DSH Skills。
4. budget读取official TokenMeter，按global/Workspace/provider限制新Turn；未知价格只报token。
5. companion默认关闭；启用后按quiet hours/频率/预算，用official Schedule和dedicated DSH Turn发送绑定渠道的text或voice，不执行无人值守工具。

### 4.7 卸载

- macOS在设置中先管理数据，然后将app移到废纸篓。
- 默认保留0.5用户数据；完整删除按类别选择，credential二次确认。
- Workspace和0.4.1 legacy永不被0.5卸载器删除。

## 5. official DSH Web 信息架构

Penglai增加：

- 首次引导编排。
- official Settings 左栏用一个连续、视觉缩进的蓬莱分组承载第一方页面：“蓬莱”概览为组首，只有已启用能力才出现对应子项；不把多个能力横向挤入 official Plugins tabs，也不在内容区增加第三列导航。
- Settings→蓬莱→概览：真实loader驱动的插件中心与六张用户产品卡。
- Settings→蓬莱→连接→消息连接：IM 总览、微信、飞书、绑定、命令、诊断。
- Settings→蓬莱→语音：ASR/TTS 模型、试转写、试听、声音与数据管理。
- Settings→蓬莱→蓬莱记忆：授权资料/索引/来源/撤销，以及global/Workspace/candidates、图谱、审计与删除；不出现独立“个人上下文”插件。
- Settings→蓬莱→控制与陪伴：TokenMeter 预算护栏与默认关闭的主动陪伴。
- Settings→蓬莱→系统：更新、存储与卸载。
- Center 和各能力插件分别通过 official `settings.section` 独立注册/卸载，并用连续 order 聚合在蓬莱组内；Center 改变 client roster 后只触发一次应用内 reload。这个组合不形成第二套 plugin runtime、settings shell 或强依赖组合。
- About中的Penglai/DSH/target/trust/data/license信息。

DSH原有能力必须完整保留：

- light/dark/system与系统动态变化。
- 中文/English。
- Models与默认模型。
- Workspace、Session、conversation。
- tools、approvals、permissions。
- settings、help、project等导航/命令。

## 6. 0.5.0 范围

### 必须完成

- Apple Silicon 自包含安装包与 native installed evidence。
- Penglai品牌、完整zh/en、主题parity。
- 真实BYOK/Workspace/first Turn引导。
- 真实loader驱动的Penglai Center。
- 由用户在 Center 按需安装、启用的统一IM插件。
- 微信/飞书私聊text+voice闭环、binding、commands、strict causal route。
- SenseVoice ASR与MOSS-TTS-Nano两个真实DSH插件、按需模型、Apple Silicon native engine。
- 蓬莱记忆（含授权资料、source cards、分层记忆与图谱）、预算、主动陪伴三个真实DSH插件，并复用official Skills/Schedule/TokenMeter。
- crash/offline/sleep/worker/DB恢复与两小时soak。
- 从0.5开始的signed assisted update与rollback。
- macOS卸载与精确数据管理。
- deterministic public-export与公开发布。

### 明确不做

- 0.4.1 state migration/updater bridge。
- 群聊、图片、普通文件、视频、富卡片。
- 云账户/同步/遥测、browser/CUA和无人值守高权限陪伴。
- 远程插件市场与任意代码安装。
- OS publisher signing/notarization（community trust候选）。
- Intel macOS与Windows 0.5.0安装包。

## 7. 插件生态

Center分层：

1. official DSH core：原样保留，不由Penglai伪装重实现。
2. Penglai built-in/first-party：0.5内置Center、IM、ASR、MOSS-TTS、Context、Memory、Budget与Companion，真实manifest/permissions/migration/rollback。
3. future reviewed community：只有来源、license、signature、compatibility、isolation、migration、安全审核齐备后加入。

0.5不显示尚未实现的插件卡，也不开放npm/Git/URL输入。

“随包预装”不等于“强制使用”：Center/IM作为发行基础能力可保持active，ASR/TTS在无模型时不推理，Context在无grant时不索引，Memory不自动写global/SOP，Budget在无策略时不阻断，Companion默认不调度、不外发。用户禁用任一可选插件后，official DSH与其余插件必须继续正常工作。

## 8. 数据与隐私承诺

- 无Penglai云账户、遥测或跨设备同步。
- API/微信/飞书secret保存在本机app-private official YAML credentials。
- renderer读不回明文；但同OS用户的高权限本地进程可能读取文件，不能宣传成Keychain级隔离。
- IM只保留完成因果路由所需的受控状态；日志/evidence不含secret、QR、正文或真实identity。
- 麦克风/IM原始语音与TTS临时输出按任务及时删除；本地声音参考是独立敏感数据类别，不进入日志/evidence，也不会从联系人语音自动创建。
- Context只索引用户授权的realpath目录，撤销只删派生索引；Memory/预算/陪伴数据均app-private、可查看、可分项删除，不进入诊断或evidence正文。
- 卸载默认保留数据，完整删除由用户明确选择。

## 9. 状态语言

| 状态 | 可以说 | 不能说 |
| --- | --- | --- |
| implementing | 正在实现0.5 | 已完成/已发布 |
| target built | Apple Silicon安装包已生成 | 已公开/已公证 |
| awaiting external | 只剩精确native/live/key项 | 基本完成可发布 |
| ready for Codex | exact private候选待独立验收 | Codex已通过 |
| Codex PASS | 私有候选验收通过 | 已公开0.5.0 |
| public release | Owner授权且公开main/tag/Release/asset/site核验完成 | 未核验就宣布 |

## 10. 成功标准

Apple Silicon 用户可以从 exact DMG fresh install，不安装开发工具，通过真实UI完成BYOK和Workspace/Turn，进入完整DSH Web，按需安装本地ASR/TTS、个人上下文/来源卡、分层记忆、预算和可选陪伴，并连接微信/飞书私聊text+voice，安全升级后续版本，并清楚可控地卸载。所有结论有exact source/export/artifact/native/live evidence支持。
