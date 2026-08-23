# Penglai Plugin Center 合同

## 1. 产品位置

Plugin Center 是 official DSH Web 的 host/client plugin，UI 注册在 `settings.plugins.tab`。它不是 Electron 外壳里的第二商店，也不是一个只写 `desired.json` 的状态页。

## 2. 0.5.x 内置 catalog

只允许 app 内签入并离线验证的包：

- `@penglai/plugin-center`
- `@penglai/office`（required-builtin，fresh active）
- `@penglai/memory`（required-builtin，fresh active）
- `@penglai/im`
- `@penglai/asr`
- `@penglai/moss-tts`
- `@penglai/companion`
- `@penglai/budget`（内部策略能力，不显示独立产品卡）
- `@penglai/plugin-reference`（默认 disabled，仅用于 platform proof）
- `@penglai/plugin-smoke`（测试 profile only，不进入用户 catalog）

`@penglai/credentials-keychain` 不进入默认 profile、打包清单或 catalog。未审核社区插件不显示为可用。面向用户的产品卡固定为六张：蓬莱手机消息、蓬莱办公、蓬莱语音识别、蓬莱语音生成、蓬莱记忆、蓬莱主动陪伴。ASR/MOSS-TTS 只有真实 host/client、model manager、当前发布 target engine 与验收存在时才显示；Office/Memory/Companion 也必须满足 `docs/PENGLAI_NATIVE_PLUGINS.md` 完整合同，不得先做空卡。

## 2.1 生态来源与未来扩展

- `official-core`：DSH 核心插件，Center 可显示只读来源/版本/健康，但不冒充 Penglai package，也不随意卸载核心依赖。
- `penglai-builtin`：Center、Office 与 Memory 随 fresh profile 安装并 active；Memory 包内含授权资料索引与来源卡，不再加载独立 Context 插件。IM/ASR/TTS/Companion 随 app 离线携带，但 fresh 默认未安装、未加载。
- `penglai-first-party`：蓬莱维护并完成兼容审核的扩展；以后蓬莱原生能力也只有完整实现和验收后才进入 catalog。
- `community-reviewed`：未来优质社区插件，必须经过来源与许可证审核、作者/package identity、签名或受信 checksum、权限、DSH range、平台/ABI、sandbox、安全测试、migration 和 rollback。

内置 catalog 不接受任意 npm/Git/URL，也不展示空卡。语音模型下载是已签入插件的固定数据资产管理，不等于远程安装插件代码。

## 2.2 签名远程 catalog

0.5.1 起，Center 只从公开仓库 `kevinchennewbee/PenglaiPluginRegistry` 的不可变 GitHub Release 发现远程插件。目录 JSON 与每个 tar 包分别使用内置 Ed25519 信任根验签；sequence 只能前进，断网时只读已验签的 last-good。远程包默认关闭，用户确认权限后才安装；包先写入用户私有的 `Penglai/0.5/plugins/packages`，不得修改应用内置插件目录。

0.5.5 将 `@penglai/office` 与 `@penglai/memory` 作为 fresh-install required-builtin。当前远程不可变目录是 [`plugin-catalog-v1.000005`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000005)。其中 `@penglai/office-reader` 0.1.3 只读提取 DOCX/XLSX/PPTX，声明 `workspace.read`，无网络、原生代码、安装脚本或宏执行，并使用 DSH 0.1.1-rc.2 要求的结构化输入与输出 contract。它是验证远程热插拔发行链的轻量阅读扩展，不替代安装包内 required-builtin 的完整蓬莱办公。以后发布兼容的新目录 sequence 不需要重做 Penglai 客户端；插件包更新成功后，0.5.5 只会在已授权且事务身份完全匹配时重启内置 DSH，以免 Node 模块缓存继续运行旧代码。GitHub REST 的匿名限流只允许回退到版本化 Release Atom 发现；最终信任仍来自精确 tag、目录签名、package 签名、asset id、size 与 SHA-256，绝不信任 mutable `latest`。

安装包离线携带这些 tarball 是为了让普通用户无需联网取代码即可选择扩展。fresh profile 安装 Center、Office 与 Memory；其余可选插件仅在用户点击“安装并启用”后才校验、写入、加载。完成 BYOK 后 official DSH、Office 与 Memory 必须独立可用；任一可选插件 absent/disabled/unconfigured 都不得阻断 DSH core、已安装 IM 的 text 链或无关插件。

## 3. manifest

每个可管理插件必须包含：

```json
{
  "id": "@penglai/im",
  "version": "0.5.0",
  "dshRange": "exact-tested-range",
  "platforms": ["darwin-arm64"],
  "capabilities": ["settings-ui", "im-weixin", "im-feishu"],
  "permissions": ["credentials-service", "local-database", "outbound-network"],
  "source": "bundled-first-party",
  "provenanceClass": "penglai-builtin",
  "license": "repo-declared",
  "sha256": "...",
  "migrations": ["..."],
  "rollback": "..."
}
```

