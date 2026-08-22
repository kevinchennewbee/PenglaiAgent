# Penglai 0.5 安装、升级、恢复与卸载合同

## 1. 范围

本合同覆盖：

- 0.5.3 在 Apple Silicon、Intel Mac 与 Windows x64 的 fresh install、首次启动与恢复。
- 公开版 0.5.1 → 0.5.3 的更新发现、签名验证、用户确认和 assisted install。
- profile/plugin/IM schema 的事务迁移与失败恢复。
- Windows 原生卸载器和 macOS 应用内卸载准备/数据管理。
- 0.4.1 旧架构的只读检测与 clean-generation 提示。

不覆盖：

- 0.4.1 → 0.5.0 自动 updater bridge。
- 0.4.1 会话、凭据、配置或数据库导入。
- 没有 Developer ID 时的 macOS 静默 auto-update。
- 绕过 Gatekeeper、SmartScreen、管理员策略或企业 MDM。

## 2. generation identity

0.5 使用新的 generation id，例如 `penglai-dsh-v0.5`，它必须同时出现在：

- userData/DSH_HOME layout。
- schema metadata。
- update journal。
- diagnostics/release manifest。
- installer/uninstaller contract。

旧 `com.penglai.agent` 产品身份可以继续用于用户可见连续性，但 0.5 data root 必须与 0.4.1 隔离。bundle identifier、Windows AppId/UpgradeCode、install path 的最终选择在 RC1 ADR 固定；目标是既不误覆盖旧 data，也不让系统出现无法辨认的两个同名新产品。

0.5 首次启动看到 legacy detector 时：

1. 只解析已知旧路径是否存在、旧版本号与大致占用空间。
2. 不打开旧数据库、不读取 credential、不枚举聊天正文。
3. 显示“0.5 是新架构，需要全新配置；旧数据不会自动迁移或删除”。
4. 提供打开备份说明、打开旧数据父目录、继续 fresh setup、取消退出。
5. 继续时只创建 0.5 root；旧路径 hash/mtime 不变。

## 3. fresh install

### macOS DMG

- DMG 是只读，包含 `Penglai.app` 与 `/Applications` 链接，窗口同时给中文/English 简短说明。
- 用户拖入 Applications；若已存在 0.5 版本，Finder 的替换行为由用户确认。
- 第一次启动由 app 执行 generation preflight，不在 bundle 内写状态。
- ad-hoc/not notarized 的事实必须在下载页/README/release notes 说明，但 app 不引导关闭系统安全机制。

### Windows Setup

- current-user install，默认不请求管理员权限。
- 安装器语言选择 SimpChinese/English，默认跟随系统。
- 安装前关闭或提示关闭 owned Penglai/DSH process；不能杀其他 DSH/Node。
- 创建 Start Menu shortcut，可选 desktop shortcut；注册 Apps & Features 卸载项。
- 安装完成可选择启动 Penglai；安装日志不记录用户路径以外的敏感内容。
- downgrade 默认拒绝；same-version repair 需要显式 repair 流程并保持 userData。

## 4. 首次启动事务

bootstrap journal：

```text
NOT_STARTED
→ LAYOUT_CREATED
→ PERMISSIONS_APPLIED
→ RUNTIME_VERIFIED
→ PROFILE_STAGED
→ PLUGINS_VERIFIED
→ PROFILE_COMMITTED
→ DSH_HEALTHY
→ ONBOARDING_REQUIRED
```

每一步写 schema version、input hash、完成时间和上一步；不写 secret。崩溃重启时只重放幂等步骤。profile seed 先在 sibling staging 组装、验证 loader inventory 和 integrity，再原子切换；失败删除 staging 或保留可诊断 quarantine，不污染 active profile。

## 5. 0.5 更新模型

### 5.1 channel

- 稳定通道固定为未来公开仓库的 `desktop-v0.5` metadata release；0.5 client 不读取 0.4 channel。
- manifest URL 使用 canonical GitHub HTTPS；payload URL 指向不可变 `releases/download/vX.Y.Z/<asset>`，禁止 `releases/latest`、短链、第三方镜像或 HTTP fallback。
- 未公开前，test profile 只连接 loopback fixture server；production build 不能通过隐藏参数切到任意 URL。

### 5.2 manifest

`latest.json` 至少包含：

```json
{
  "schemaVersion": 1,
  "channel": "desktop-v0.5",
  "version": "0.5.3",
  "publishedAt": "...",
  "minimumVersion": "0.5.0",
  "notesUrl": "...",
  "platforms": {
    "darwin-aarch64": {
      "url": "...",
      "sha256": "...",
      "signature": "...",
      "size": 0
    }
  },
  "signatureKeyId": "..."
}
```

