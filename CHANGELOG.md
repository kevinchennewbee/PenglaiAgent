# Changelog · 更新日志

蓬莱的版本记录。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。0.3.x Python 产品线的完整历史保留在 `v0.3.6` 标签。

## [0.4.0] — 2026-08-09（本地发布候选，尚未发布）

0.4.0 是以 TypeScript Host、Pi AgentKernel 与 Tauri 2 Desktop 为核心的跨代重构。它只有一套执行核心：Desktop、CLI、Goal、飞书、微信与持久 Task 都进入 `EpisodeRunner → Pi AgentKernel`；项目锚定只改变工作目录与权限边界，不代表另一种产品模式。

### Added

- Tauri 2 原生桌面工作台：持续会话、项目与任务监督、运行/证据轨、审批、预算、记忆、渠道、设置、诊断与更新入口。
- 桌面麦克风录音与本地 SenseVoice ASR，保留 0.3.x 的情绪/语言标签；回复可通过 MOSS-TTS-Nano ONNX CPU 全管线逐条朗读。
- 默认关闭、由 Owner 明确启用的主动陪伴：`quiet` / `present` / `active` 强度、22:00–08:00 自动勿扰、晨间/晚间/空闲机会与 SenseVoice 负面情绪承接；生成走同一 EpisodeRunner，内部心跳不伪造成用户消息。
- Project / Task / Run / Step / Evidence / Approval / checkpoint 持久事实，Pi 会话索引、崩溃恢复和可核验证据轨。
- 权限档位 `plan` / `confirm` / `auto_edit` / `full`，以及 L1 自主、L2 可记住、L3 每次人工、L4 直接拒绝的策略闸。
- 全局/项目日预算、80% 预警、100% 熔断、Owner lift 与用量账本。
- 飞书长连接与微信 iLink 入口：白名单、路由、任务控制、审批和主动短消息都连接同一 Host 事实。
- 0.3 → 0.4 迁移工具：dry-run、掩码报告、写前快照、幂等迁移与 rollback。
- 双语 GitHub Pages 官网、全新中英 README、发布说明、SBOM/第三方归属与发布契约。
- Pi 原子工具面正式挂载 `read / write / edit / bash`；新增常用文档读取、中文 PDF 生成，以及需 Owner L3 的公网搜索/抓取 broker。
- 桌面安全 Markdown/GFM、表格/代码复制、普通文件 inbox、产物打开/定位、完整历史搜索/重命名/归档和后台完成通知。
- 标准 PDF / DOCX / XLSX / PPTX 生成；本地/GitHub Agent Skill 安装与完整性收据；手动连接、逐调用 L3 的 stdio/HTTP/SSE MCP broker。

### Changed

- 用 TypeScript Host 替代 0.3.x Python 运行核心；Desktop 随包携带固定 Node 与 Host runtime，终端用户不需要安装源码、Node 或 Python。
- CLI、桌面、IM、Goal 与 Task 不再维护彼此分叉的 agent 循环；`TaskRunner` 只负责持久生命周期，实际执行统一交给 EpisodeRunner/Pi。
- chat/work 字段只作为 0.4 数据与 RPC 的兼容锚定状态，不再作为面向用户的“双模式”概念。
- MOSS TTS 从占位/单会话契约路径升级为真实的多会话 prefill/decode、local decoder 与 audio codec 管线，输出 48kHz 双声道 PCM。
- 预算停止顺序改为先完成 Pi 会话收尾并索引 checkpoint，再向调用方暴露终态 Run，消除“已 blocked 但证据尚未可见”的竞态。

### Security

- Host 仅监听 loopback，并以本地 token 鉴权；token 与模型密钥不进入 renderer。
- 项目路径使用 realpath jail；凭证路径、越界访问与策略授权伪造直接 L4 拒绝。
- git push、外发与删除进入 L3 强制审批且不可记住；Windows/macOS/Linux 删除命令均有确定性分类。
- authority 在工具调用前复核；项目/任务撤权会中断运行并释放待定审批。
- scheduler、autonomous 与任意 Pi extension/hooks 不挂载；MCP 不自启，stdio 使用私有 HOME、远程逐跳防 SSRF、每次调用强制 L3，避免把 cwd 限制误称为安全沙箱。

### Verification

- 66 个测试文件、820 项测试全部通过；17 条生产路径 eval 回放全部通过；旧 `ChatRunner` 实现及其只覆盖死代码的 24 项测试已删除。
- Protocol 22 个错误码一致；Desktop 82 个 RPC 调用全部位于 Rust allowlist 且 Host 已实现；renderer 构建产物无 Host token 处理。
- SenseVoice 与 MOSS 官方真实权重完成中文合成→识别回环，不使用 mock。
- macOS Apple Silicon 本地 DMG（241,139,797 bytes，SHA-256 `a8c65e49…8162`）通过镜像校验、安装/启动、独立 Host/RPC、真实语音、退出和卸载生命周期；完整记录见 `docs/RELEASE_NOTES_0.4.0.md`。

### Known distribution limits

- 本地 DMG 未配置 Apple Developer ID / notarization；Windows Authenticode 也尚未配置。updater minisign 不能替代操作系统发行者信任。
- 0.4.0 是 0.3.x 的手工跨代升级，不从 0.3 updater 自动切换；迁移前请备份 `~/.penglai/`。

[0.4.0]: https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.4.0
