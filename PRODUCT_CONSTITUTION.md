# 蓬莱产品宪法

> 生效日期：2026-08-16；2026-08-20 经 Owner 明确修订 0.5.0 首发平台与公开授权。本文是仓库内最高产品约束。用户最新明确指令高于本文；方向改变时必须先同步本文、`STATE.md` 和决策日志，再开始编码。

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
7. **IM 渠道默认一键扫码，扫完即可对话。** 微信、飞书和以后的渠道都以官方一键扫码为默认连接。微信走 iLink `get_bot_qrcode`，必须把 `qrcode_img_content` 画成可扫描 PNG，不能把载荷 URL 直接塞进 `<img src>`。飞书走官方 `accounts.feishu.cn/oauth/v1/app/registration`（扫码创建 PersonalAgent 应用），凭据写入 official credentials 后再用 SDK 长连接。禁止假二维码。用户 OAuth Device Flow（`device_authorization`）不是 bot 基础连接。手动 App ID/Secret 只作扫码不可用时的后备。扫码成功后，扫码者/创建者的私聊自动绑定引导时创建的 official 默认 Workspace/Session，直接发「你好」即可；不得再把 `/绑定 <token>` 或绑定页当成首次路径。绑定页与 `/绑定` 只用于换官方会话或额外对端。
8. **插件中心属于 DSH Web。** 蓬莱插件中心嵌入 DSH Plugins settings，并以真实 loader/profile inventory 为唯一事实源；desired/config 写入不能冒充 installed/active。0.5 可把审核过的插件代码离线预装进安装包，但用户仍可在 DSH 内自行组合；未下载模型、未授权目录、未设策略或未同意主动外发时，插件必须保持真实惰性状态。
9. **安装包必须自带可运行产品。** 干净 Mac/Windows 不应预装 Node、pnpm、Python、系统 ffmpeg 或 `dsh`。包内固定目标平台运行时、完整 DSH 闭包、profile seed、第一方插件（含语音 native/WASM engines）、许可证、SBOM 与完整性清单；生产禁止静默回退系统 PATH。大型 ASR/TTS 权重可在用户明确操作后按 immutable manifest/hash 按需下载，不得成为 DSH 启动依赖。
10. **二次开发不得删减 DSH。** Penglai 可以替换产品名、字标、欢迎/引导文案和默认组合，并增加 Center/IM；但 official DSH 的浅色、深色、跟随系统动态主题、中英文切换、Models、Workspace、Session、工具、审批和设置能力必须保留。中文是 fresh install 默认值，不是删除 English。
11. **安装、升级、卸载是产品能力。** 0.5.0 必须提供 fresh install、首次引导、0.5 系列后续升级、失败恢复和完整卸载/数据管理；升级或卸载不得误删用户 Workspace、旧版本数据或未明确选择的数据类别。
12. **公开发布只消费精确验收资产。** 0.5.0 首发只冻结 Apple Silicon DMG 及其同源证据；Intel macOS 与 Windows 保留为后续版本路线，不得在 0.5.0 文案中冒充已支持。Owner 已于 2026-08-20 明确授权将脱敏 public-export 同步到开源 `PenglaiAgent`、更新官网并发布 `v0.5.0`；公开 Release 必须上传验收过的同一 DMG bytes，不能重建偷换。

插件生态分三层：DSH official core plugins 原样保留；Penglai 原生插件由蓬莱维护并经 Center 事务管理（0.5.0 内置 Center、IM、SenseVoice ASR、MOSS-TTS-Nano、个人上下文、分层记忆、预算与主动陪伴）；社区插件未来只有在来源审核、签名/完整性、权限、兼容、隔离、迁移和回滚门完整后才可加入受控 catalog，绝不等同于任意 npm/Git 安装。

## 责任边界

| DSH 官方拥有 | 蓬莱发行层拥有 | 蓬莱插件拥有 |
| --- | --- | --- |
| Agent、Session、Workspace、Turn、工具与审批 | 发行安装器、启动器、进程监管、私有 `DSH_HOME`、升级、回滚、卸载、Doctor | 微信/飞书协议、Moss TTS、ASR、记忆等具体能力 |
| Pi 多供应商模型、Models、默认模型 | 首次引导编排和品牌说明 | 对应设置页、状态、权限说明和运行逻辑 |
| `credentials` service 与 credentials-local | 不替换官方 provider；确保目录/文件权限、迁移与诊断 | 只持有 CredentialRef；需要秘密时由 host 解析 |
| 官方 DSH Web UI 与 UI slots | 最小桌面菜单、窗口、安全代理 | 通过官方 client slot/settings 注入界面 |
| Cordis loader、profile 与 inventory | 受控 catalog、事务安装、兼容门与回滚 | manifest、迁移、健康与兼容测试 |

## 当前发行边界