完整 manifest schema 还要固定 target、installer kind、source/export tree、release manifest hash、minimum OS、migration range。manifest 本体与 payload 都验独立签名；只验 HTTPS 或只验 SHA-256 都不够。

### 5.3 状态机

```text
IDLE
→ CHECKING
→ AVAILABLE | CURRENT | FAILED
AVAILABLE
→ DOWNLOADING
→ VERIFYING
→ READY_FOR_USER
→ INSTALL_REQUESTED
→ DRAINING_DSH
→ DATA_BACKUP_READY
→ HANDOFF_TO_INSTALLER
→ RESTART_PENDING
→ POST_UPDATE_VERIFY
→ COMMITTED | ROLLED_BACK | RECOVERY_REQUIRED
```

状态持久在 app-private update journal；任一重启都能解释现在处于哪一步和下一动作。UI 必须允许取消 check/download；VERIFYING 后不能使用未验 payload。

### 5.4 anti-rollback

- SemVer 必须严格大于当前版本。
- channel/minimum/current platform/arch 必须匹配。
- 拒绝同版本重放、旧版本、未来未知 schema、过期 key、错误 key id、可变 URL、size/hash/signature 不一致。
- 成功版本与 manifest digest 写入 durable ledger；ledger 损坏 fail closed 并进入 repair，不自动归零。
- 本地时钟异常不能让过期/未来 manifest 被静默接受；时间只作辅助，签名和版本 ledger 是主门。

## 6. community trust tier 的 assisted upgrade

Electron官方说明macOS autoUpdater需要已签名app。当前0.5 community candidate只有ad-hoc seal、没有稳定Developer ID publisher identity，也未在quarantine/替换/回滚下证明Squirrel.Mac可靠。因而0.5.0的产品承诺是：

1. 应用检查 canonical manifest。
2. 下载当前 platform/arch 的 exact installer。
3. 在 main process 校验 manifest signature、payload signature、SHA-256、size 和 release identity。
4. 明确显示版本、大小、发行说明、trust tier 和“需要由系统安装器确认”。
5. 用户确认后，停止 owned DSH、flush IM、取消/收束 ASR/TTS job、模型下载、Context indexer、Memory distiller、Budget subscriptions与Companion schedules，建立 schema backup/journal。
6. macOS 挂载/打开已验证 DMG并显示替换步骤；Windows 启动已验证 NSIS Setup。
7. 新版本首次启动读取 journal，验证 app version、runtime/profile/plugin inventory、DSH health 后提交 migration。
8. 新版本启动失败时，保留数据 backup 和恢复说明；不得删旧可恢复状态。

这叫“应用内辅助升级”，不能在 UI/README/release notes 写成“后台静默自动升级”。未来 OS-trusted 版本可在单独 ADR 后启用 Electron autoUpdater，但必须新增 Developer ID/Authenticode、真机升级和 rollback 验收。

## 7. update fixture 与测试

仓库必须提供 production 不可达的 test harness：

- loopback-only update server。
- ephemeral test signing key；private fixture key 只在测试临时目录生成，不提交。
- `0.5.3-test.N` payload，包含可识别版本但不含产品 secret。
- valid、tampered payload、wrong key、wrong arch、rollback、same version、truncated download、disconnect/resume、disk full、installer cancel、crash between every journal transition。

fixture 不能通过 `/penglai/usable-fixture` 暴露给 production renderer。test-only entry 必须在 build-time test target 中编译隔离，release bundle scanner 证明不存在。

三个 native installed suites 都要验证：

- valid assisted upgrade 完成并保留 onboarding/Workspace binding/IM config descriptor。
- credentials 内容不进入 backup/update log；新版本仍能通过 descriptor 解析。
- corrupt update fail closed，当前 app 可继续运行。
- installer cancel 后 journal 回到安全可重试状态。
- update 时 IM inbound/outbox 有界 drain，未发送项重启后不重放两次。

## 8. schema migration

0.5 内部数据由 schema registry 管理：profile、Center、onboarding、IM DB、binding、voice settings/model inventory/local-voice consent、Context grants/index、Memory、Budget ledger、Companion schedule、update ledger 分开版本化。每个 migration 必须：

- 声明 from/to、precondition、backup set、forward、verify、rollback。
- 幂等且可在每个写入点注入 crash。
- 不跟随 symlink/reparse point。
- backup 在同一 userData boundary，权限不弱于原数据；不包含明文 secret 的额外副本。
- 新 app、旧 schema 不兼容时进入 repair UI，不启动半迁移 DSH/worker。

只支持 0.5 generation 内已声明 migration。未知更老 generation 一律不自动执行。

## 9. 数据分类

设置 → 存储与卸载必须展示：

