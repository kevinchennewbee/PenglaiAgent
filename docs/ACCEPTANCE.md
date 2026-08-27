# Penglai 0.5.x 三端基础验收合同

> 当前 0.5.7 在本合同的 R50/R55 能力类别基础上增加
> `docs/0.5.7/ACCEPTANCE_DELTA.md`。本文保留历史机器可解析 Hard ID，精确版本、
> 文件名与公开目标以 `release-contract.json` 为准；任何旧版本字样都不能覆盖当前
> 0.5.7 机器身份。

## 1. 判定对象与结论

当前唯一验收对象是一个 exact `Penglai 0.5.7` release set：同一 clean source、同一 deterministic public-export tree、Apple Silicon DMG、Intel Mac DMG、Windows x64 Setup、配套 manifests/SBOM/notices。三个安装包必须来自同一 source SHA；交叉构建只能作为预检，不能替代对应原生 runner。0.5.7 的自动记忆、Owner Broker、Artifact、IM 可用性、TTS 与隐私增量必须同时通过 delta 合同。

允许结论：

- `PASS`：所有适用的自动化、native、installed 与 public-release Hard PASS，exact set冻结。
- `OWNER_ACCEPTANCE_PENDING`：需要所有者账号或长时间运行的补充验收尚未发生；不得冒充 PASS，也不覆盖已完成的自动化/native/public 证据。
- `FAIL`：任一适用发布 Hard FAIL、STALE、MISSING、伪造或产品偏航；已执行的补充验收若发现真实失败，也必须单独处置。

`SKIP`、`BLOCKED`、`NOT_RUN`、`WAIVED`、`UNKNOWN`、`INCOMPLETE`都不是PASS。本版没有条件豁免。community trust tier中的`notarized=false`是候选定义的受验事实，不是被豁免的OS信任门。

## 2. Evidence 规则

以下每一行都是对应证据类别内的 Hard assertion。registry 继续保留 R50/R55 的机器可解析 ID，并由 0.5.7 delta 增加本轮产品门；基础表预期共 **330** 个唯一 ID。实现必须动态解析，不能把计数写成散落的完成映射。每个ID必须指向真实runner的具体assertion，包含candidate/source/export/target/artifact/runner native/时间/exit/result digest。不能通过文件名、字符串存在或一个smoke扇出PASS。需要所有者账号或长时间运行的 live/soak assertion 属补充验收：缺失不能冒充 PASS，也不作为自动化发布聚合的永久阻塞项。

平台标记：

- `all`：平台类门禁展开为全部三个目标；非平台类门禁只执行一次源码/聚合检查。
- `mac-arm`、`mac-x64`、`win-x64`：分别绑定三个 exact native artifact，均参与 0.5.7 PASS。
- `live`：真实账户最后集中执行。
- `aggregate`：release-set/public-export聚合。

## 3. Hard registry

### A. Truth、版本与工作流（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-TRUTH-001` | root/workspace/desktop/profile/plugin/release contract版本全部为当前 `release-contract.json` 的 0.5.7 | contract/all |
| `R50-TRUTH-002` | candidateKind、trustTier、generation、三个target与三个exact filename一致 | contract/all |
| `R50-TRUTH-003` | 旧alpha artifact/evidence/READY全部STALE并被verifier拒绝 | failure/all |
| `R50-TRUTH-004` | UNFROZEN identity不得携带artifact/signature/live/READY | unit/all |
| `R50-TRUTH-005` | release branch/PR 可审计且不 force；合并前不创建公开 tag，合并后 main 必须保持 exact candidate source | git/aggregate |
| `R50-TRUTH-006` | candidate freeze 时 HEAD 已推送、dirty=false；公开 freeze 时 `origin/main` 必须等于同一 source SHA | git/aggregate |
| `R50-TRUTH-007` | 任一适用发布硬子门FAIL/INCOMPLETE/STALE都使verify:release non-zero；补充验收另列 | fault/all |
| `R50-TRUTH-008` | repo=`kevinchennewbee/PenglaiAgent`、tag/release=`v0.5.7`，且发布前 updater Release 不得冒充已公开 | manifest/aggregate |

### B. DSH唯一核心与 capability parity（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-CORE-001` | packaged app用absolute embedded Node启动pinned official DSH | installed/all |
| `R50-CORE-002` |完成引导后BrowserWindow加载authenticated official DSH Web | installed/all |
| `R50-CORE-003` |无第二Agent/session/model registry/provider gateway/chat UI | architecture/all |
| `R50-CORE-004` |Models与default model来自official Pi/DSH APIs | contract+installed/all |
| `R50-CORE-005` |Workspace/Session/Turn均由official DSH创建与恢复 | integration+installed/all |
| `R50-CORE-006` |tools/approvals/permissions/settings/help/project能力可见可用 | parity/all |
| `R50-CORE-007` |Penglai modules使用official client slots/settings/Remote seams | contract/all |
| `R50-CORE-008` |overlay有exact upstream/version/checksum/ADR且parity零回退 | overlay/all |

### C. Penglai品牌、语言与主题（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UI-001` |app/window/menu/About/installer/shortcut/uninstaller显示Penglai/蓬莱 | installed/all |
| `R50-UI-002` |fresh默认zh，所有Penglai页面无未翻译硬编码 | locale/all |
| `R50-UI-003` |English可切换、完整且重启持久 | installed/all |
| `R50-UI-004` |light/dark/system三态覆盖全部Penglai UI | visual/all |
| `R50-UI-005` |system主题运行时变化即时响应并持久 | installed/all |
| `R50-UI-006` |品牌overlay不阻断DSH导航、Models、Workspace、Session、设置 | parity/all |
| `R50-UI-007` | About 显示 0.5.7、DSH/target/trust/data/license 准确 | installed/all |
| `R50-UI-008` |UI/README不出现已公证、Authenticode或silent auto-update误述 | content/aggregate |

