# 蓬莱 Penglai 0.4.0 — GitHub Release notes 草稿

> Owner 审核稿：本地候选尚未推送、打标签或发布。

蓬莱 0.4.0 是新的 TypeScript Host + Pi AgentKernel + Tauri 2 Desktop 产品线。它不再使用“双模式”叙事：只有一个助理、一个执行核心与一份本地事实。Owner 把会话锚定到项目时，改变的是目录与权限边界，不是能力集合。

## 0.3.x 特色能力继续存在

- **SenseVoice ASR**：桌面可直接录音，本地识别中文语音并保留情绪/语言标签；CLI 继续支持 `penglai chat --voice`。
- **MOSS-TTS-Nano**：完整 ONNX CPU 管线，包括 TTS prefill/decode、local decoder 与 audio codec；桌面可朗读任意助理回复。
- **主动陪伴**：默认关闭、Owner 明确启用，可选安静/在场/主动强度，自动遵守 22:00–08:00 勿扰；晨间、晚间、空闲与已观察到的负面情绪机会都进入同一 EpisodeRunner，以 `plan` 权限生成，不伪造用户消息、不执行无人值守工具。

语音模型按需下载到本机，不随 DMG 重复分发，也不构成 Host 启动硬依赖。模型或原生引擎缺失时如实降级为纯文本。

## 新的统一核心

- Desktop、CLI、Goal、飞书、微信与持久 Task 全部走 `EpisodeRunner → Pi AgentKernel`。
- TaskRunner 专注 Run / Step / Evidence / checkpoint 的持久生命周期，不再拥有第二套模型循环。
- Conversation / Goal / Project / Task / Run / Evidence、审批、预算、记忆和渠道路由都以本地 Host SQLite 为真相源。
- 文件 diff、写后磁盘重读、命令退出态、审批、token 用量与 Pi 会话 checkpoint 形成可独立核对的证据轨。

## 常用工作能力

- Pi 的 `read / write / edit / bash` 继续作为小而通用的原子工具面，覆盖代码、Git、压缩、日志、构建、测试与进程检查，不为每类任务增加专用卡片或按钮。
- `document_read` 可提取 PDF、DOCX、XLSX、PPTX 与常用文本；`document_create` / `document_create_pdf` 可生成真实 PDF、DOCX、XLSX 与 PPTX，并拒绝覆盖已有文件。桌面可把 Owner 选择的普通文档复制进会话 inbox；证据轨对常用文档和代码提供 Host 围栏后的应用内只读文本预览，也可用系统应用打开或在 Finder 定位。
- `web_search` / `web_fetch` 返回真实公网结果与最终 URL；每次调用均进入 Owner L3，限制重定向、响应体和内容类型，并拒绝 localhost、私网、云元数据与其他保留地址。
- Agent Skill 可从本地或 GitHub 安装、验哈希、查看、启停和卸载；不执行 npm installer、生命周期钩子或任意 Pi TypeScript extension。
- MCP 支持 stdio / HTTP / SSE 配置、手动连接、工具预览和断开；Host 启动不自动连接，stdio 使用私有 HOME，远程传输逐跳防 SSRF，每次工具调用都强制 Owner L3。browser/CUA 不内置，可由 Owner 后续选择可信浏览器 MCP。
- 助理回复支持安全 Markdown/GFM、表格、代码复制和安全公网页链接；远程图片默认阻止。全部会话可搜索、重命名、归档/恢复，后台完成时发送系统通知。
- Desktop Doctor 和 `penglai doctor --export` 可生成本地脱敏诊断 ZIP：只包含版本/运行时元数据、Doctor 结果和有界近期文本日志；明确不遍历 token、模型档案、数据库、会话、记忆、Skill 或 MCP 配置。

## 安全边界

- loopback + 本地 token；模型密钥与 Host token 不进入 renderer。
- realpath 项目围栏、凭证路径硬拒绝、L3 外发/推送/删除每次人工、L4 越界直接拒绝。
- scheduler、autonomous 和任意 Pi extension/hooks 不挂载。MCP 只有 Owner 手动连接后才进入工具面，且每次调用都重新 L3。
- 进程内 policy/jail 是纵深防线，不是 OS sandbox；不要用它执行任意不可信代码。

