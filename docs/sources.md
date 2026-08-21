# 上游来源与固定版本

> 核对时间：2026-08-20。实现必须以 lockfile、下载 integrity 和本地可运行 probe 再验证；本文不是跳过现场检查的理由。

## 1. DeepSeek Harness

- official repo：[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
- 核对 commit：`141eb6fef83422698aef7a981029e843e8161534`（tag `dsh-v0.1.0-rc.8`，2026-08-19）。
- npm：`@deepseek-ai/dsh@0.1.0-rc.8`；现场 dist-tags 为 `latest=0.1.0-rc.7`、`next=0.1.0-rc.8`，不能把 rc.8 叙述为 stable。
- npm integrity：`sha512-VQU5NlomrKLRgcXuOf+sxWFvqxPA8q9vMhrKPlPPXiOJEhGlGlAdiyxZvZxkCVI+v0zbhe21cY3/luLyxpSzzA==`。
- 历史 pin：rc.6 见 ADR 0006，rc.7 见 ADR 0029；当前产品 pin 以 ADR 0031 与 `docs/compatibility/DSH_010_RC8.md` 为准。

本地 installed packages 已核对：

- `dsh-client-locale`：zh/en preference 持久到 `$DSH_HOME/settings.yaml`，fresh browser 可从 navigator 选择，fallback zh。
- `dsh-client-ui-settings-general`：`settings.onboarding` 有序 ledger，每次挂载一个 step；registrant 自持 completion。
- `dsh-client-ui-settings-models`：Models settings、dynamic providers、write-only `credentials.set`、model discovery、official onboarding。
- `dsh-client-ui-settings`：`settings.section`、`settings.plugins.tab`、`settings.onboarding` 等 slots。
- `dsh-client-web`：HTML title 是可配置 product suffix，Session title 在其前投影。
- `dsh-client-ui-sidebar`：rc.8 声明 official `sidebar.brand.mark` / `sidebar.brand.name` single slots。
- `dsh-client-ui-conversation`：rc.8 声明 official `conversation.hero.brand.mark` single slot。
- `dsh-client-ui-primitives`：OnboardingSurface、Modal、Button、Input、StateDot 等可复用组件。
- `dsh-host-plugin-inventory`：loader actual inventory 参考。
- Typert：host `TypertRemoteService`/`@Remote`，client mount generated `TYPERT_REMOTE`。
- `dsh-credentials-local`：app-private `.credentials.yaml`、permission/atomic file 语义。

结论：Penglai 通过 official locale/Models/settings/Remote 与 rc.8 brand slots 完成主要 composition；无 slot 的 document title、首次披露与 hero copy/background 仅使用 exact-version、exact-hash UI-only overlay，不能 fork runtime。当前审计见 `docs/compatibility/DSH_010_RC8.md`；rc.7 文档只保留历史过程。

## 2. 腾讯微信 iLink

- official repo：[Tencent/openclaw-weixin](https://github.com/Tencent/openclaw-weixin)
- 核对 commit：`cef0bfc390393f716903e16d50408118047f87e0`。
- package：`@tencent-weixin/openclaw-weixin@2.4.6`，MIT，Node >=22。

核对源码域：`src/auth/login-qr.ts`、`src/monitor/monitor.ts`、`src/api/api.ts`、`src/storage/sync-buf.ts`、`src/messaging/send.ts`、context-token store。

固定行为：

- QR POST 到 `ilinkai.weixin.qq.com` 的 `get_bot_qrcode?bot_type=3`。
- active QR 约 5 分钟；status long poll timeout 35 秒。
- 状态包含 wait、scaned、confirmed、expired、redirect、verify/blocked。
- confirmed 返回 token、bot id、base URL、scanner identity 等；redirect/base 必须应用。
- getUpdates 使用持久 cursor；send 使用 original context/route。
- `X-WECHAT-UIN` 每请求为 base64 random uint32。

Penglai 只复用/对照协议行为与许可归属，不引入 OpenClaw runtime/peer。

## 3. 飞书/Lark

- official Node SDK：[larksuite/node-sdk](https://github.com/larksuite/node-sdk)
- 核对 commit：`f54b49f3566c52b54c598194b7ed3015e3e24224`。
- npm：`@larksuiteoapi/node-sdk@1.73.0`，MIT。
- official app type：[应用类型介绍](https://open.feishu.cn/document/home/app-types-introduction/overview)
- official bot setup：[使用长连接构建机器人](https://open.feishu.cn/document/develop-an-echo-bot/faq?lang=zh-CN)

固定行为：

- basic bot client 使用 App ID/App Secret。
- receive 使用 `WSClient` + `EventDispatcher`，订阅 `im.message.receive_v1`。
- long connection 不要求公网 webhook；事件应在约 3 秒内处理/返回，否则可能重复推送。
- 企业自建应用需启用 bot、最小 message permissions、事件订阅、创建/发布版本，可能需要管理员审核。
- send/reply 使用 official Client。

参考 repo [larksuite/openclaw-lark](https://github.com/larksuite/openclaw-lark) commit `dde0be3680d6fd5443cab426c8f4b3216266346a` 仅用于核对 Device Flow：它仍以 App ID/App Secret 做 confidential client authentication，因此不能消除应用配置。本版基础 bot 不使用 Device Flow，也不安装 OpenClaw runtime。

## 4. Electron、安装包与升级

- Electron发行总览：[Distribution Overview](https://www.electronjs.org/docs/latest/tutorial/distribution-overview)
- Electron应用打包：[Application Packaging](https://www.electronjs.org/docs/latest/tutorial/application-distribution/)
- Electron官方打包教程：[Packaging Your Application](https://www.electronjs.org/docs/latest/tutorial/tutorial-packaging)
- Electron更新指南：[Updating Applications](https://www.electronjs.org/docs/latest/tutorial/updates)
- Electron `autoUpdater`：[autoUpdater API](https://www.electronjs.org/docs/latest/api/auto-updater/)
- Electron security：[Security tutorial](https://www.electronjs.org/docs/latest/tutorial/security)
- Electron Forge DMG maker：[DMG](https://www.electronforge.io/config/makers/dmg)
- Electron Forge Squirrel.Windows：[Squirrel.Windows](https://www.electronforge.io/config/makers/squirrel.windows)
- Apple code signing/notarization：[Notarizing macOS software before distribution](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)

Electron官方说明macOS `autoUpdater`基于Squirrel.Mac且要求app签名。**本项目推论**：当前只有ad-hoc seal，没有稳定Developer ID publisher identity，也没有在quarantine/替换/回滚场景证明Squirrel.Mac兼容，因此0.5 community trust不能诚实承诺silent auto-update。正确产品路径是应用内signed manifest/download/verify + 用户确认打开原生DMG/Setup + migration journal；未来有OS publisher credentials后再做autoUpdater候选。

Forge是Electron官方教程推荐的统一打包方向，但具体DMG/Windows maker与当前DSH closure是否合适仍须RC1本地probe和ADR，不能只凭文档决定。DMG必须在macOS构建；Windows final Setup与installed evidence必须来自native Windows x64。

## 4.1 MOSS-TTS-Nano 本地语音闭包

- 算法/source pin：`OpenMOSS/MOSS-TTS-Nano@cc7bdf19c7639c0870dab22045a33b442760f6be`，Apache-2.0。
- Node runtime pin：`OpenMOSS/MOSS-TTS-Nano-Reader@c3b2333b88e0f062ca49d403540a169609354d93`，再将浏览器 `file:` fetch 收敛为 verified-root-confined `node:fs` 本地读取（允许 official manifest 指向根内 sibling codec）；最终 Penglai adapter SHA-256 `b49d214bbe9ba9849d48e1588c66a70173eee76c211bb4f473b5eadf7bce038c`。
- TTS weights：`OpenMOSS-Team/MOSS-TTS-Nano-100M-ONNX@f52645cb467506d8e18e746ddd59482685b74e58`。
- codec weights：`OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX@ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae`。
- 16-file bundle identity：`cd877ae87fed8f9d26c237c5038242e796e51389`；每文件 size/SHA-256 在 `@penglai/moss-tts` manifest 与 SBOM 双重冻结。
- CPU graph runtime：`onnxruntime-node@1.23.2`，integrity `sha512-OBTsG0W8ddBVOeVVVychpVBS87A9YV5sa2hJ6lc025T97Le+J4v++PwSC4XFs1C62SWyNdof0Mh4KvnZgtt4aw==`。这是 npm 最后一个同时携带 macOS arm64、macOS x64 与 Windows x64 N-API v6 二进制的冻结版本；三端插件打包门禁会逐一验证目标文件格式。
- tokenizer runtime：`sentencepiece-js@1.1.0`，integrity `sha512-HN6teKCRO9tz37zbaNI3i+vMZ/JRWDt6kmZ7OVpzQv1jZHyYNmf5tE7CFpIYN86+y9TLB0cuscMdA3OHhT/MhQ==`。
- Weixin SILK runtime：[`silk-wasm@3.7.1`](https://github.com/idranme/silk-wasm)，MIT，integrity `sha512-mXPwLRtZxrYV3TZx41jMAeKc80wvmyrcXIcs8HctFxK15Ahz2OJQENYhNgEPeCEOdI6Mbx1NxQsqxzwc3DKerw==`，独立 WASM 随 IM plugin 闭包。
- Feishu Opus runtime：[`libopus-wasm@0.2.0`](https://github.com/openclaw/libopus-wasm/tree/55fe0b6faf9043518b7e1a7ea32e74659ecfbae7)，MIT，commit `55fe0b6faf9043518b7e1a7ea32e74659ecfbae7`，integrity `sha512-x/2Gu1/C6L3IICY09zyfp984AWiOYjn53u4WfdY3yh+3KTzMN8Xkm77q3lenWMVIk5SnSzjGEkQT+VQMFHLBHQ==`，libopus 1.6.1 WASM 内嵌且无安装脚本。
- 权重仅在用户明确操作后按需下载；runtime/target-native binary/NOTICE 随安装包，禁止 postinstall 或首次启动联网补二进制。

## 5. PenglaiAgent 0.4.1 发行参考

- public repo：[kevinchennewbee/PenglaiAgent](https://github.com/kevinchennewbee/PenglaiAgent)
- tag：`v0.4.1`，commit `4f24d0bb84c385ed474e70cfdf89db32b4c49f33`
- release：[PenglaiAgent v0.4.1](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.4.1)

已核实0.4.1固定三target：darwin-aarch64、darwin-x86_64、windows-x86_64；用户安装包是两DMG和一个Windows Setup，另有updater signatures/latest.json/SBOM/SHA256SUMS/notices。它用Tauri、ad-hoc macOS/no notarization、no Windows Authenticode，并用minisign保护updater/asset完整性。

0.5只复用它的三平台资产命名、exact-set、独立签名和诚实trust文案；不复用Tauri Host/runtime。用户已明确0.4.1不能升级到0.5.0可以接受，所以不做bridge或数据迁移。

## 6. 依赖与证据规则

- 每个 pin 记录 version、source commit/tag、integrity/checksum、license、Node/ABI/platform。
- README 不能替代 compile/run probe；SDK/DSH seam 必须在隔离 DSH_HOME 与 mock server 运行。
- GitHub Actions当前quota unavailable；本机/VM/self-hosted runner保存command/exit/environment/source/export/artifact fingerprint。
- Rosetta/Windows ARM x64模拟只算预验；final Intel/Windows x64 evidence必须native。
- 私有 artifact 不对外上传，不创建 public release。

## 6.1 0.4.1 原生优势与 current DSH capability 归属

- `PenglaiAgent` tag `v0.4.1` / commit `4f24d0bb84c385ed474e70cfdf89db32b4c49f33` 的 README 与源码已现场核对。
- 真实差异化源码包括：`packages/host/src/voice/*`、`packages/host/src/context/*`、`packages/host/src/memory.ts`、`packages/host/src/distill/*`、`packages/host/src/budget.ts`、`packages/host/src/services.ts`及对应context/budget/memory/distill/quiet-hours tests。迁移矩阵见`docs/compatibility/PENGLAI_041_PARITY_R3.md`。
- 当前 `@deepseek-ai/dsh@0.1.0-rc.8` 依赖闭包已现场确认含 Goal、Plan、Todo、Skill/Skill filesystem/client UI、MCP client、Web、Attachment、Schedule、TokenMeter、Workspace、Session 与 presentation。
- 因此Goal/Todo/Skills/MCP/Web/Attachments/Schedule/TokenMeter归official DSH复用；Voice/Context/Memory/Budget/Companion迁为Penglai plugins。package name存在不是最终seam证据，Grok仍须用actual profile/inventory/Service/Slot probe确认。
- 0.4.1 source只作算法、数据合同、测试与许可证参考；不得打包旧Tauri/Host/EpisodeRunner、读取旧用户数据或建立第二核心。