### D. 首次引导、多API、Workspace与Turn（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-ONB-001` |fresh install从WELCOME开始且状态在app-private profile | installed/all |
| `R50-ONB-002` |隐私/YAML/IM说明必须明确继续且zh/en一致 | installed/all |
| `R50-ONB-003` |provider/model列表实时来自official catalog | integration/all |
| `R50-ONB-004` |支持实际可用多provider与official OpenAI-compatible配置 | contract/all |
| `R50-ONB-005` |credential UI只写official seam，输入后清renderer state | security/all |
| `R50-ONB-006` |API test是真实official nonce Turn，不是health/mock shortcut | integration+installed/all |
| `R50-ONB-007` |auth/rate/model/network/timeout错误分类与修复可见 | fault/all |
| `R50-ONB-008` |Workspace选择/创建使用official API并处理权限失败 | installed/all |
| `R50-ONB-009` |真实Session/Turn/final完成后才CORE_READY | integration/all |
| `R50-ONB-010` |core ready后出现IM/voice/context/memory offer，可跳过；Budget unlimited、Companion fresh off | installed/all |
| `R50-ONB-011` |每一步crash/restart/back/change provider安全恢复与重验 | chaos/all |
| `R50-ONB-012` |production bundle无usable-fixture、bypass或test onboarding endpoint | artifact/all |

### E. Credentials 与本地数据边界（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-CRED-001` |API/微信/飞书secret只经official credentials service | contract/all |
| `R50-CRED-002` |production provider为app-private credentials-local YAML | installed/all |
| `R50-CRED-003` |renderer/Remote/network永远读不回明文 | security/all |
| `R50-CRED-004` |macOS目录0700、文件0600、owner正确、原子写 | installed/mac-arm |
| `R50-CRED-005` |Windows DACL限当前用户/SYSTEM/必要管理员，无Users/Everyone读 | installed/win-x64 |
| `R50-CRED-006` |Keychain/MemoryVault/env/SQLite/browser storage无生产fallback | artifact+security/all |
| `R50-CRED-007` |backup/update/diagnostics/evidence不复制明文credential | security/all |
| `R50-CRED-008` |0.4.1 credential不读取、不迁移、不删除 | legacy/all |

### F. Plugin Center（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-CENTER-001` |official DSH settings左栏以连续order呈现蓬莱概览和已启用的Center/IM/ASR/TTS/Context/Memory/Budget/Companion页面；内容区无第三列，未启用页不存在，loader roster改变后只做应用内reload | installed/all |
| `R50-CENTER-002` |catalog只含真实签入的Center/IM/ASR/MOSS-TTS/Context/Memory/Budget/Companion，无假社区卡 | contract+installed/all |
| `R50-CENTER-003` |manifest具版本/DSH/platform/capability/permission/source/license/hash/migration | contract/all |
| `R50-CENTER-004` |install/enable/disable/update/rollback/uninstall是journal事务 | integration/all |
| `R50-CENTER-005` |actual/healthy/error来自loader inventory/health | integration+installed/all |
| `R50-CENTER-006` |desired不能冒充installed/active | fault/all |
| `R50-CENTER-007` |tampered/incompatible/wrong-arch package在commit前拒绝 | security/all |
| `R50-CENTER-008` |事务任一点crash后恢复单一一致或rollback | chaos/all |
| `R50-CENTER-009` |fresh 运行 Center + Office + Memory（required-builtin inventory `active`）；IM/ASR/MOSS-TTS/Companion 默认 disabled；用户启用后由真实 loader inventory 反证 active | installed/all |
| `R50-CENTER-010` |disable/uninstall后无plugin worker/socket/timer/Remote/DB handle | installed/all |

### G. IM core、Remote、UI、持久化与supervisor（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-IM-001` |微信/飞书同属唯一@penglai/im adapter registry | architecture/all |
| `R50-IM-002` |host/client用Typert Remote/generated client，无ad-hoc管理HTTP | contract+artifact/all |
| `R50-IM-003` |DSH settings→蓬莱→连接→消息连接中有总览/微信/飞书/绑定/命令/诊断完整可操作UI | installed/all |
| `R50-IM-004` |SQLite持久adapter config/binding/inbox/turn/final/outbox/cursor/dedupe | integration/all |
| `R50-IM-005` |vendor reply target受控保存，peerRef只作隐私索引 | security+integration/all |
| `R50-IM-006` |supervisor单owner、幂等start/stop、AbortController | concurrency/all |
| `R50-IM-007` |auth/429/network分类和指数退避+jitter | fault/all |
| `R50-IM-008` |online/offline/sleep/wake/crash后按configured+enabled恢复 | chaos+installed/all |
| `R50-IM-009` |queue/backpressure/lease防重复active worker | load/all |
| `R50-IM-010` |mock text/voice走真实worker/DB/official Turn/ASR-TTS/outbox，无shortcut | integration/all |
| `R50-IM-011` |diagnostics仅redacted状态、error class、opaque ids | security/all |
| `R50-IM-012` |logout/disable/uninstall后不再收发且资源为零 | installed/all |

