# Penglai 0.6.5 验收注册表

> 本文是 0.6.5 唯一的机器可解析 Hard 注册表。它取代了 0.5.x 时代的 330-ID
> 基础表；那张表的 241 个 ID 从未出现在任何 `recordAssertion` 调用中，另外
> 38 个要求本版明令排除的模块存在，因此 `missing != 0` 在任何一次运行中都成立，
> 计数本身失去意义。本表的每一条都必须能产出证据，否则不允许登记。
>
> 精确版本、文件名与公开目标以 `release-contract.json` 为准；排除范围以
> `PRODUCT_CONSTITUTION.md` 与 `docs/PRODUCT.md` 为准。已发布的 0.5.10、
> 0.5.11、0.5.12、0.6.0、0.6.1、0.6.2 与 0.6.5 的验收增量保持不可变，本文不
> 改写任何已发布历史，也不再登记它们的历史 ID。

## 1. 判定对象与结论

本表的验收对象是同一个 clean source 与 deterministic public-export tree 产生的
三个安装包（Apple Silicon、Windows x64、UOS loong64）及其元数据。Intel Mac、
LibreOffice、Office/PDF、Budget 与 Companion 不在本版产品运行时内，因此
**不设能力 ID**；它们由一条反向存在性 ID（`R50-ABSENT-001`）断言不存在。

允许结论：

- `PASS`：所有适用 Hard PASS，exact set 冻结。
- `OWNER_ACCEPTANCE_PENDING`：需要所有者账号或真机的补充验收尚未发生；不冒充 PASS，也不覆盖已完成的自动化证据。
- `FAIL`：任一适用发布 Hard FAIL、STALE、MISSING、伪造或产品偏航。

`SKIP`、`BLOCKED`、`NOT_RUN`、`WAIVED`、`UNKNOWN`、`INCOMPLETE` 都不是 PASS。

## 2. Evidence 规则

以下每一行都是对应证据类别内的 Hard assertion。基础表预期共 **80** 个唯一 ID。
实现必须动态解析，不能把计数写成散落的完成映射。每个 ID 必须指向真实 runner 的
具体 assertion，包含 candidate/source/export/target/artifact/runner native/时间/
exit/result digest。不能通过文件名、字符串存在或一个 smoke 扇出 PASS。

**可产出性是被强制的，不是被声称的。** `packages/release-identity/src/evidence-emitters.ts`
声明每个 ID 的发射点，`emitters.test.ts` 中的 `assertEveryHardIdEmittable()` 双向断言：
每个登记的 ID 都有发射点，每个发射点都有登记的 ID，且每个发射点文件确实调用
`recordAssertion`。新增一个 ID 而不写对应调用会导致该测试失败。

`verify-evidence` 收集器在 `PENGLAI_EVIDENCE_DIR` 下运行这些套件，实际产出的 ID
是第二层地面真值。若干 ID 只在存在已封装原生产物时才发射（见下表 `installed`、
`artifact`、`signing` 类），在纯源码机器上不产出是正确行为：从源码机器声称
安装态证据才是缺陷。

平台标记：

- `all`：平台类门禁展开为全部三个目标；非平台类门禁只执行一次源码/聚合检查。
- `drift/probe`：外部世界探针。红探针不阻塞发布，但阻塞"声称一切正常"；
  外部不可达记为 `BLOCKED` 而不是 `FAIL`。
- `aggregate`：release-set/public-export 聚合。

## 3. Hard registry

