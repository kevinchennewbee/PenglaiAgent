# 蓬莱产品宪法

> 生效日期：2026-08-16。最近一次重写：2026-09-19，把逐版本的发布授权与边界记录移入
> `docs/decisions.md`（它们本来就属于那里），并让本文与 D-078/D-080 的现行决定一致。
>
> **本文只写"永远为真的话"。** 任何随版本变化的事实——固定哪个上游、发布哪些目标、
> 本版排除什么——都记在 `docs/decisions.md` 与 `release-contract.json`，
> 不写在这里。用户最新明确指令高于本文；方向改变时必须先同步本文和决策日志，再开始编码。

## 一句话定义

**蓬莱是官方 DeepSeek Harness（DSH）的桌面发行版：在官方不发布的平台上可靠交付官方核心，
并让 Agent 通过用户已有的聊天软件被触达。**

微信、飞书、Moss TTS、ASR、记忆及以后所有蓬莱增强能力，全部以 DSH 插件存在；
它们不是第二套 Agent、第二套会话系统或第二套前端。

架构上可把 DSH 理解为蓬莱所发行的平台，把蓬莱理解为面向普通用户的 DSH 产品发行版：
安装向导完成后，即使不启用任何蓬莱增强能力，用户也必须能直接使用完整 DSH；
蓬莱负责易安装、易配置、可靠更新、品牌体验与经过审核的插件组合。
这个类比只说明责任边界，不表示复制 Linux/Ubuntu 的具体技术实现。

## 不可违反的十条规则

1. **DSH 是唯一核心。** Agent loop、Workspace、Session、Turn、工具、审批、模型目录和基础
   Web UI 均由官方 DSH 拥有。
2. **主窗口就是 DSH Web UI。** 安装、首次引导、修复等短暂页面可以由外壳提供；完成引导后，
   不得用蓬莱自制聊天页、健康页或控制台替代官方 DSH Web。
3. **一切皆插件，包括蓬莱自己的东西。** 官方 DSH 插件管理器是唯一的包管理后端；蓬莱
   **不**把历史签名目录当作生态白名单，也不引入第二套包解析器或管理器。内置能力随包、
   默认可用，**用户可以停用但不可以被删除**；停用不得删除插件包或数据。用户可以安装
   任何与所固定上游版本兼容的 DSH 插件。
4. **插件以用户进程权限运行，没有 per-plugin 沙箱。** 这是一个事实，不是一种选择。
   产品、文档、官网与设置界面必须如实说明；不得暗示存在进程级隔离。安装插件与批准
   build script 是两个独立的信任决定。
5. **BYOK 复用 DSH 的 Pi 模型体系。** 复用官方 Models、模型发现、默认模型和 `credentials`
   service；不得另造模型 registry、供应商 gateway 或平行密钥库。
6. **凭据只走官方 credentials service。** API key、微信 token、飞书 App Secret 等都通过官方
   `credentials.set/describe/resolve/unset` seam 管理，由 `@deepseek-ai/dsh-credentials-local`
   写入 app-private `DSH_HOME/.credentials.yaml`；renderer 永远不能读回明文。
   Keychain 不是本产品路径。macOS 用目录/文件 mode 收紧，Windows 用当前用户 ACL 收紧。
7. **IM 是一个第一方插件。** `@penglai/im` 内含统一绑定、命令、因果路由、持久化、恢复和
   adapter registry；各渠道只是 adapter，不能各自直接调用 Agent。ASR、TTS 与 Memory 是
   独立 DSH 服务插件，IM 只能通过类型化能力接口调用，不能把这些引擎复制进 adapter。
8. **IM 连接必须诚实。** 微信使用真实 iLink QR，飞书只使用官方应用注册/凭据路径。
   Slack、Telegram、Discord 禁止伪装扫码。QQ 只做官方 Bot 路径。扫码或配置成功后仍需绑定
   exact official Workspace/Session；不得按最近窗口猜 scope。不得展示任何没有可操作连接
   路径的渠道入口。
9. **安装包必须自带可运行产品。** 干净 Mac/Windows/UOS 不应预装 Node、pnpm、Python、系统
   ffmpeg 或 `dsh`。包内固定目标平台运行时、完整 DSH 闭包、profile seed、第一方插件
   （含语音 native/WASM engines）、许可证、SBOM 与完整性清单；生产禁止静默回退系统 PATH。
   大型 ASR/TTS 权重可在用户明确操作后按 immutable manifest/hash 按需下载，
   不得成为 DSH 启动依赖。
10. **公开发布只消费精确验收资产。** 三个所选目标必须来自同一 source SHA；缺对应原生
    runner 的目标只能写 `BLOCKED`/`NOT_RUN`，不得写成 native PASS。公开 Release 必须上传
    验收过的同一 bytes，不能重建偷换。提交源文件不得伪造无法自引用的 commit SHA。

## 两条如实义务

这两条是本版新增的，因为它们各自对应一类已经真实发生过的故障。