### H. 微信（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-WX-001` |UI一键begin并显示真实QR image/challenge与倒计时 | installed/all |
| `R50-WX-002` |pending/scanned/confirmed/expired/verification/failed/cancelled全状态 | contract+installed/all |
| `R50-WX-003` |有限刷新、redirect base、验证码、cancel race按pinned合同 | contract+chaos/all |
| `R50-WX-004` |confirmed token只写credential seam，QR/token及时清除 | security/all |
| `R50-WX-005` |扫码者成为默认唯一allowlist，其他身份模型前拒绝 | integration/all |
| `R50-WX-006` |getUpdates持续运行且cursor与inbox claim原子持久 | integration+chaos/all |
| `R50-WX-007` |每请求header/uin/endpoint/redirect符合pinned协议 | contract/all |
| `R50-WX-008` |send使用原始vendor target而非hashed peerRef | integration/all |
| `R50-WX-009` |429/auth revoked/network/5xx分类退避，auth不无限重试 | fault/all |
| `R50-WX-010` |duplicate/out-of-order/crash恢复不丢不双发 | chaos/all |
| `R50-WX-011` |只允许authorized private text/voice；群/图片/文件/视频/unknown在模型前拒绝 | security/all |
| `R50-WX-012` |restart/sleep/offline恢复与logout/revoke/资源清理完整 | installed/all |

### I. 飞书（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-FS-001` |UI提供创建应用/机器人/权限/事件/发布完整向导 | installed/all |
| `R50-FS-002` |App ID持久，App Secret只存credential ref且不可读回 | security+installed/all |
| `R50-FS-003` |doctor区分credential/bot/permission/event/publish/tenant/network | contract+installed/all |
| `R50-FS-004` |official SDK 1.73.0实体依赖存在于插件closure并可load | artifact+installed/all |
| `R50-FS-005` |WSClient/EventDispatcher收消息并在3秒内durable enqueue | integration+timing/all |
| `R50-FS-006` |Client发送到真实open_id/chat target而非peerRef | integration/all |
| `R50-FS-007` |event dedupe持久且验证tenant/app identity | security+integration/all |
| `R50-FS-008` |只接受configured p2p text/audio，群/图片/文件/视频/card模型前拒绝 | security/all |
| `R50-FS-009` |supervisor负责connect/reconnect/outbox/start/stop | integration+chaos/all |
| `R50-FS-010` |disconnect/logout真正stop SDK socket/listener并清配置 | installed/all |
| `R50-FS-011` |auth/permission/429/network有界退避与修复指导 | fault/all |
| `R50-FS-012` |官方 app/registration 一键扫码；无用户 Device Flow 或假 QR | artifact+installed/all |

### J. Binding、命令、因果路由与恢复（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-ROUTE-001` |binding从official Workspace/Session live list显式选择 | installed/all |
| `R50-ROUTE-002` |binding有channel/account/peer/workspace/session/version CAS | integration/all |
| `R50-ROUTE-003` |/帮助/项目/新建/状态/取消确定消费且不入模型 | contract+integration/all |
| `R50-ROUTE-004` |/新建调用official DSH并使用official default model | integration/all |
| `R50-ROUTE-005` |vendor message→claim→official Turn→durable final→original route完整 | integration/all |
| `R50-ROUTE-006` |stream/tool中间态、unknown/desktop/other route不外发 | security/all |
| `R50-ROUTE-007` |两渠道/多peer/多Session并发不串线 | concurrency/all |
| `R50-ROUTE-008` |crash在claim/Turn/final/outbox/send/ack每点可恢复 | chaos/all |
| `R50-ROUTE-009` |send前重验authorization/binding/route未消费 | security/all |
| `R50-ROUTE-010` |audit只有opaque ids/digests/state，无正文/真实identity | security/all |

### K. Target closure与发行基础（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-DIST-001` |release contract钉死三个target各自的Electron/Node/DSH/download/hash | contract/all |
| `R50-DIST-002` |每target独立clean staging/cache/manifest，无交叉arch复用 | build/all |
| `R50-DIST-003` |安全解包拒绝zip slip/symlink/case/reserved path | security/all |
| `R50-DIST-004` |DSH/plugin closure从lock/packlist构建，不复制dev node_modules | closure/all |
| `R50-DIST-005` |生产无PATH/repo/global Node/dsh/first-run install fallback | installed/all |
| `R50-DIST-006` |platform layout处理空格/中文/长路径/只读/磁盘满 | fault/all |
| `R50-DIST-007` |target/Electron/Node/process.arch/runtime manifest一致 | installed/all |
| `R50-DIST-008` |Electron main拥有DSH process tree，退出无孤儿 | installed/all |
| `R50-DIST-009` |bundle含integrity/licenses/SBOM/notices/profile、八个first-party plugins及target voice/document engines完整闭包 | artifact/all |
| `R50-DIST-010` |bundle不含fixture/evidence/private key/secret/owner path | artifact+security/all |

### L. macOS Apple Silicon 与 Intel DMG（10 Hard）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-MAC-001` |arm64 app仅含正确arm64 Electron/Node/Mach-O/closure | artifact/mac-arm |
| `R50-MAC-002` |x64 app仅含正确x64 Electron/Node/Mach-O/closure | artifact/mac-x64 |
| `R50-MAC-003` |arm64/x64 app独立构建，不能复制改名或错误同hash | artifact/aggregate |
| `R50-MAC-004` |Info.plist/name/version/bundle id/icon/About正确 | installed/mac-arm+mac-x64 |
| `R50-MAC-005` |真实fuses/hardening从packaged binary验证 | security/mac-arm+mac-x64 |
| `R50-MAC-006` |ad-hoc seal后codesign --verify --deep --strict PASS | signing/mac-arm+mac-x64 |
| `R50-MAC-007` |DMG只读、hdiutil verify、Applications link/layout正确 | artifact/mac-arm+mac-x64 |
| `R50-MAC-008` |挂载DMG后重新验app seal/integrity/target | artifact/mac-arm+mac-x64 |
| `R50-MAC-009` |exact DMG fresh install后完整installed suite PASS | installed/mac-arm+mac-x64 |
| `R50-MAC-010` |x64 final evidence来自Intel native；Rosetta只标translated | installed/mac-x64 |