### A. Truth、版本与发布身份（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-TRUTH-001` | root/workspace/desktop/profile/plugin/release contract 的版本全部等于 release-contract.json 声明的 0.6.5 | contract/all |
| `R50-TRUTH-002` | candidateKind、trustTier、generation、三个 target 与三个 exact filename 一致，且与 RELEASE_TARGETS 逐字相符 | contract/all |
| `R50-TRUTH-003` | 旧 alpha artifact/evidence/READY 全部 STALE 并被 verifier 拒绝，legacy 202-ID 汇总不构成完成映射 | failure/all |
| `R50-TRUTH-004` | UNFROZEN identity 不得携带 artifact/signature/live/READY | unit/all |
| `R50-TRUTH-005` | 注册表本身是唯一、动态解析、非 stale 的 Hard 集合，且每条 ID 都有可核实的发射点 | unit/all |
| `R50-TRUTH-006` | runner 的 candidate source SHA 只来自 Git HEAD，环境变量（含 PENGLAI_CANDIDATE_SHA）不得覆盖它 | unit/all |
| `R50-TRUTH-007` | 任一适用发布硬子门 FAIL/INCOMPLETE/STALE 都使 verify:release 非零 | fault/all |
| `R50-TRUTH-008` | repo=kevinchennewbee/PenglaiAgent、tag/release=v0.6.5，且发布前 updater Release 不得冒充已公开 | manifest/aggregate |

### B. DSH 唯一核心与安装态契约（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-CORE-001` | packaged app 用 absolute embedded Node 启动 pinned official DSH | installed/all |
| `R50-CORE-002` | 完成引导后 BrowserWindow 加载 authenticated official DSH Web | installed/all |
| `R50-CORE-004` | Models 与 default model 来自 official Pi/DSH APIs | contract+installed/all |
| `R50-CORE-005` | Workspace/Session/Turn 均由 official DSH 创建与恢复 | integration+installed/all |
| `R50-CORE-006` | tools/approvals/permissions/settings/workspace 能力在安装态可见可用 | parity/all |

### C. 首次引导：向导绝不能把用户困住（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-ONB-001` | 首次引导从欢迎页开始，不依赖预置 profile 或跳过页面 | onboarding/all |
| `R50-ONB-002` | 欢迎页之后进入隐私步骤，顺序不可颠倒 | onboarding+installed/all |
| `R50-ONB-003` | models 步骤列出 official provider catalog 并抵达 API key 边界 | onboarding+installed/all |
| `R50-ONB-004` | 非法 Workspace 目录被拒绝且不进入下一步 | onboarding/all |
| `R50-ONB-005` | 凭据失败可返回并重试，不产生半成品 profile | onboarding/all |
| `R50-ONB-006` | 重启后可续跑未完成的引导步骤 | onboarding+installed/all |
| `R50-ONB-007` | 完成条件是模型真实回复，不是健康接口返回 | onboarding/all |
| `R50-ONB-008` | 语言步骤默认 zh 且可切换 English | onboarding/all |
| `R50-ONB-009` | 引导期间不创建第二套 session 或聊天引擎 | onboarding/all |
| `R50-ONB-010` | 引导失败不会把用户滞留在无出口页面 | onboarding/all |
| `R50-ONB-011` | 新 profile 默认启用插件中心、记忆与消息，语音默认关闭 | onboarding/all |
| `R50-ONB-012` | 引导写入的 profile 与 release identity 版本一致 | onboarding/all |

### D. 辅助更新（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UPD-001` | 辅助更新比较使用声明的 data generation，不再硬编码 0.5 世代 | update/all |
| `R50-UPD-004` | 更新清单签名与公钥 id 必须校验通过 | update/all |
| `R50-UPD-005` | 更新目标表与 runtime updater 副本逐项一致，含 linux-loong64 | update/all |
| `R50-UPD-006` | 不支持的目标被拒绝而不是静默失败 | update/all |
| `R50-UPD-007` | 下载产物摘要与清单声明一致才允许安装 | update/all |

### E. 插件中心（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-CENTER-001` | 插件中心运行在 official plugin slot 内并提供官方管理 UI | center+installed/all |
| `R50-CENTER-005` | 插件中心安装只接受身份、摘要、权限、DSH 兼容性与回滚均通过的包 | center+installed/all |
| `R50-CENTER-006` | 插件中心 UI 状态不被当作已安装或健康的证据 | center/all |
| `R50-CENTER-007` | 回滚可撤销一次失败安装并恢复原状态 | center/all |
| `R50-CENTER-009` | 安装第三方包与批准 build script 是两个独立的显式信任动作 | center+installed/all |