## 从 0.3.x 升级

0.3.6 Python 产品线继续保留在 `v0.3.6`。0.4.0 是手工跨代升级，不使用 0.3 updater 自动切换。请先备份整个 `~/.penglai/`，然后运行：

```bash
penglai migrate --dry-run
penglai migrate
```

迁移覆盖模型档案、飞书配置/白名单、L1 记忆与通过审计的 SOP；每次写入先做可回滚快照。

## 本地候选验收

- 全量：71 个 TypeScript 测试文件、859 项测试通过；421 项 Python 回归测试通过；17 条生产路径 eval 回放通过。旧 `ChatRunner` 与 24 项死代码测试已删除，生产执行只剩 EpisodeRunner → Pi 一条路径。
- 文档与网页：真实生成并回读中文 PDF；DOCX / XLSX / PPTX 均由 LibreOffice 26.2.4.2 实际打开并转成 PDF 目检；路径/符号链接越界、网页 SSRF/重定向、真实公网页面搜索与抓取均通过。
- 生态：公开 GitHub PDF Skill 经桌面真实安装、哈希收据、查看和启用；本地 stdio MCP 完成握手、工具发现与调用，且验证私有 HOME；HTTP/SSE 边界由自动化覆盖。
- 契约：23 个协议错误码一致；84 个 Desktop RPC 调用均由 Rust allowlist 允许且由 Host 实现；renderer 构建产物不含 Host token 处理。
- 语音：使用本机真实模型权重完成 MOSS 中文合成 → SenseVoice 中文识别回环。
- 官网：中英文桌面页面与 390px 移动布局完成浏览器验收，无脚本错误或横向溢出。
- 安全与依赖：Host token 不再进入 URL；token/档案文件强制当前用户、普通文件与 0600；公网模型端点强制 HTTPS；文档、网页和 MCP 输出按不可信数据隔离；Evidence、审批与诊断统一脱敏。npm 审计为 0 个已知漏洞，Cargo 审计为 0 个漏洞；Linux GUI 依赖仍有 RustSec 维护性/unsound 警告，0.4.0 不发布 Linux GUI，仅发布不含该 Rust GUI 树的 headless runtime。完整边界与证据见 `docs/SECURITY_AUDIT_0.4.0.md`。
- DMG：Apple Silicon 本地候选 `Penglai_0.4.0_aarch64.dmg` 为 259,236,192 bytes，SHA-256 `34079daf42a0c8bdb5068c26fc3f204c052ee88bb3aa2cedc49d186acf50ac07`；`hdiutil verify`、只读挂载、Applications 链接、隔离目录复制、完整 adhoc seal、壳启动、独立 Host 握手、向导档案、身份诞生、mock Pi 对话/用量、工作区内产物预览、诊断 ZIP 解压/权限/脱敏、退出、端口释放与卸载均通过。
- 包内运行时：固定 Node 22.22.2、21,343 个文件、150 个生产依赖、588,758,731 bytes，并校验 Node、manifest 与所有 Host 直接必需包。第一次隔离安装曾真实抓到 Pi 工作区依赖层级错置，修复打包器和验证器后重建 DMG 才通过。本机真实权重完成 48kHz MOSS 合成（4.64 秒、可听波形）→ SenseVoice 中文识别回环。

## 发行者签名现状

本地候选 DMG 使用完整的 adhoc seal，但不带 Apple Developer ID/notarization。GitHub macOS 构建也已固定 `signingIdentity: "-"`，并在上传前重新挂载 DMG、验证 adhoc 封签与 Applications 链接。Windows Authenticode 未配置。正式 Release 工作流仍必须经过受保护环境、updater minisign、资产回读、SHA-256、SBOM 与 release contract；minisign 保护更新资产来源与完整性，但不能替代操作系统发行者信任。

## 发布资产计划

- macOS Apple Silicon / Intel DMG 与 updater app archive；
- Windows x64 setup；
- Linux headless runtime；
- `SHA256SUMS`、`SHA256SUMS.sig`、`SBOM.cdx.json`、`THIRD_PARTY_NOTICES.txt` 与平台化 `latest.json`。

本地验收不等于多平台真机与 0.4.x updater 生命周期已通过；Release 页面只应陈述实际完成的证据。