### M. Windows x64 Setup（10 Hard）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-WIN-001` |Setup由native Windows x64 runner生成且closure为win32-x64 | artifact/win-x64 |
| `R50-WIN-002` |current-user install默认不请求admin | installed/win-x64 |
| `R50-WIN-003` |SimpChinese/English选择、名称/icon/version/publisher声明正确 | installed/win-x64 |
| `R50-WIN-004` |Start Menu/可选desktop/Apps & Features注册正确 | installed/win-x64 |
| `R50-WIN-005` |路径含空格中文、repair/running app/downgrade行为正确 | installed/win-x64 |
| `R50-WIN-006` |Job Object/等价监管确保退出升级卸载无孤儿 | installed/win-x64 |
| `R50-WIN-007` |userData/credentials current-user ACL真实生效 | installed/win-x64 |
| `R50-WIN-008` |junction/reparse/locked file不造成越界或强制删除 | installed/win-x64 |
| `R50-WIN-009` |exact Setup fresh install后完整installed suite PASS | installed/win-x64 |
| `R50-WIN-010` |无Authenticode准确记录，不用minisign冒充OS publisher | artifact/win-x64 |

### N. 0.5 assisted update与回滚（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UPD-001` |0.5只读canonical desktop-v0.5 HTTPS manifest/immutable asset URL | contract/all |
| `R50-UPD-002` |manifest与payload均验独立signature、hash、size | security/all |
| `R50-UPD-003` |platform/arch/minimum/current/source/release identity完整校验 | contract/all |
| `R50-UPD-004` |拒绝downgrade/same-version replay/future schema/wrong key | security/all |
| `R50-UPD-005` |download临时文件不可执行，取消/断线/磁盘满安全 | fault/all |
| `R50-UPD-006` |UI显示版本/notes/size/trust/status并明确用户确认 | installed/all |
| `R50-UPD-007` |安装前drain DSH/IM并建立backup/journal | integration/all |
| `R50-UPD-008` |macOS打开已验DMG、Windows打开已验Setup，无静默绕过 | installed/all |
| `R50-UPD-009` |新版本 post-verify 只要求核心 runtime/profile/required-plugin/DSH 健康；IM 等可选插件保持默认停用也必须 commit。失败则 rollback/recovery；只有真实安装了更高版本才可把旧 `RECOVERY_REQUIRED` 账本纠正为 current，且不得伪造签名升级 ledger | chaos+installed/all |
| `R50-UPD-010` |每个update state crash可重放，inbox/outbox不丢不双发 | chaos/all |
| `R50-UPD-011` |fixture key/server/test payload不进入production artifact | artifact/all |
| `R50-UPD-012` |三个 native target 的 0.5.7→test-next valid/failure suites PASS，且 Apple Silicon 受支持旧版→公开版 0.5.7 实装升级 PASS | installed/all |

### O. 卸载、数据管理与legacy隔离（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-UN-001` |UI按app/cache/settings/DSH/IM/credentials/voice/context/memory/budget/companion/Workspace/legacy分类 | installed/all |
| `R50-UN-002` |0.4.1 detector只读存在/version/size，不开DB/secret | security/all |
| `R50-UN-003` |0.4.1无自动升级/迁移/删除且提示fresh generation | installed/all |
| `R50-UN-004` |默认卸载只删app/shortcut/update cache并保留0.5 state/models/local voices | installed/all |
| `R50-UN-005` |credentials complete-delete需独立二次确认 | installed+security/all |
| `R50-UN-006` |delete plan绑定exact resolved path/type/count/owner/capability | security/all |
| `R50-UN-007` |root/home/drive/symlink/junction/reparse escape全部拒绝 | security/all |
| `R50-UN-008` |Workspace与legacy永不进入delete plan且before/after hash不变 | installed/all |
| `R50-UN-009` |locked/permission/path change立即停，不改权限/扩大重试 | fault/all |
| `R50-UN-010` |默认卸载重装恢复voice/context/memory/budget/companion state与complete delete fresh onboarding均PASS | installed/all |

### P. 可靠性、性能与可访问性（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-REL-001` |DSH/Electron/worker crash有界恢复且不留半profile | chaos/all |
| `R50-REL-002` |port conflict/DB busy/corrupt/disk full/clock jump分类恢复 | fault/all |
| `R50-REL-003` |offline/DNS/TLS/sleep/wake/reconnect无风暴 | chaos+installed/all |
| `R50-REL-004` |Center/onboarding/update/migration journals每点crash可恢复 | chaos/all |
| `R50-REL-005` |retention按类别执行，QR/临时secret/audio/context cache/memory candidate/companion audit及时清理 | security+time/all |
| `R50-REL-006` |键盘/focus/screen reader/error announcement完整 | a11y/all |
| `R50-REL-007` |contrast/200% zoom/reduced motion/QR替代状态通过 | a11y+visual/all |
| `R50-REL-008` |cold/warm startup、DSH ready、idle CPU/memory在预算 | perf/all |
| `R50-REL-009` |queue throughput/backpressure/DB growth在预算 | load/all |
| `R50-REL-010` |exact installed artifact两小时soak无孤儿/泄漏/失联 | soak/all |