### F. 分发、产物与原生证据（11）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-DIST-001` | release-contract.json 精确声明三目标与对应 installer 文件名 | contract/all |
| `R50-DIST-003` | exact asset 集合只含 release-contract.json 声明的条目，多一个或少一个都失败 | contract/all |
| `R50-DIST-005` | 安装包内嵌 runtime 的 Node/DSH 版本等于 pin | installed/all |
| `R50-DIST-008` | 安装态进程树由绝对路径内嵌 Node/DSH 拥有 | installed/all |
| `R50-MAC-004` | from-dmg Info.plist 的 name 与 bundle id 为 Penglai/com.penglai.dsh | installed/all |
| `R50-MAC-005` | packaged macOS 二进制 hardening 从字节读出而非配置字符串 | security/all |
| `R50-MAC-006` | from-dmg Penglai.app 通过 codesign --verify --deep --strict | signing/all |
| `R50-MAC-007` | 本地 arm64 DMG 以 UDZO 创建并通过 hdiutil verify | artifact/all |
| `R50-MAC-008` | 挂载后的 app 副本仍能通过 codesign strict | artifact/all |
| `R50-MAC-009` | arm64 exact DMG 安装后记录官方启动观测 | installed/all |
| `R50-SEC-004` | packaged Electron 二进制的 RunAsNode、NODE_OPTIONS 与 CLI inspect 均从字节读出为禁用 | artifact/all |

### G. Workspace、项目、账号与 IM 路由隔离（4）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-ROUTE-001` | Workspace、项目、账号、IM 路由必须显式隔离，不得互相串用 | routing/all |
| `R50-ROUTE-009` | 一条 IM 路由绑定一个 Workspace，改绑必须显式且可审计 | routing/all |
| `R50-ROUTE-010` | 跨 Workspace 记忆串联被拒绝 | routing/all |
| `R50-IM-001` | 消息插件随包默认启用，但消息账号与通道不自动连接 | integration/all |

### H. 安装态端到端旅程（4）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-E2E-001` | installed 证据挂载的是当前 exact installer | installed/all |
| `R50-E2E-002` | 无凭据引导 + companion 产品 HTTP/WS + 受控进程清单通过 | installed/all |
| `R50-E2E-003` | 官方 Workspace 首轮 Turn 与非重复 Turn 在安装态完成 | installed/all |
| `R50-E2E-004` | installed PASS 不能由 source-read、usable-fixture 或已移除端点产生 | anti-cheat/all |

### I. public export 就绪（7）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-PREP-001` | public-export 只包含 release-contract.json 声明的文件集合 | export/aggregate |
| `R50-PREP-002` | export tree 摘要可复算且与声明一致 | export/aggregate |
| `R50-PREP-003` | export 不含 private/dirty 内容或未跟踪文件 | export/aggregate |
| `R50-PREP-005` | export 可重现：同一 source SHA 产出同一 tree 摘要 | export/aggregate |
| `R50-PREP-006` | export 保留 LICENSE、notice 与第三方来源声明 | export/aggregate |
| `R50-PREP-009` | export 范围与 .gitignore/.exportignore 规则一致 | export/aggregate |
| `R50-PREP-010` | export 与 release identity 绑定同一个 source SHA | export/aggregate |

### J. 品牌、UI 与本地数据边界（3）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UI-001` | app/window/menu/About/installer/shortcut/uninstaller 显示 Penglai/蓬莱 | installed/all |
| `R50-UI-006` | 品牌 overlay 不阻断 DSH 导航、Models、Workspace、Session 与设置 | parity/all |
| `R50-CRED-002` | 凭据存放于 OS keychain/受控存储，不以明文落盘 | credential/all |

### K. 卸载与生命周期（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UN-001` | 默认卸载移除 app 与运行态，且不删除用户数据目录 | uninstall/all |
| `R50-UN-002` | 卸载后无残留 owned 进程 | uninstall/all |
| `R50-UN-005` | 卸载不删除用户 Workspace 与会话数据 | uninstall/all |
| `R50-UN-006` | 卸载可重入：重复执行不报错且不扩大删除范围 | uninstall/all |
| `R50-UN-007` | 卸载记录写入可审计的退出报告 | uninstall/all |