manifest schema 额外验证 package name、client/host entry、archive path traversal、symlink、size、DSH ABI、Node ABI 和 license policy。

## 4. 三类状态

- `catalog`：包是否在受信 catalog。
- `desired`：用户希望 installed/enabled/disabled 的配置。
- `actual`：official DSH loader inventory 实际 loaded/active/failed/disabled。

UI 主状态必须来自 `actual`。desired 与 actual 不一致时显示 `applying` 或明确错误，不能提前变绿。

## 5. 事务模型

安装、启用、禁用、更新、回滚、卸载共用一个 transaction engine：

1. 锁定 profile revision。
2. 验证 manifest、checksum、compatibility、permissions、archive 安全。
3. 在 staging 中生成 package/profile patch。
4. dry-load 或隔离 probe。
5. 原子切换 profile。
6. 监管 DSH reload/restart。
7. 从 loader inventory 验证 actual state。
8. 运行 plugin health/contract smoke。
9. 成功提交 journal；失败恢复 package/profile/DB schema 并再次读取 inventory。

并发请求按 revision/operation id 去重；crash 后从 journal 恢复，不猜测步骤。

## 6. IM 的特殊规则

- disable `@penglai/im` 前先停止 intake，abort 两渠道 worker，处理/标记 uncertain outbox，关闭 DB handle，再切 profile。
- update 前验证 IM DB migration 能回滚；credential value 不进入 snapshot。
- rollback 后实际 loader、worker owner、schema version 和 adapter state 必须与旧版一致。
- Center 只管理整个 `@penglai/im`；微信/飞书是插件内部 adapter 开关，不是独立 npm 插件。

## 6.1 ASR/TTS 的特殊规则

- plugin actual与model actual分开：plugin可以active/healthy而model=`not_installed|downloading|ready|corrupt|failed`。
- model install/import/delete使用immutable manifest、size/SHA/license、journal和operation id；desired不能冒充ready。
- disable/update/uninstall先cancel download/inference/playback、释放native/WASM session和AudioHandle，再验证resource-zero。
- ASR/TTS互为可选能力，不得相互成为DSH core启动硬依赖；IM缺语音能力时必须text降级。

## 6.2 Context/Memory/Budget/Companion 的特殊规则

- plugin actual 与 product configuration 分开：Context无grant、Memory为空、Budget未设限、Companion关闭都属于`active/unconfigured`，不能显示failed或ready造假。
- Context index/revoke、Memory candidate/commit、Budget ledger/reset、Companion schedule/outbox各自使用versioned transaction；Center update/rollback必须验证数据schema postcondition。
- disable/uninstall先停止indexer/distiller/token subscriptions/schedules，释放DB/timer/Remote；外部授权目录和Workspace永不作为插件资源删除。
- Memory的global/SOP写入仍需Owner确认；Companion不能由Center enable动作直接开始外发，必须另行完成产品配置与同意。

## 7. UI

普通用户的每张卡只给一个主动作：未安装时“安装并启用”，已启用时“停用”，已停用时“启用”，并提供明确的“卸载”。版本、来源、权限、DSH compatibility、校验、更新、回滚和诊断放入折叠的高级信息，不把 download/install/enable/disable/update/rollback 同时铺成一排。危险操作需要清楚影响和确认；状态变化从 Remote/event refresh 获取，不能用按钮点击成功冒充 actual active。

Center 是“蓬莱”一级设置项；已启用的 Penglai 插件作为其嵌套子菜单出现，不能在内容区再造第三列，也不能把全部能力平铺成拥挤的一级菜单。ASR/TTS 卡片与各自设置页必须显示真实模型下载 `completedBytes/totalBytes`、百分比和采样速度；暂停、继续、取消复用同一 operation id，不能生成新任务冒充控制原任务。

## 8. 反证与验收

- 修改 desired 但禁止 loader 应保持 actual=failed/old，不得变 active。
- corrupt archive、wrong checksum、wrong DSH range、symlink/path traversal、migration fault 必须回滚。
- disable/update/uninstall 后没有 worker、socket、timer、DB handle 或 registered Remote orphan。
- fresh/upgrade/rollback installed app 上 inventory 与 UI 一致。
- snapshot/diagnostics 不含 `.credentials.yaml` 内容。
- manifest/platform/arch 与当前 target 不匹配必须在 profile commit 前拒绝；以后增加 target 时分别验收。
- Center UI全部zh/en且随light/dark/system变化，不保留ad-hoc `/penglai/center`生产端点。