### Q. Security、隐私与供应链（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-SEC-001` |contextIsolation/sandbox/no nodeIntegration及CSP真实生效 | security/all |
| `R50-SEC-002` |preload/IPC/Remote capability、schema、origin/window绑定 | security/all |
| `R50-SEC-003` |navigation/window-open/download/permission/devtools fail closed | security/all |
| `R50-SEC-004` |Electron fuses真实写入binary，INCOMPLETE必non-zero | artifact/all |
| `R50-SEC-005` |inbound auth/allowlist/media magic/size/duration/rate/type在ASR/模型前执行 | security/all |
| `R50-SEC-006` |outbound严格route/authorization/idempotency，不广播 | security/all |
| `R50-SEC-007` |repo/app/installers/log/DB/diagnostics/evidence无secret/QR/chat/voice/context filename-content/memory body | secret/all |
| `R50-SEC-008` |redaction覆盖分片/base64/URL/structured/Unicode形式 | security/all |
| `R50-SEC-009` |lock/tarball/download/checksum/provenance/SBOM可重放 | supply-chain/all |
| `R50-SEC-010` |third-party license/notices完整且允许再分发 | license/all |
| `R50-SEC-011` |Critical/High漏洞与风险为0未关闭 | audit/aggregate |
| `R50-SEC-012` |diagnostics export有preview/redaction且不含owner绝对路径 | installed+security/all |

### R. Installed E2E、evidence与release聚合（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-E2E-001` |测试从exact DMG/Setup安装，不用source/staging substitute | installed/all |
| `R50-E2E-002` |观察真实BrowserWindow DOM、HTTP、WS、Remote、process、inventory | installed/all |
| `R50-E2E-003` |通过用户UI完成onboarding/Center/ASR-TTS/Context/Memory/Budget/Companion/IM/update/uninstall | installed/all |
| `R50-E2E-004` |读取源码/grep字符串/test endpoint不能产生installed PASS | anti-cheat/all |
| `R50-E2E-005` |runner result逐assertion归因，无hardcoded PASS扇出 | evidence/all |
| `R50-E2E-006` |evidence完整绑定source/export/target/artifact/native/result digest | evidence/all |
| `R50-E2E-007` |missing/duplicate/stale/unknown/translated-as-native均拒绝 | evidence/all |
| `R50-E2E-008` |verify:release传播全部适用hard gates与退出码 | aggregator/all |
| `R50-E2E-009` |三个安装包exact-set/version/source/export/trust一致 | artifact/aggregate |
| `R50-E2E-010` |freeze后任一byte/input变化使manifest/evidence stale | fault/aggregate |

### S. Public-export与公开准备（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-PREP-001` |public-export由allowlist deterministic生成且有tree hash | export/aggregate |
| `R50-PREP-002` |export无private docs/raw evidence/secret/key/owner path/artifact cache | export+secret/aggregate |
| `R50-PREP-003` |export manifest列path/mode/size/hash/license classification | export/aggregate |
| `R50-PREP-004` |clean temp export能lock-only install/build/test/package preflight | clean-room/aggregate |
| `R50-PREP-005` |MIT LICENSE/README/SECURITY/CONTRIBUTING完整准确 | docs/aggregate |
| `R50-PREP-006` |public source含build/test/overlay/provenance，不只给binary | export/aggregate |
| `R50-PREP-007` |release notes明确0.4 fresh install、IM voice/ASR-TTS/Context/Memory/Budget/Companion范围限制、trust、upgrade/uninstall | docs/aggregate |
| `R50-PREP-008` |PUBLICATION_MANIFEST列exact assets/evidence/limitations | manifest/aggregate |
| `R50-PREP-009` |公开Release资产与已验收bytes同一性的未来门已机器化 | contract/aggregate |
| `R50-PREP-010` |public commit/tag/release/channel未执行且无外部上传 | audit/aggregate |

### T. 最终真实账户、语音与原生优势 live（16）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R50-LIVE-001` |exact installed arm64 app经UI保存真实BYOK descriptor | live/live |
| `R50-LIVE-002` |真实provider API test、Workspace、official Turn/final成功 | live/live |
| `R50-LIVE-003` |真实微信QR全状态确认且扫码者owner allowlist成立 | live/live |
| `R50-LIVE-004` |真实微信私聊→Turn→final→原路回复且restart恢复 | live/live |
| `R50-LIVE-005` |真实飞书App doctor/权限/发布/official SDK连接成功 | live/live |
| `R50-LIVE-006` |真实飞书私聊→Turn→final→原路回复且restart恢复 | live/live |
| `R50-LIVE-007` |微信/飞书logout后credential/worker/socket按合同清理 | live/live |
| `R50-LIVE-008` |live evidence仅nonce/file/audio digest、counts、opaque ids/time/version/route，无secret/body/QR/context filename/memory text | secret/live |
| `R50-LIVE-009` |exact arm64 UI麦克风录音→SenseVoice草稿→用户确认→official Turn成功 | live/live |
| `R50-LIVE-010` |exact arm64真实MOSS可听播放且MOSS→SenseVoice本地回环达到固定门 | live/live |
| `R50-LIVE-011` |真实微信voice→ASR→Turn→可见TTS audio，native bubble/fallback声明与实测一致 | live/live |
| `R50-LIVE-012` |真实飞书audio→ASR→Turn→official native audio reply且restart恢复 | live/live |
| `R50-LIVE-013` |用户在exact app授权测试资料目录，current/stale/revoked来源卡准确且源文件hash不变 | live/live |
| `R50-LIVE-014` |global/Workspace memory候选经Owner确认、重启后scope正确，SOP复用official Skills | live/live |
| `R50-LIVE-015` |真实provider用量进入official TokenMeter/budget，desktop与IM执行同一warn/block门 | live/live |
| `R50-LIVE-016` |Companion按一次真实调度向授权渠道发送text/voice，quiet-hours/disable后无额外消息 | live/live |

