# Penglai 0.5.10 安全与隐私合同

## 1. 信任目标

0.5保护相互关联的边界：只读target app/runtime、app-private 0.5 DSH profile、official DSH Web本地入口、credentials-local secret、IM因果隔离、厂商网络输入、本地voice/context/memory数据、budget/companion authority、signed assisted update、精确卸载和可公开供应链。任何Penglai插件都不能放宽DSH工具权限、sandbox或人工审批。

## 2. 数据分级

| 级别 | 数据 | 允许位置 |
| --- | --- | --- |
| S0 Public | 开源许可证、版本、catalog、hash/public key | bundle/docs/manifests |
| S1 Config | locale、App ID、enabled、provider/model id | profile/DB |
| S2 Route | opaque peer/message/turn/session/binding id、受控reply target | IM DB最小保留 |
| S3 Content | 私聊正文、模型final、原始音频/转写、授权资料正文、长期记忆 | 对应app-private store最小保留；DSH Session按official策略 |
| S4 Secret | API key、微信token、飞书App Secret | credentials-local YAML或短生命周期host内存 |
| S5 Ephemeral Auth | QR payload、verification code、challenge | 受控进程内存，TTL后清除 |
| S6 Release Secret | updater private key、Apple/Windows signing credentials | Owner外部secret store，永不进repo/artifact/evidence |

S3–S6不得进入Git、普通日志、diagnostics、截图或evidence。S2只保存路由所需最小字段，显示时用HMAC/hash peerRef；真实reply target加受控访问与retention。

## 3. 明确威胁

- 恶意IM sender绑定任意Session、prompt injection控制slash命令或工具。
- duplicate/out-of-order事件造成重复Turn、串线或跨channel回复。
- hashed peerRef错误当vendor target，回复发错人。
- compromised renderer调用过宽Remote、读取secret、文件或执行更新包。
- loopback proxy/QR endpoint被其他本地页面跨站调用。
- YAML权限/ACL、backup、diagnostics、migration/update journal泄漏。
- archive path traversal、symlink/junction/reparse、wrong arch/checksum、dependency confusion。
- worker多实例、crash、sleep/wake/reconnect导致重复poll/send。
- 恶意updater manifest回退、重放、换平台、换URL、tamper payload。
- uninstall/delete plan解析为空/root/home/Workspace/legacy或跟随link。
- public export泄漏private docs、owner path、secret、无许可证binary。
- branding overlay版本漂移改坏official DSH runtime。
- Context授权根逃逸、恶意文档/压缩炸弹/宏/外链，或撤销时误删源文件。
- Memory跨Workspace污染、模型无确认写global/SOP、旧/恶意记忆提高工具权限。
- Budget并发/时钟回退/IM旁路导致超额，或未知价格被伪装成准确费用。
- Companion默认外发、quiet-hours失效、重复触发、错误路由或无人值守执行高权限工具。

## 4. TCB

TCB包括Electron main/preload、embedded target Node、pinned DSH、profile/Center/update/delete transaction、credentials-local、Penglai host plugins、voice/document parsers、Typert schema、local proxy、installer helper和exact branding overlay。renderer、IM内容、用户文档/记忆候选、可选plugin、厂商网络、二维码、downloaded installer和legacy data均不可信/最小权限。

## 5. Desktop hardening

- BrowserWindow：context isolation、sandbox、no node integration、deny arbitrary navigation/window open/download。
- preload只暴露窄capability；业务RPC走authenticated DSH/Typert，不暴露generic IPC/shell/fs/updater。
- local proxy随机capability、exact origin/path/method、size/timeout/rate；path canonicalize后授权。
- token不放URL/query/title/browser storage。
- production只用absolute embedded runtime；环境/PATH/repo不可覆盖。
- Electron fuses从packaged binary实测；INCOMPLETE必须non-zero。
- macOS ad-hoc seal与Windows no Authenticode诚实记录；不指导关闭Gatekeeper/SmartScreen。

## 6. credentials-local

- secret只经official `set/resolve/unset`，client无read/export方法。
- macOS DSH_HOME 0700、credential 0600；Windows DACL仅当前用户/SYSTEM/必要管理员。
- 写入同目录唯一temp、flush、atomic replace；失败保留旧文件。
- profile/DB只存CredentialRef与descriptor。
- 同OS用户高权限本地进程可能读取文件，UI/文档必须诚实。
- permission/ACL invalid、corrupt、write denied、resolve failed全部fail closed；无env/MemoryVault/SQLite/Keychain fallback。
- 0.4.1 credential不读取、迁移或删除。
- official DSH 0.1.2-rc.1 源码内含 session-telemetry adapter 和预配置的 DeepSeek OTLP 地址。
  蓬莱不运营该后端；owned DSH 的封闭环境白名单固定注入
  `DSH_TELEMETRY_DISABLED=1`，且不转发 `DSH_TELEMETRY_MODE` 或
  `DSH_TELEMETRY_OTLP_URL`。DSH 会在 profile patch 之后禁用该行，不创建 telemetry
  SDK provider 或上传管线。未来若产品要提供 opt-in，必须另行设计可见 Owner 同意和
  数据披露，不能靠 profile 或父进程环境静默打开。