| 类别 | 示例 | 默认卸载 | 可导出 | complete delete |
| --- | --- | --- | --- | --- |
| App binaries | `.app` / install root | 删除 | 否 | 删除 |
| Runtime/cache | update cache、临时包、Chromium cache | 删除 | 否 | 删除 |
| Settings | locale/theme/onboarding/Center config | 保留 | 是 | 用户选择 |
| DSH state | profile、Session、Turn metadata | 保留 | 受控 | 用户选择 |
| IM state | bindings、inbox/outbox、cursor、dedupe | 保留 | redacted | 用户选择 |
| Voice models | SenseVoice/MOSS 权重、manifest、下载缓存 | 保留 | 否 | 用户选择 |
| Local voices | 用户明确创建的参考音频/embedding/consent metadata | 保留 | 受控 | 单独选择并二次确认 |
| Voice temporary data | IM下载音频、转码、ASR/TTS临时文件 | 删除 | 否 | 删除 |
| Context grants/indexes | 授权descriptor、FTS派生索引、解析cache | 保留 | redacted | 用户选择；绝不删源目录 |
| Memory | global L1、Workspace memory、candidates、receipts | 保留 | 受控 | 分global/Workspace/candidates选择 |
| Budget | 用量ledger、limits、Owner lifts | 保留 | redacted | 用户选择 |
| Companion | schedules、policy、opaque delivery audit | 保留 | redacted | 用户选择 |
| Credentials | `.credentials.yaml` | 保留 | 不导出明文 | 独立二次确认 |
| Workspaces | 用户选择的外部项目目录 | 永不删除 | 不归 app 管 | 永不删除 |
| Legacy 0.4.1 | 旧 generation root | 永不删除 | 仅说明 | 不由 0.5 删除 |

任何总大小都是实时计算的近似值；UI 不能因无法读取某目录就显示 0 并继续删除。

## 10. Windows 卸载

### 默认卸载

1. 发现 running app/owned DSH，要求正常退出并有界等待。
2. 删除 install root、Start Menu/Desktop shortcuts、protocol/autorun entries、uninstall registry、update cache。
3. 默认保留 0.5 userData/DSH_HOME/credentials/IM DB、voice models/local voices、Context indexes、Memory、Budget与Companion data，并明确显示保留路径和占用空间。
4. 重装同 generation 可重新使用这些数据，前提是 schema/完整性 gate 通过。

### 完整删除

- 用户在 app 设置页先选择数据类别并输入精确确认词；app 写短期、单次、不可伪造的 deletion plan。
- uninstaller 只执行经 HMAC/capability 绑定的 exact resolved paths，逐项核对 boundary、owner、type、reparse point 与 count。
- credentials 单独勾选并再次确认；Workspace 和 legacy 永远不进入 plan。
- 任一文件锁/ACL/路径变化导致立即停止，显示未删除清单；不得改权限或扩大范围重试。

## 11. macOS 卸载

macOS DMG 没有标准 uninstaller，0.5 必须在设置页提供“卸载与数据”：

1. 导出可导出的设置/诊断摘要。
2. 停止 IM/voice/context/memory/budget/companion workers、模型下载、DSH 和 updater，验证无 owned child/handle。
3. 按类别删除 cache 或用户明确选择的数据；credentials 单独二次确认。
4. 显示保留数据和 exact paths。
5. 指示用户退出后将 `/Applications/Penglai.app` 移到废纸篓；不能由 app 自删后留下不可解释状态。

也可提供受控的 `Penglai Cleanup` helper，但若实现必须由同一 artifact 签名、只接受上述 deletion plan、拒绝 symlink，并纳入全部安全测试；没有充分必要性时不新增 helper。

## 12. uninstall 后验收

- app/shortcut/uninstall entry 按用户选择消失。
- 没有 owned Electron/Node/DSH/worker/socket/lock/timer。
- 默认卸载后 userData 存在、hash 不变，credentials ACL 不弱化。
- complete delete 只删选中类别；未选、Workspace、legacy hash 不变。
- local voice 与原始参考音频必须作为独立敏感类别显示；不因删除普通 cache/model 自动连带删除或保留不明。
- Context source directories与Workspaces永不进入delete plan；Memory global/Workspace/candidates分别显示，长期记忆删除需独立确认。
- 重装 fresh 或保留数据重装均能给出确定状态，不进入半 profile。
- 日志只记录类别、opaque plan id、结果与错误码，不记录 secret、正文或完整 owner path。

## 13. 一票否决

- 把 0.4.1 自动导入/删除写成“方便迁移”。
- updater 未验独立签名就打开 payload。
- 使用 `latest` 可变 URL、HTTP fallback 或任意用户输入 feed。
- 没有 Developer ID 却宣称 macOS silent auto-update。
- 升级失败损坏当前可运行版本或只剩半迁移 profile。
- 卸载器递归用户 Workspace、legacy root、symlink/junction/reparse target。
- 为删除失败改权限、杀非 owned 进程或扩大路径。