### U. SenseVoice ASR、MOSS-TTS 与 channel voice（16）

| ID | Hard assertion | runner/platform |
| --- | --- | --- |
| `R50-VOICE-001` |`@penglai/asr` 是真实DSH host/client plugin与typed service，无第二Agent/UI | architecture+installed/all |
| `R50-VOICE-002` |`@penglai/moss-tts` 是真实DSH host/client plugin与typed service，无第二Agent/UI | architecture+installed/all |
| `R50-VOICE-003` |Center actual inventory/health区分plugin active、model not-installed/ready/failed | integration+installed/all |
| `R50-VOICE-004` |SenseVoice/MOSS/codec模型有immutable revision、size、SHA、license、atomic resume/import/delete | supply-chain+fault/all |
| `R50-VOICE-005` |三个target含各自正确sherpa/ORT/SILK/Opus closure，无PATH/Python/system ffmpeg/first-run install | artifact+installed/all |
| `R50-VOICE-006` |DSH mic只在user gesture授权，支持record/pause/cancel/transcribe/edit-confirm且权限按origin隔离 | installed+security/all |
| `R50-VOICE-007` |ASR按magic/codec/size/duration解码，输出text/language/emotion/no-speech并有界清理 | integration+security/all |
| `R50-VOICE-008` |audio attachment复用official DSH seam，转写确认后才进入official Turn | integration+installed/all |
| `R50-VOICE-009` |真实MOSS ONNX prefill/decode/local decoder/codec输出48k stereo可听波形，无fake/system TTS | engine/native-all |
| `R50-VOICE-010` |MOSS内置声音、long text、stream/play/pause/stop/cancel/export与Session设置完整 | installed+perf/all |
| `R50-VOICE-011` |local voice reference仅用户显式许可创建，app-private保存并可独立列出/删除/失效 | security+installed/all |
| `R50-VOICE-012` |opaque AudioHandle、raw/transcript/TTS/reference retention与logs/evidence redaction符合合同 | security+time/all |
| `R50-VOICE-013` |IM text/voice/text+voice/mirror策略和语音命令持久、确定消费、失败text fallback | contract+integration/all |
| `R50-VOICE-014` |微信encrypted SILK入站→ASR；TTS可见audio可靠送原target，native bubble只凭live capability | integration+installed/all |
| `R50-VOICE-015` |飞书message resource audio→ASR；MOSS→Opus upload→`msg_type=audio`原target | integration+installed/all |
| `R50-VOICE-016` |download/inference/playback/upload在crash/sleep/update/disable/logout/uninstall后可恢复且资源为零 | chaos+installed/all |

### V. 蓬莱记忆、授权资料与分层 Memory（16）

| ID | Hard assertion | runner/platform |
| --- | --- | --- |
| `R50-CTXMEM-001` |`@penglai/memory`是唯一用户与loader可见的记忆插件；授权资料索引、来源卡、分层记忆与图谱均编译进同一host/client包，旧`@penglai/context`只迁移且不进入fresh profile/inventory | architecture+installed/all |
| `R50-CTXMEM-002` |Memory资料授权只能由用户UI显式选择global/Workspace realpath，拒绝symlink/junction/reparse/敏感根 | security+installed/all |
| `R50-CTXMEM-003` |本地文本/Markdown/PDF/DOCX/XLSX/PPTX有界提取，不执行宏/外链/active content | integration+security/all |
| `R50-CTXMEM-004` |SQLite FTS5索引可增量/重建/暂停/恢复，crash/lock/corrupt/disk-full不污染active index | integration+chaos/all |
| `R50-CTXMEM-005` |Agent只经`@penglai/memory`注册的official DSH typed source search/read tool取资料，内容明确为不可信context | contract+integration/all |
| `R50-CTXMEM-006` |来源卡由host验证文件/节页sheet/digest/index revision与current/stale/revoked/unavailable | integration+installed/all |
| `R50-CTXMEM-007` |文件变化/移动/删除后citation状态准确更新，模型声明不能覆盖host事实 | fault+installed/all |
| `R50-CTXMEM-008` |revoke/delete只移除grant/派生index/cache，原始目录/文件before-after hash不变 | security+installed/all |
| `R50-CTXMEM-009` |Memory global L1、Workspace、session candidates严格分层，floating/多Workspace不串 | integration+concurrency/all |
| `R50-CTXMEM-010` |L1有行/字节上限和可见编辑；memory注入不提升system/tool/approval权限 | security+load/all |
| `R50-CTXMEM-011` |模型不能直接写global/SOP；长期写入有来源、敏感检查、可见diff与Owner明确确认 | security+installed/all |
| `R50-CTXMEM-012` |SOP/Skill沉淀复用official DSH Skill registry/receipt，无第二Skill store或重复loader | architecture+integration/all |
| `R50-CTXMEM-013` |IM文字/语音进入bound official Turn后使用同一Context/Memory scope，adapter不直接检索/注入 | integration+security/all |
| `R50-CTXMEM-014` |Context/Memory settings、index/schema/candidates可迁移/导出/分项删除且不含未授权正文 | migration+security/all |
| `R50-CTXMEM-015` |disable/update/uninstall停止indexer/distiller/Remote/DB，resource-zero且外部sources永不删除 | chaos+installed/all |
| `R50-CTXMEM-016` |三个exact installed target完成grant→index→query→citation→revoke及memory scope/consent/restart suite | installed/all |

