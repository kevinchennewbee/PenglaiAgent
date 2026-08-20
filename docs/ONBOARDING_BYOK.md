# BYOK 与凭据合同

## 1. 原则

BYOK 不是 Penglai 自建 LLM 模块。DSH 已通过 `dsh-llm-pi-ai` 提供多供应商模型目录、Models settings、model discovery、default-model 与 credentials service。Penglai 只编排首次完成条件、发行路径和隐私说明。

## 2. 0.5.0 唯一生产路径

- provider：`@deepseek-ai/dsh-credentials-local`。
- 文件：app-private `$DSH_HOME/.credentials.yaml`。
- 调用：`credentials.set/describe/resolve/unset`。
- Models UI 写入 secret；renderer 后续只读 descriptor，不读明文。
- DSH host/authorized model adapter 在需要时 `resolve`；Penglai 插件不能绕过 service 直接解析 YAML。
- API key、微信 token、飞书 App Secret 使用不同 namespace/ref，不共享裸字符串。

## 3. 文件安全与真实边界

- macOS DSH_HOME 目录权限 0700、credential file 0600；Windows 使用当前用户专用 DACL，不拿 POSIX mode 冒充 ACL。
- 写入使用同目录临时文件、fsync/rename 或官方等价原子语义；失败保持旧文件。
- backup、diagnostics、profile snapshot、migration journal、SQLite、Session、日志与 evidence 均不复制 secret。
- 同一 macOS UID/Windows 用户下运行的本地高权限程序或 DSH tools 可能读取该 YAML。这是 0.5 community 候选明确接受的边界，不得宣传为硬件级或 Keychain 隔离。
- renderer compromise 仍不得通过 Penglai RPC 读取值；Remote DTO 不得存在 `getSecret`/`export` 方法。

## 4. 首次引导

首次引导是 **pre-DSH 前置 `/wizard`**（ADR 0030）：ledger 未 COMPLETE 时主窗口加载经认证代理同源提供的 plain HTML/JS/CSS 向导，不再是 DSH Web 内的 `settings.onboarding` 遮罩。向导只经 `penglaiOnboarding` Remote 编排 official seam。

1. 选择中文或 English。
2. 用所选语言阅读隐私与本地 YAML 边界。
3. 从 official Models 同一来源列出厂家：`listConfigurableProviders` 目录优先，再合并 live `listProviders`，不复制 Penglai 静态 catalog。
4. 用户选 provider/model，填入 API key；一次 official nonce Turn 测试通过后进入蓬莱。密钥经 `credentials.set`，`describe` 只回 descriptor。
5. Workspace、首次对话、微信/飞书连接都在 official DSH Web / Penglai IM 里完成，不再塞进前置向导。

ledger `current === "COMPLETE"` 后 `wizardFinished` 先验证 official DSH Web，成功才下线 `/wizard` 并切换，失败回滚保留向导。向导是临时 bootstrap 面，不是长期第二 UI。

Penglai 可以显示步骤、完成状态和错误恢复，不复制 provider catalog、key 表单逻辑或模型网络层。

语音模型下载不是 BYOK 条件，也不能阻塞可用的 DSH core。引导只调用 Center/voice model manager 的真实状态机，展示来源、许可证、版本、大小、SHA-256、磁盘占用和删除入口；不能用假进度、在 renderer 下载，或把模型包进 credentials YAML。完成后设置页仍可重新选择 ASR/TTS 模型、语言和 IM 回复模式。

Context授权必须来自原生目录选择和明确scope，不能默认扫描Documents/Home/Workspace；Memory只解释数据分层和确认规则，不在引导中自动蒸馏。Budget/Companion只显示入口，不用默认值诱导启用主动外发。

## 5. 旧版本与 Keychain 边界

0.5.0 是 fresh generation。0.4.1 或旧 alpha 可能存在其他 profile、Keychain item 或 YAML；本版不迁移：

1. legacy detector只判断已知旧产品/数据根是否存在、版本和大小，不枚举Keychain account，不读取DB或secret。
2. UI明确说明0.5需要重新配置API/微信/飞书，旧数据不会自动迁移或删除。
3. 0.5只写新的generation DSH_HOME；用户未明确操作时旧目录/hash/mtime不变。
4. `@penglai/credentials-keychain`不进入pack/catalog/profile/public-export；历史源码只能标记historical/not-product。
5. 如果用户要清理旧Keychain或旧数据，使用旧版本文档/系统工具，由独立未来任务处理；0.5卸载器不能代删。

## 6. IM secret

- 微信长期 bot token：credentials ref，例如 `penglai-im/weixin/<account-id>`。
- 飞书 App Secret：credentials ref，例如 `penglai-im/feishu/<account-id>/app-secret`。
- 飞书 App ID、adapter enabled、non-sensitive bot descriptor 可在 profile/SQLite。
- QR payload、verification code、temporary challenge 只在受控内存；超时、取消、logout 时清除。
- OAuth access/refresh token 不属于 0.5.0，因为基础飞书 bot 不走 Device Flow。

## 7. 错误分类

- `CREDENTIAL_NOT_CONFIGURED`
- `CREDENTIAL_WRITE_DENIED`
- `CREDENTIAL_FILE_PERMISSION_INVALID`
- `CREDENTIAL_CORRUPT`
- `CREDENTIAL_RESOLVE_FAILED`
- `LEGACY_GENERATION_DETECTED`
- `LEGACY_GENERATION_NOT_IMPORTED`
- `CREDENTIAL_DELETE_FAILED`

每个错误必须带安全恢复动作，不包含 value、完整路径或厂商 token。

## 8. 自动验收

- fresh DSH_HOME 的 set/describe/resolve/unset、atomic write、permission 和 concurrent write。
- renderer/Remote schema 无 secret readback。
- backup/diagnostics/evidence secret scan。
- legacy generation detected、continue fresh、cancel、old paths before/after hash不变。
- packaged app 使用私有 DSH_HOME，不触碰用户 `~/.dsh`。
- macOS mode 与 Windows ACL 分别在native installed app中反证。
- core ready 后 IM/voice/context/memory offer 的显示、跳过、恢复和持久化；全部跳过后DSH core与IM文本仍可用，Companion仍无schedule/outbound。
- 模型下载失败、hash 不匹配、空间不足或离线时不损坏 onboarding/active profile，并能从设置页安全重试。