### L. DRIFT：外部世界是否仍与仓库假定一致（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-DRIFT-001` | 微信 iLink surface 仍以 Tencent 实际返回的 content type 与 JSON 信封提供，而非仓库假定的 application/json | drift/probe |
| `R50-DRIFT-002` | pinned DSH 版本仍发布在 npm，且 GitHub releases 不是唯一上游movement来源 | drift/probe |
| `R50-DRIFT-003` | 消息通道 pinned build 与 Tencent 当前发布版本一致 | drift/probe |
| `R50-DRIFT-004` | 仓库对“已发布/未发布”的自述与公网实际发布状态一致 | drift/probe |
| `R50-DRIFT-005` | provider 实际服务的模型目录与 pinned 客户端目录一致 | drift/probe |

### M. DOC：文档与发布事实一致（5）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-DOC-001` | 没有任何 release-facing 文档声称一个仓库没有发布记录的 Penglai 版本 | docs/all |
| `R50-DOC-002` | 每个 release-facing 文档引用的 installer 文件名都是本版 release-contract.json 声明的目标 | docs/all |
| `R50-DOC-003` | 仓库对当前版本的发布自述内部一致，不存在同时声称已发布与未发布的文档 | docs/all |
| `R50-DOC-004` | README、PRODUCT.md 与发行说明都如实披露被排除范围（LibreOffice、Office/PDF、Budget、Companion） | docs/all |
| `R50-DOC-005` | 带版本戳的发布记录仍指向已发布字节的版本，且冻结的 installer 列表与契约一致 | docs/all |

### N. 反向存在性：被排除范围不得随包（1）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-ABSENT-001` | 被排除模块（Office/PDF、Budget、Companion、LibreOffice、Intel Mac）不出现在 workspace、profile、runtime、installer、产品 SBOM 任一导出集合中 | exclusion/all |

## 4. 两类补充信号

**DRIFT（第 L 节）** 与 **DOC（第 M 节）** 是本版新增的域，它们对应 0.6.5 之前
0.6.x 全部严重缺陷的共同形状：仓库冻结了一个关于外部的假定，然后没有任何东西
再检查它。

- DRIFT 由 `pnpm verify:drift` 的 5 个探针产出，探针 id 与
  `R50-DRIFT-001..005` 一一对应。语义由 `DRIFT_SUBGATES` 定义：
  红探针不阻塞发布，但必须在 Release Notes 中记录，或者被修好。
- DOC 由 `packages/release-identity/src/release-facts.ts` 的检查循环产出，
  对应 `R50-DOC-001..005`。它断言没有任何现行文档声称一个没有发布记录的
  Penglai 版本、每个文档引用的 installer 都是本版目标、仓库的发布自述内部一致、
  排除范围被如实披露、带版本戳的发布记录仍指向已发布字节。

两者都是**注册在案的 Hard ID**：缺失会被 `verify:evidence` 记为非 PASS。它们的
"不阻塞发布"只体现在 `pnpm verify:drift` 这个独立命令的退出码上（外部服务不可达
不得阻止一次其余部分完整的发布），而不体现在注册表的完整性上。

## 5. 被排除范围为何只有一条 ID

旧表为 Office/PDF、Budget、Companion 设了 38 条能力 ID（`R55-OFFICE-001..024`、
`R50-BUDGET-001..006`、`R50-COMP-001..008`）。这些模块不在本版产品运行时内，
所以那 38 条在任何一次运行中都只能产出 `missing`。本表改为
`R50-ABSENT-001`：断言它们不出现在 workspace、profile、runtime、installer 与
产品 SBOM 的**导出集合**中。

该断言检查的是各面**派生出的随包集合**，而不是对模块名做文本搜索。文本搜索在这里
必然出错：`packages/runtime/src/index.ts` 为了排除 `@penglai/office` 必须删除它，
`packages/plugin-center/src/dsh-client.js` 为了隐藏它的产品卡片必须列出它。把这两个
文件名报成违规是错的，而按路径做白名单会腐烂。

installer 与产品 SBOM 两个面只在本机构建后才存在。两者不可用时该 ID 记为
`INCOMPLETE` 而不是 `PASS`——在没有载荷被暂存时声称载荷干净，正是旧表那 38 条
产生的不诚实。
