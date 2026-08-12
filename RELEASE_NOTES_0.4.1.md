# 蓬莱 Penglai 0.4.1

蓬莱 0.4.1 回答一个问题：**装好之后，它凭什么懂你？**

0.4.0 交付了统一执行核心与原生桌面工作台；0.4.1 在此之上交付「个人上下文 V1」——Owner 显式授权本地文档目录，蓬莱在本机建立可删除的派生索引，对话与任务自动检索并给出 Host 验证的来源引用。同时修复 0.4.0 中会造成消息、状态、审批与证据失真的一批真实缺陷，并补齐首次体验闭环。

## 个人上下文 V1

- **显式授权，本地索引。** Owner 通过桌面原生目录选择器或 CLI 授权 global / project 目录；Host 用 SQLite + FTS5 在本机建立离线派生索引。原文件与完整索引不上传，原文件绝不改写或删除；随时可在设置或 CLI 移除授权，移除只删索引。使用云模型回答时，本次检索到的相关片段会发送给 Owner 选择的模型供应商。
- **Host 验证的来源引用。** 助理回答可携带 `contextReferences[]` 来源卡片：文档标题、相对路径、章节/行/键位置与 current / stale / revoked / unavailable 状态。引用由 Host 逐条验证并跨会话持久化，重启、重索引、撤销授权后徽标如实更新——不是模型嘴上的"引用"。
- **结构化定位。** Markdown/TXT 保留 heading 与偏移；CSV/TSV 保留表头与行组；JSON/YAML/XML 保留 key path。每个引用都能解释"出自哪里"。
- **Task 证据轨新增 `source` 类别。** 仅由 Host/tool observation 创建，metadata 带相对路径、位置、document/chunk hash 与查询；桌面证据轨新增「资料来源」区。
- **索引 TOCTOU 修复。** 同一已验证打开对象完成 fstat + hash + 读取，不再校验后二次按路径打开。

## 首次体验

- 向导新增可跳过的「个人上下文」步：装好就能把工作资料交给它理解。
- 空会话不再是空白画布：没有资料时引导添加；有资料时展示由真实文档标题离线生成的示例问题（`context.suggestions`，不调用模型），点击即发送。
- 浏览器开发壳中目录授权按钮如实降级提示，不静默失败。

## 信任与状态收口

- **Provider 统一 Host-only transport。** list-models、验活 smoke 与真实 Pi 推理共用同一条出网路径：DNS 全地址检查、私网/云元数据拒绝、逐跳 redirect 重验证与 DNS rebinding 防护。renderer 构建不再 import Host 网络实现，新增 `renderer:network-boundary` 静态门禁。
- **目录授权信任边界前移。** renderer 不再拥有提交任意绝对路径的能力；目录选择与注册走 trusted native command，Host 保留 canonical path / scope / 敏感路径复核；`context.source.list` 对 renderer 不暴露绝对路径，CLI 经 Host-only `context.source.describe` 显示真实路径。
- **审批与预算状态机。** `remembered` 返回实际 grant 结果（L3 永远 false），`decidedBy` 必填入审计；abort 后迟到审批无法复活旧 Episode；预算熔断时 Run 与当前 Step 一起进入 `blocked` 非成功终态，重启后保持。
- **消息与终态不再失真。** 飞书/微信忙碌时不再把排队应答当失败展示，等待真实回复；Desktop 用结构化 `steer_queued` / `followup_queued` ack 取代文本子串匹配；Owner 主动取消的任务落 `cancelled` 而非 `failed`；`conversation.get` 批量刷新历史引用状态，重索引/撤销后旧卡片不再冻结旧徽标。
- **原生壳响应性。** 大目录索引等阻塞 Host RPC 移入 `spawn_blocking`，不再卡住 Tauri 异步运行时。

## 验收证据（2026-08-12 实测）

| 门禁 | 结果 |
|---|---|
| `npm test` | 84 个测试文件 / 930 条测试，0 失败 |
| `npm run eval` | 17 条生产路径回放（E01–E17）全部通过 |
| `npm run build` / `schema:check` / `protocol:check` | 通过；23 个协议错误码与 Host 一致 |
| `desktop:allowlist` | 89 个 renderer 调用全部允许且已实现 |
| `renderer:token-boundary` / `renderer:network-boundary` | 通过（含 dist 扫描） |
| `cargo check` | 通过 |
| 发布契约 | 10 个版本面一致为 0.4.1 |

端到端独立验收（隔离数据目录 + 仿真工作资料）：目录授权 → 索引 → FTS 检索（含 CSV 表头定位）→ 引用深读（sha256 校验）→ 改文件重索引 → 移除索引且原文件完好；向导「个人上下文」步、空会话引导（无资料 CTA / 有资料示例问题）、示例问题点击发送均在真实 UI 中通过。

## 已知限制（如实声明）

- macOS Developer ID / notarization 与 Windows Authenticode 尚未配置；首次启动可能出现 Gatekeeper / SmartScreen 提示。updater 资产由 minisign 保护，但 minisign 不替代操作系统发行者信任。
- FTS trigram 分词需要至少 3 个字符的查询词；两字中文词请换更长表述。
- 个人上下文 V1 当前支持 PDF / DOCX / XLSX / PPTX / Markdown / TXT / CSV / TSV / JSON / YAML / XML / HTML / RTF；复杂版式、扫描件 OCR 与公式还原不属于 V1 保证。
- 多平台真机安装与 0.4.0 → 0.4.1 updater 生命周期验证在 Release 资产产出后按 [docs/RELEASE_PROCESS.md](docs/RELEASE_PROCESS.md) §7 补做。

## 从 0.4.0 升级

0.4.0 桌面客户端会通过稳定通道 `desktop-v0.4` 收到本次更新；也可直接下载本页 DMG / setup 安装。数据目录 schema 自动前滚，无需手工迁移。从 0.3.x 升级请先阅读 [0.4.0 发布说明](docs/RELEASE_NOTES_0.4.0.md)的迁移一节。