### W. 用量与预算（6）

| ID | Hard assertion | runner/platform |
| --- | --- | --- |
| `R50-BUDGET-001` |`@penglai/budget`是真实DSH plugin，唯一计量源为official TokenMeter/model route，无平行LLM gateway | architecture+installed/all |
| `R50-BUDGET-002` |global/Workspace/provider/model日token/费用ledger持久、scope正确、使用实际usage而非正文估算 | integration/all |
| `R50-BUDGET-003` |80% warn、100%阻止新official Turn、Owner lift/reset语义明确，desktop与IM一致 | integration+installed/all |
| `R50-BUDGET-004` |无可信价格只显示token；价格revision/币种/自定义来源可见，不伪造费用准确性 | contract+content/all |
| `R50-BUDGET-005` |并发Turn、重启、时区/午夜/clock rollback、失败/取消usage不能绕过或双计 | concurrency+chaos/all |
| `R50-BUDGET-006` |disable/update/uninstall与data export/delete安全，ledger/UI/evidence无prompt/response正文 | security+installed/all |

### X. 主动陪伴（8）

| ID | Hard assertion | runner/platform |
| --- | --- | --- |
| `R50-COMP-001` |`@penglai/companion`是真实DSH plugin且fresh product state disabled，无默认schedule/外发 | architecture+installed/all |
| `R50-COMP-002` |启用需显式选择channel/binding/Workspace/Session/intensity/daily cap/quiet-hours/text-voice/signals | security+installed/all |
| `R50-COMP-003` |trigger复用official Schedule，生成复用dedicated official DSH Session/Turn，不伪造inbound用户消息 | architecture+integration/all |
| `R50-COMP-004` |Companion固定plan/no-unattended-tools权限，不能自行shell/审批/新目录/群聊/扩大allowlist | security/all |
| `R50-COMP-005` |ASR emotion仅用户opt-in且不保存原文；quiet-hours/budget/rate/recent-stop优先于trigger | security+time/all |
| `R50-COMP-006` |text/voice只经@penglai/im typed outbound和exact authorized route；TTS失败只降级一次文本 | integration/all |
| `R50-COMP-007` |trigger claim/Turn/outbox/delivery durable，sleep/wake/restart/clock jump不重复，disable/logout资源为零 | chaos+installed/all |
| `R50-COMP-008` |三个exact installed target完成virtual-clock text/voice/quiet-hours/disable suite，live只留opaque trigger证据 | installed+live/all |

### R55. 0.5.5 产品增量（作为 0.5.7 基础继续执行）

#### Truth / DSH（8）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R55-TRUTH-001` | all product/package/release versions exact current 0.5.7 | contract/all |
| `R55-TRUTH-002` | DSH exact rc.2 commit/integrity/shasum | contract/all |
| `R55-TRUTH-003` | only three exact target installers | contract/all |
| `R55-TRUTH-004` | no package/tag/release drift from the current release contract | contract/all |
| `R55-DSH-001` | official Web/Agent/Session/Workspace unchanged | architecture/all |
| `R55-DSH-002` | official attachment/settings/slot seams used | contract/all |
| `R55-DSH-003` | no parallel model/provider/chat runtime | architecture/all |
| `R55-DSH-004` | Office/Memory failure does not block DSH | integration/all |

#### Builtin lifecycle（12）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R55-BUILTIN-001` | fresh profile loads Office+Memory | profile/all |
| `R55-BUILTIN-002` | actual inventory, not desired, drives UI | unit/all |
| `R55-BUILTIN-003` | baseline repair works offline | unit/all |
| `R55-BUILTIN-004` | signed overlay priority and identity | unit/all |
| `R55-BUILTIN-005` | overlay failure returns last-good/baseline | unit/all |
| `R55-BUILTIN-006` | Office disable preserves documents | unit/all |
| `R55-BUILTIN-007` | Memory disable preserves data and stops recall | unit/all |
| `R55-BUILTIN-008` | enable/restart persistence | integration/all |
| `R55-BUILTIN-009` | delete resource differs from disable | unit/all |
| `R55-BUILTIN-010` | complete-delete has preview/export/confirm | unit/all |
| `R55-BUILTIN-011` | no orphan resource after lifecycle operations | unit/all |
| `R55-BUILTIN-012` | DSH core remains usable in every state | integration/all |

#### Memory（20）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R55-MEM-001` | explicit remember writes active personal memory | unit/all |
| `R55-MEM-002` | candidate inferred memory is not auto-injected | unit/all |
| `R55-MEM-003` | correction supersedes old active facts | unit/all |
| `R55-MEM-004` | why() returns source locator | unit/all |
| `R55-MEM-005` | forget removes indexes and recall | unit/all |
| `R55-MEM-006` | secrets are refused | unit/all |
| `R55-MEM-007` | personal store is physically separate | unit/all |
| `R55-MEM-008` | workspace A facts are absent from workspace B default search | unit/all |
| `R55-MEM-009` | same basename directories do not collide | unit/all |
| `R55-MEM-010` | all-projects graph is read-only and not a recall source | unit/all |
| `R55-MEM-011` | runtime prompt budget is bounded | unit/all |
| `R55-MEM-012` | engine crash fails open for DSH chat | unit/all |
| `R55-MEM-013` | AutoPrune is off by default | unit/all |
| `R55-MEM-014` | read-only is host-enforced | unit/all |
| `R55-MEM-015` | markdown/json export-import preserves scope | unit/all |
| `R55-MEM-016` | legacy 0.5.3 memory/context migrates with preview | unit/all |
| `R55-MEM-017` | 100k-scale query remains bounded | unit/all |
| `R55-MEM-018` | three native Mnemon binaries are identity-pinned | artifact/all |
| `R55-MEM-019` | disable then resource-zero | unit/all |
| `R55-MEM-020` | installed UI shows Penglai Memory | installed/all |