- 当前唯一目标是 **Penglai v0.5.0 — Apple Silicon 首发版**。代码继续保留可审计的 Intel/Windows 工程路线，但它们不属于本次公开 release set。
- 用户最新确认把本地语音纳入同一 0.5.0：`@penglai/asr`、`@penglai/moss-tts` 必须进入真实 DSH loader/Center，并服务 DSH Web、微信私聊语音和飞书私聊语音。两渠道仍不支持群聊、图片、普通文件、视频或富卡片。
- 用户进一步要求恢复 Penglai 原有优势而不恢复旧核心：`@penglai/context`、`@penglai/memory`、`@penglai/budget`、`@penglai/companion` 同样纳入0.5.0。Goal/Todo/Skills/MCP/Web/Attachments/Schedule/TokenMeter等使用 official DSH；个人资料索引/来源卡、分层记忆、费用护栏和主动陪伴按 `docs/PENGLAI_NATIVE_PLUGINS.md` 实现。
- fresh 安装完成引导后必须先得到可独立使用的 official DSH core。除承载品牌、引导续接与离线目录的 `@penglai/plugin-center` 外，IM、ASR、MOSS-TTS、Context、Memory、Budget、Companion 都是默认未安装、未加载的可选扩展；只有用户在 Center 明确选择“安装并启用”后，才从安装包内已校验 tarball 事务式写入 profile。随包携带不等于已安装，更不等于默认运行。
- 微信入站语音识别是 Hard；MOSS 出站至少必须以客户端可见可播放的音频附件可靠送达。腾讯 iLink 原生语音气泡只有 current pinned reference 的手机/桌面 live probe 稳定通过才启用，不能用 API `ret=0` 冒充可见。飞书按官方 audio API 实现原生音频收发。
- 用户可见的 0.5.0 安装包只有 `Penglai_0.5.0_macos_aarch64.dmg`。签名、清单、SBOM、notices 和 updater metadata 是配套资产，不另算安装包。Intel Mac 与 Windows 客户端待后续原生 runner 和 installed evidence 完成后再发布。
- 0.4.1 到 0.5.0 是明确的架构代际切换：不提供自动升级，不导入旧会话、凭据或配置，不删除旧数据。安装前检测和说明必须诚实；0.5.0 使用隔离的数据根。
- 0.5.0 必须具备面向后续 0.5.x/0.6.x 的签名更新检查、下载验证、用户确认安装、数据迁移 journal、失败回滚与恢复。community trust tier 没有 Developer ID 时，不伪装成 macOS 静默 auto-update。
- 用户已接受沿用 0.4.1 的 community trust tier：0.5.0 Apple Silicon DMG 是 ad-hoc / not notarized；安装包及更新清单仍须有 SHA-256、SBOM/notices、installed E2E，并在说明中诚实提示系统信誉警告。若以后提供 Developer ID，再另立 OS-trusted 候选，不得混写。
- GitHub Actions 当前不可用。0.5.0 构建与测试以 Apple Silicon 本机 native runner 为准；候选冻结仍须私有库 `HEAD=origin/main`、工作树干净且所有资产同源。Intel/Windows 的 cross-build 代码不等于公开支持。
- Owner 已明确授权本轮修改开源仓库、更新官网、创建公开 `v0.5.0` tag/Release 并上传精确 Apple Silicon DMG。不得上传真实 secret、QR、聊天正文、私有报告、owner 路径或本机配置。

## 反偏航自检

任何提交若对以下任一问题回答“是”，必须停止并纠正：

- 用户完成引导后看到的不是官方 DSH Web UI 吗？
- 没有蓬莱自制模块时，DSH 的 Agent、会话或模型能力会消失吗？
- 是否复制或平行实现了 DSH 已有的模型、会话、工作区、插件加载或聊天 UI？
- 某项能力是否只能在 Electron 自制页面运行，而不是作为真实 DSH 插件加载？
- 安装包是否依赖开发机的全局 Node、pnpm、DSH、仓库目录或首次联网安装？
- 任一目标包是否携带了错误 OS/arch 的 Electron、Node、DSH closure 或原生依赖？
- Plugin Center 的状态是否可能与 DSH loader inventory 不一致？
- 微信或飞书是否绕过统一 binding、commands、causal router 或 DSH AgentHandle？
- ASR/TTS 是否创建了第二 Agent/session/UI，或 IM adapter 是否直接拥有模型引擎而不是调用 DSH plugin service？
- Context/Memory/Budget/Companion 是否复制了 DSH 的 Workspace/Session/Turn/Skills/Schedule/TokenMeter，或按最近项目/窗口猜 scope？
- Context 是否能越过用户授权根、修改源文件或让模型伪造来源状态？Memory 是否允许模型无确认写 global/SOP？Companion 是否能无人值守执行工具或绕过 quiet-hours/budget/IM binding？
- 语音是否依赖系统 ffmpeg/Python/PATH、未固定模型下载，或把原始音频/转写/声音参考泄漏到日志/evidence？
- 任一 renderer、日志、数据库、evidence 或截图是否能读到真实 secret、二维码或聊天正文？
- 飞书是否用假二维码或用户 OAuth Device Flow 冒充一键扫码，或把官方 `app/registration` 落地页 URL 直接当图片地址？
- 品牌或中文 overlay 是否隐藏、破坏了 DSH 原有主题、语言、模型、会话、工作区、工具、审批或设置能力？
- 升级/卸载是否可能静默迁移或删除 0.4.1 数据、用户 Workspace 或未选择的数据类别？
- 是否把 ad-hoc 安装包写成已公证，或把未发布的 Intel/Windows 写成 0.5.0 已支持？

只要存在一个“是”，该候选就不是本产品定义下的蓬莱。