## 7. Onboarding与API测试

- provider/model来自official directory，不向Penglai server发送选择/key。
- secret field按password policy，提交后清组件state；clipboard/autofill行为可控。
- 连接测试走official DSH provider/AgentHandle、低token、无工具、随机nonce；只留digest。
- IM/voice/context/memory offer只在descriptor、default model、Workspace、真实Turn全部ready后出现；跳过不阻塞core，Companion不在onboarding中默认启用。
- state CAS/nonce防直接改JSON或UI flag跳步；test fixture production不可达。

## 8. IM inbound/outbound

- schema/type/size/auth/tenant/account/allowlist/rate/dedupe在模型前。
- 微信scanner-only；飞书configured tenant/bot p2p text/audio only。
- 未绑定route不调用模型；slash commands不进model context。
- message id、claim、turn、route snapshot、durable final、outbox、reply target缺一不外发。
- partial/unknown/desktop/other route不外发；binding revision防mid-turn swap。
- vendor idempotency可用则使用；uncertain send不盲重发。
- IM channel不获得比desktop更宽的tools/approval权限。

## 9. 微信

- QR/challenge no-store、TTL、cancel清除；不入截图/evidence。
- redirect host allowlist+HTTPS；token不进URL/log。
- 每请求生成正确随机header；固定值测试失败。
- cursor与inbox原子，scanner owner/allowlist先于模型。
- auth invalid停止retry；network/429使用有界指数退避+jitter。
- logout stop poller/timer、revokecredential、清QR/config，并按用户选择处理history。

## 10. 飞书

- App Secret write-only；App ID可作为S1持久。
- 最小权限，不预取群/通讯录/文件；UI不展示假QR/Device Flow。
- event验证app/tenant/chat/type，3秒内durable enqueue。
- event dedupe持久；真实open_id/chat target与peerRef分开。
- SDK token/cache只在host/SDK边界，不进DB/evidence。
- reconfigure/rotation/disconnect/logout后只有一个或零client owner，socket/listener清理可证。

## 10.1 Context、Memory、Budget 与 Companion

- Context grant由用户gesture产生并绑定scope/revision；indexer拒绝link escape、宏/active content、外链、超限archive/page/cell/text。检索结果是untrusted data，source status只由host按文件digest验证。
- Memory 注入有行/字节上限并标记来源/时间/scope；自动 curator 使用同供应商/模型的 official no-tools Agent，并由 Host 进行封闭格式、secret、敏感内容和注入风险校验。它只能自动写 exact Workspace；personal/global/SOP 变更必须 Owner 确认，SOP 只走 official Skill service。
- Budget gate位于official model invocation前，ledger使用actual usage；并发reserve/settle原子。clock rollback不重置额度，价格缺失不计算伪费用。
- Companion fresh off；启用配置必须exact binding。所有trigger先过quiet-hours/budget/rate/recent-stop，Turn权限封顶plan/no-tools；IM authorization/send前再次核验。
- 四插件的Remote不返回资料正文、memory body、usage prompt、情绪原文或vendor target；client只取必要摘要和用户主动打开的受控preview。

## 11. Plugin Center与供应链

- bundled allowlist；manifest/schema/checksum/license/DSH/platform/arch/ABI全验。
- 解包拒绝absolute、`..`、symlink/hardlink/device/reparse/case collision/超限。
- overlay先验exact target hash；漂移fail build。
- SBOM/licenses/runtime manifest覆盖Electron、Node、DSH、Lark SDK、voice/document native modules、八个first-party tarballs、installer maker。
- lifecycle script不得下载未列清单远程代码；cache hit仍重验hash。
- Critical/High dependency风险未关闭即FAIL。

## 12. Assisted update

- feed固定canonical HTTPS/immutable asset URL；renderer不能自定义。
- manifest与payload都验独立signature、hash、size、platform/arch、version/source。
- durable ledger拒绝downgrade/same-version replay/wrong key/future schema。
- downloaded temp不可执行；verify完成后才进入READY_FOR_USER。
- 用户确认后drain owned DSH/IM/voice/indexer/distiller/budget subscriptions/companion schedules、写backup/journal，再打开原生DMG/Setup。
- 每个state crash可恢复；corrupt/cancel/failure不破坏当前可运行app。
- fixture private key/server/test payload不进production artifact。
- 无Developer ID时不声称macOS silent auto-update。

## 13. Uninstall与删除