#### Office（24）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R55-OFFICE-001` | DOCX inspect | unit/all |
| `R55-OFFICE-002` | DOCX create | unit/all |
| `R55-OFFICE-003` | DOCX partial edit | unit/all |
| `R55-OFFICE-004` | DOCX verify | unit/all |
| `R55-OFFICE-005` | XLSX inspect | unit/all |
| `R55-OFFICE-006` | XLSX create | unit/all |
| `R55-OFFICE-007` | XLSX partial edit | unit/all |
| `R55-OFFICE-008` | XLSX verify | unit/all |
| `R55-OFFICE-009` | PPTX inspect | unit/all |
| `R55-OFFICE-010` | PPTX create | unit/all |
| `R55-OFFICE-011` | PPTX partial edit | unit/all |
| `R55-OFFICE-012` | PPTX verify | unit/all |
| `R55-OFFICE-013` | PDF inspect | unit/all |
| `R55-OFFICE-014` | PDF create | unit/all |
| `R55-OFFICE-015` | PDF partial edit | unit/all |
| `R55-OFFICE-016` | PDF verify | unit/all |
| `R55-OFFICE-017` | attachment authorization | unit/all |
| `R55-OFFICE-018` | workspace isolation | unit/all |
| `R55-OFFICE-019` | TOCTOU reject | unit/all |
| `R55-OFFICE-020` | malicious documents fail closed | unit/all |
| `R55-OFFICE-021` | templates and OFL fonts only | unit/all |
| `R55-OFFICE-022` | preview then owner approval | unit/all |
| `R55-OFFICE-023` | atomic commit/undo | unit/all |
| `R55-OFFICE-024` | IM file return path | unit/all |

#### Community（10）

| ID | 要求 | Runner |
| --- | --- | --- |
| `R55-COMM-001` | exact provenance lock | contract/all |
| `R55-COMM-002` | distributable license | contract/all |
| `R55-COMM-003` | no install scripts | contract/all |
| `R55-COMM-004` | permission prompt | unit/all |
| `R55-COMM-005` | network allowlist | unit/all |
| `R55-COMM-006` | rc.2 dry-load | unit/all |
| `R55-COMM-007` | actual inventory | unit/all |
| `R55-COMM-008` | rollback | unit/all |
| `R55-COMM-009` | uninstall resource-zero | unit/all |
| `R55-COMM-010` | quarantine exclusion | unit/all |

## 4. Codex 独立验收动作

实现者写`READY_FOR_CODEX_0_5_1_ACCEPTANCE`后，Codex不相信SELF-CHECK，至少执行：

1. 检查private clean main、origin、source/export/release manifest与三个exact installer hash。
2. 分别在Apple Silicon、Intel Mac、Windows x64原生runner从exact installer重装并核对target。
3. 通过真实UI重跑fresh onboarding、DSH parity、Center、IM mock/fixture、update、uninstall。
4. 重跑format/type/unit/contract/integration/security/chaos/soak/closure/profile/artifact/fuses/signing/evidence/release。
5. 随机抽查每组evidence到原始assertion/JUnit/trace，查是否扇出或读源码作弊。
6. 审查微信/飞书vendor reply target、cursor/dedupe、supervisor、logout、causal route源码。
7. 审查update signature/anti-rollback/journal与delete boundary/junction防护。
8. 重生public-export并比tree hash；检查license/secret/owner path/公开文案。
9. 核对community trust陈述，不要求或伪造notary。
10. 发布前确认公开写入有 Owner 授权；发布后核对 public commit/tag/Release/assets 与 exact source/export/三个installer一致。

## 5. 一票否决

- 主界面不是official DSH Web，或出现第二Agent/session/model/chat runtime。
- production依赖PATH、系统Node、repo、首次联网安装或test endpoint。
- renderer能读secret，或secret/QR/body/真实identity进入artifact/log/evidence。
- Center desired冒充loader actual，或IM worker没有真实运行。
- 微信/飞书用hashed peerRef发送、绕过统一route、按活跃Session猜测。
- 飞书用假二维码或用户 Device Flow 冒充一键扫码，或微信扫码只做静态 UI / 把 iLink URL 当图片。
- 0.4.1数据被自动读取迁移或删除。
- updater不验独立签名、允许回退/可变URL，或无Developer ID却声称silent auto-update。
- uninstaller可能递归Workspace/root/home/legacy/symlink/junction/reparse target。
- 任一平台使用cross/translated/emulated结果冒充native，或Release缺少/多出未验收的三端安装包。
- verifier INCOMPLETE却exit 0、Hard ID硬编码PASS、旧SHA/evidence复用。
- ad-hoc候选被称为已公证、Developer ID或系统信任。
- 未经 Owner 明确授权修改开源仓库或发布；0.5.7 已获授权，但任一必需门禁失败仍一票否决。