11. **漂移诚实。** 任何对外部现实的假设——厂商的响应格式、上游的版本、模型目录、已发布的
    事实——都必须配一个可执行的活体探针（`pnpm verify:drift`），否则不得写入源码或文档。
    已知的漂移必须写进 Release Notes，**不得以"门禁全绿"掩盖**。
    探针变红不阻塞发布，但阻塞"声称一切正常"。
12. **代际边界必须是被声明的，不是被推断的。** 数据根代际（`generationId`）由发布契约与
    签名清单声明；任何时候都不得从产品版本号推断它。一个无法被求值的边界必须 fail closed，
    而不是消失。

Telemetry 与 DSH session log 默认关闭，属于隐私边界，不得因上游默认值变化而改变。
内存授权资料只索引文本类格式；不得解析 PDF 或 OOXML。

## 责任边界

| DSH 官方拥有 | 蓬莱发行层拥有 | 蓬莱插件拥有 |
| --- | --- | --- |
| Agent、Session、Workspace、Turn、工具与审批 | 发行安装器、启动器、进程监管、私有 `DSH_HOME`、升级、回滚、卸载、Doctor | 各渠道协议、Moss TTS、ASR、记忆等具体能力 |
| Pi 多供应商模型、Models、默认模型 | 首次引导编排和品牌说明 | 对应设置页、状态、权限说明和运行逻辑 |
| `credentials` service 与 credentials-local | 不替换官方 provider；确保目录/文件权限、迁移与诊断 | 只持有 CredentialRef；需要秘密时由 host 解析 |
| 官方 DSH Web UI 与 UI slots | 最小桌面菜单、窗口、安全代理 | 通过官方 client slot/settings 注入界面 |
| Cordis loader、profile、inventory 与插件管理器 | 内置插件组合、兼容门、诊断与回滚 | manifest、迁移、健康与兼容测试 |

## 反偏航自检

任何提交若对以下任一问题回答"是"，必须停止并纠正：

- 用户完成引导后看到的不是官方 DSH Web UI 吗？
- 没有蓬莱自制模块时，DSH 的 Agent、会话或模型能力会消失吗？
- 是否复制或平行实现了 DSH 已有的模型、会话、工作区、插件加载或聊天 UI？
- 某项能力是否只能在 Electron 自制页面运行，而不是作为真实 DSH 插件加载？
- 是否声称或暗示插件存在进程级沙箱，或让用户以为安装插件与批准 build script 是同一个信任决定？
- 是否把内置能力做成"可被删除"，或让停用内置能力连带删除其数据？
- 是否把历史签名目录重新当作整个生态的白名单，或引入第二套包管理器？
- 安装包是否依赖开发机的全局 Node、pnpm、DSH、仓库目录或首次联网安装？
- 任一目标包是否携带了错误 OS/arch 的 Electron、Node、DSH closure 或原生依赖？
- 插件状态是否可能与真实 loader/profile inventory 不一致？是否把 desired/config 写入或
  renderer 的 `confirmed: true` 冒充 installed/active？
- 微信、飞书或可选 iMessage 是否绕过统一 binding、commands、causal router 或 DSH AgentHandle？
- 是否在用户未启用 iMessage、未绑定对端/Workspace/Session 或未授予系统权限时读取 Messages
  数据库或调用 Messages 自动化？
- ASR/TTS 是否创建了第二 Agent/session/UI，或 IM adapter 是否直接拥有模型引擎而不是调用
  DSH plugin service？
- Memory 是否复制了 DSH 的 Workspace/Session/Turn/Skills，或按最近项目/窗口猜 scope？
- Memory 授权资料是否能越过用户授权根、修改源文件或让模型伪造来源状态？
  Memory 是否允许模型无确认写 global/SOP？
- 语音是否依赖系统 ffmpeg/Python/PATH、未固定模型下载，或把原始音频/转写/声音参考泄漏到
  日志/evidence？
- 任一 renderer、日志、数据库、evidence 或截图是否能读到真实 secret、二维码或聊天正文？
- 是否新增了对产品运行时的排除清单之外模块的依赖？（当前排除清单见 `release-contract.json`
  与 `docs/decisions.md`；本问题问的是"有没有偷偷加回来"，而不是清单本身。）
- 飞书是否用假二维码或用户 OAuth Device Flow 冒充一键扫码，或把官方 `app/registration`
  落地页 URL 直接当图片地址？
- 品牌或中文 overlay 是否隐藏、破坏了 DSH 原有主题、语言、模型、会话、工作区、工具、审批
  或设置能力？
- 升级/卸载是否可能静默迁移或删除既有数据、用户 Workspace 或未选择的数据类别？
- 是否把 ad-hoc 安装包写成已公证，或把缺少原生 runner 的目标写成已支持？
- 是否写入了一条对外部现实的假设却没有对应的漂移探针？是否用"门禁全绿"掩盖了已知漂移？
- 是否从产品版本号推断了数据根代际？

只要存在一个"是"，该候选就不是本产品定义下的蓬莱。