- storage inventory按类别列出exact resolved paths/size/影响。
- default uninstall保留0.5 userData；credentials complete-delete独立二次确认。
- deletion plan绑定operation/capability/path/type/count/owner，短期一次性。
- 拒绝空路径、root/home/drive root、Workspace、legacy、symlink/junction/reparse。
- 文件锁/ACL/路径变化立即停；不提权、不改权限、不扩大范围重试。
- before/after hashes证明未选数据、Workspace和legacy不变。
- Windows uninstaller与macOS数据向导都必须停止owned process tree。
- Context源目录/Workspace永不进入delete plan；Memory global/Workspace/candidates、Context派生index、Budget ledger、Companion schedules分别列出和确认。

## 14. Public-export与release secret

- export只走allowlist，规范mode/mtime/order并生成tree hash。
- secret/owner path/private evidence/cache/artifact/无license binary默认拒绝。
- updater private key、Apple/Windows credentials不进Git、命令参数、普通env dump、日志、artifact、evidence。
- final signing只记录public key id、signature/hash/result。
- exact三安装包绑定source/export；验收后不重建偷换。
- public repo/tag/Release/channel在本轮保持未执行。

## 15. 日志、诊断与evidence

- structured allowlist logging；默认不记headers/body/QR/full path/identity/audio/transcript/context filename/content/memory body。
- error只留code/component/phase/time/retry class/opaque operation id。
- redaction覆盖分片、base64、URL encoding、structured、Unicode形式，再跑scanner。
- evidence保存nonce digest、opaque ids、source/export/artifact、target/native、时序和result digest。
- live不得录屏/截图包含QR、账号、App Secret或正文。
- crash dump/update backup/rotation log同样纳入scanner。

## 16. Retention

- completed IM body默认24h内清理，可配置更短。
- failed/uncertain只保留恢复所需最小期限并在UI可见。
- QR/verification/challenge在完成/取消/超时立即清除。
- diagnostics export由用户主动生成、有TTL、默认redacted。
- updater cache在成功/取消/失败后按状态清理，不留可执行tampered payload。
- Context parse/index cache按revoke/delete清理但源文件不动；Memory candidates、Budget ledger、Companion audit有用户可见retention，Companion emotion signal不保存原文。

## 17. Security tests

- Remote/IPC schema fuzz、CSRF/origin/capability/revision/rate。
- renderer尝试secret/fs/shell/updater/delete操作全失败。
- path traversal/symlink/junction/reparse/archive bomb/wrong checksum/arch/overlay drift。
- cross-channel/cross-binding/unknown final/replay/out-of-order/duplicate。
- worker double-start、quit/unload/sleep/wake/offline/reconnect storm。
- credential mode/ACL/corrupt/concurrent write。
- update wrong key/tamper/rollback/replay/crash/cancel。
- uninstall malicious plan/root/Workspace/legacy/locked/partial delete。
- secret/body/QR/owner-path scan覆盖repo/public-export/app/DMG/Setup/log/DB/diagnostics/evidence。
- Context grant escape/document bomb/source-delete、Memory scope/global-consent、Budget concurrency/clock/IM bypass、Companion quiet-hours/no-tools/dedupe/route/resource-zero。

## 18. 0.5.10 权限与附件增量

- Renderer 的 `ownerConfirmed`、布尔值、UUID 外形或模型文本都不是权限。Office、Memory、IM、Plugin Center 和 artifact persistence 统一消费 Main Owner Broker receipt；receipt 绑定 action/object/Workspace/Session/digest/destination/revision，真实动作成功后才 complete。
- Artifact ID 是不透明 `artifact:<uuid>`，不是 filesystem path 或 content hash。相同字节跨 Workspace 仍为不同 binding；legacy digest 只有唯一时才可解析。
- official DSH 0.1.2-rc.1 的通用会话附件能力只按真实接口与安装证据声明。0.5.10 不用 DOM hack、假 image 或第二会话引擎制造普通文件附件；Office/IM 文件走 scope-checked Artifact Service。
- macOS 包只声明双语麦克风用途，并剥离 Electron 默认 camera、Bluetooth 与无关 capture permission。Main 只允许由当前用户手势触发的 audio 请求。
- 0.5.10 的唯一「消息连接」插件提供八个平台的真实连接 adapter；公开能力边界以
  当前产品合同和对应证据为准。微信、飞书、钉钉、企业微信、QQ 只显示供应商真实
  QR/注册 challenge；Slack、Telegram、Discord 没有对应的官方扫码流程，必须如实
  使用官方 Manifest/Token，不得生成假 QR 或把 UI 状态冒充已连接。WhatsApp 在
  0.5.10 中不展示、不支持、不列为规划，也不捆绑运行时。

任一Critical/High或可复用secret泄漏都使候选FAIL。若真实凭据可能泄漏，立即停止、通知用户轮换、作废相关artifact/evidence；不得为了保住READY删日志掩盖。
