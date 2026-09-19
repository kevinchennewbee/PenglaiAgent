# Instructions for AI contributors

## Repository identity

- This checkout is the public `kevinchennewbee/PenglaiAgent` product repository.
  Verify `git remote -v`, branch, HEAD, and worktree state before changing it.
- Do not confuse it with upstream `deepseek-ai/DeepSeek-Harness`, historical
  `penglai-v2`, or any repository named `GenericAgent`.
- `PRODUCT_CONSTITUTION.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`,
  `docs/ACCEPTANCE.md`, the current version's acceptance delta,
  `release-contract.json`, and current source define the product/release
  contract. Reports are leads; published claims require verified public
  artifact evidence.
- v0.5.10, v0.5.11, v0.5.12, v0.6.0, v0.6.1, v0.6.2 and v0.6.3 are immutable
  public history. v0.6.3 was published; its ten-asset Release is immutable and
  public byte-for-byte readback passed. `docs/0.6.3/` is the record of that
  release and its planning state is preserved as written — do not treat its
  planning status lines as current. The current source and its own acceptance
  delta govern development work, and must not modify or weaken any published
  release history.

## Product boundary

- Official DeepSeek Harness is the only agent core. Do not add a parallel host,
  provider gateway, fake plugin runtime, or a second conversation engine.
- For 0.5.7, the fixed core is DSH `0.1.1-rc.2`. Office and Memory are required,
  bundled DSH plugins. Mobile Messaging, ASR, TTS, and Companion are bundled but
  optional and default off.
- 0.5.8 is immutable public history built from official DSH
  `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- For 0.6.5, the Owner-fixed upstream baseline is official npm
  `0.1.6-alpha.2`, tag `dsh-v0.1.6-alpha.2`, commit
  `ddefc45fbc7f8e46dd73185e68295696d1297887`. Penglai consumes the complete
  pinned DSH/vendor/Landlock cohort with exact registry integrity; package
  count is discovered from the graph. It must not mix different DSH
  generations or substitute source paths, Git dependencies, or locally
  repacked packages. The dependency graph, lockfile, runtime closure,
  profile, plugins, and release identity move atomically. RemoteError,
  session projections, DSH Home generation, Session V3 preserve-originals
  migration, connection lifecycle, and every first-party plugin and Plugin
  Center path require renewed evidence.
- The complete 307-package registry cohort is an audited upstream input, not
  the product runtime closure. Penglai 0.6.5 excludes LibreOffice, PDF/Office,
  Budget, and Companion from the workspace, profile, runtime, installer,
  product SBOM, and acceptance. Memory remains bundled and enabled by default,
  but the Owner may disable it without deleting its package or data. IM is
  bundled and enabled by default; ASR and TTS are bundled but default off and
  their model weights are not bundled.
- The exact official DSH `0.1.6-alpha.2` plugin manager is the sole package
  management engine. Penglai supplies it with application-owned Node and pnpm,
  exposes the official UI/tool, and does not impose the historical signed
  Penglai catalog as an ecosystem allowlist. Bundled Penglai feature code is
  app-owned; package installation and build-script approval remain explicit
  trust actions. Management infrastructure and credentials stay required.
- Keep Workspace, project, account, and IM-route boundaries explicit. Memory from
  one Workspace must not leak into another.

## Safe engineering rules

- Preserve unrelated and owner-authored changes. Never reset, clean, stash, or
  overwrite a dirty tree to make a gate green.
- Use class-level fixes and structured evidence. Do not add input-specific regex
  exceptions, fake PASS markers, mock production services, or timeout-based PASS.
- Never commit API keys, tokens, private signing keys, personal paths, chat media,
  local profiles, logs, or screenshots containing private data. Credentials used
  for a live test must enter through a no-echo channel and be removed afterward.
- Treat generated/vendor files as reviewed supply-chain inputs. Pin source URL,
  commit/version, digest, license, patch, and reproducible fetch/build procedure.
- Do not claim installed, native, live, Windows, Intel, notarized, Authenticode,
  or public-release evidence from source tests or cross-build output.
- The Owner authorized the complete 0.6.5 workflow: reviewed source, PR and
  merge to `main`, three-target native build and applicable installed validation,
  immutable publication, public byte readback, then README/site update and
  deployment. Preserve that order: do not change an existing release tag or
  asset, and do not update the public download claim before immutable 0.6.5
  bytes have passed readback.

## Verification and release

- Owner explicitly excludes a two-hour installed soak. Run normal deterministic,
  functional, native, lifecycle and release checks; do not add a timed wait gate.

- Start with `pnpm install --frozen-lockfile`, then inspect the scripts in
  `package.json`. Run formatting, typecheck, unit, contract, integration, E2E,
  security, chaos, versions, identity, contracts, dependency, license, secret,
  profile, closure, clean-clone, and Memory-real gates as applicable. Verify
  explicit absence of LibreOffice, Office/PDF, Budget, and Companion.
- The onboarding wizard must never strand a user. Verify fresh install, restart,
  Back/retry, invalid folder rejection, credential failure recovery, first official
  message, and default uninstall on Apple Silicon and Windows x64.
  The 0.6.3 to 0.6.5 installed upgrade was `OWNER_EXCLUDED` and remains recorded
  as an exclusion, not a missing result; do not retroactively label it PASS.
  UOS native install/startup/function is `OWNER_POST_RELEASE` and
  must not be labeled PASS; the UOS package/ABI/closure still require
  verification.
- Native artifacts for all three selected 0.6.5 targets must come from one clean
  `main` SHA. Intel Mac is excluded from this version. Follow the current
  version contract and acceptance delta; publish only the exact asset set in
  `release-contract.json`, then verify immutable public bytes. Missing any
  selected target is not a completed release; adding Intel to this version's
  exact set is not a completed release.
- Public README, site, release notes, and user-facing documentation are English
  first and Chinese second. State known limitations honestly.

---

# AI 贡献者说明

## 仓库身份

- 当前仓库是公开产品仓库 `kevinchennewbee/PenglaiAgent`。修改前必须核对
  remote、分支、HEAD 和工作区状态。
- 不要把它与上游 `deepseek-ai/DeepSeek-Harness`、历史 `penglai-v2` 或任何
  `GenericAgent` 仓库混淆。
- 产品宪法、产品与架构文档、验收清单、当前版本验收增量、发布契约与源码约束产品；
  公开发布声明还须真实附件取证。其他模型的报告只能作为线索。
- v0.5.10、v0.5.11、v0.5.12、v0.6.0、v0.6.1、v0.6.2 与 v0.6.3 已不可变。
  v0.6.3 已发布：十项附件不可变，公网逐字节回读已通过。`docs/0.6.3/` 是那次发布的
  记录，其规划状态按原样保留 —— 不要把它里面的状态行当成现状。以当前源码与其
  自己的验收增量约束开发；不得修改或削弱任何已发布历史。

## 产品边界

- 官方 DeepSeek Harness 是唯一 Agent 核心，禁止另建 Host、模型网关、假插件
  运行时或第二套会话引擎。
- 0.5.7 固定 DSH `0.1.1-rc.2`。蓬莱办公与蓬莱记忆为必装、默认启用的 DSH
  插件；手机消息、语音识别、语音生成、主动陪伴为内置可选插件，默认关闭。
- 0.5.8 是基于官方 DSH `dsh-v0.1.2-alpha.1` /
  `cd5ef8148158c3a752a658978873241fdf8e2bbc` 的不可变公开历史。
- 0.6.5 的 Owner 固定上游基线为官方 npm `0.1.6-alpha.2`，tag
  `dsh-v0.1.6-alpha.2`、commit `ddefc45fbc7f8e46dd73185e68295696d1297887`。
  Penglai 必须消费完整固定且带 registry integrity 的 DSH/vendor/Landlock
  cohort，包数以实际图为准；不得混装不同 DSH 代际，也不得用源码路径、Git
  依赖或本地重打包替代。依赖图、lockfile、runtime closure、profile、插件和
  release identity 必须原子迁移；RemoteError、会话投影、DSH Home generation、
  会话 V3 保原文件迁移、连接生命周期、全部第一方插件与插件中心都须重新取证。
- 完整 307 包清单是上游审计输入，不是产品运行闭包。0.6.5 不使用 LibreOffice，
  不做 PDF/办公插件、预算模块或主动陪伴模块；这些包不得进入 workspace、profile、
  运行时、安装包、产品 SBOM 或验收。记忆随包且默认启用，但 Owner 可以停用而不
  删除插件包或数据；消息插件随包且默认启用；ASR、TTS 随包但默认关闭，模型权重
  不随包。
- 精确固定的官方 DSH `0.1.6-alpha.2` 插件管理器是唯一包管理后端。Penglai
  使用应用内固定 Node/pnpm，开放官方插件 UI/工具，不再把历史签名目录作为整个
  生态的 allowlist。内置蓬莱功能代码随应用管理；安装第三方包与批准 build script
  是不同的显式信任动作。管理基础设施与 credentials 必须保持可用。
- Workspace、项目、账号、IM 路由必须隔离。记忆不得跨工作区串联。

## 安全开发与验证

- Owner 明确排除两小时测试。执行正常确定性测试、功能、原生、生命周期与发布验证，
  不增加计时等待门禁。

- 保留用户和其他人的未提交工作，禁止用 reset、clean、stash 或覆盖来制造绿灯。
- 修能力类别，不写输入特判，不伪造 PASS，不用 mock 冒充生产，不用超时当成功。
- 禁止提交 API Key、Token、私钥、个人路径、聊天媒体、本地配置或含隐私截图。
- 源码测试不等于已安装、原生、在线、Windows、Intel、公证或公开发布证据。
- Owner 已授权 0.6.5 完整流程：源码审查、PR/合并 `main`、三目标原生构建与相应
  安装验证、不可变发布、公网字节回读，随后更新 README/官网并部署。必须按此顺序；
  不得改写既有发布 tag/附件，也不得在不可变 0.6.5 公网字节回读通过前更新公开
  下载声明。
- Mac/Windows 安装引导必须验证全新安装、重启续跑、返回/重试、非法目录、凭据
  失败恢复、首条官方消息和默认卸载。0.6.3 到 0.6.5 的真实安装版升级在本版为
  `OWNER_EXCLUDED`，不得执行或标记 PASS。UOS 真机
  安装/启动/功能为 `OWNER_POST_RELEASE`，不得标 PASS；UOS 包/ABI/闭包仍须验证。
  三个所选安装包必须来自同一个干净 main SHA。Intel Mac 不在本版。缺任一所选
  目标仍失败；把 Intel 加入本版精确集合仍失败。
- 发布严格执行当前版本契约与验收增量，README、官网、发行说明与用户
  文档均为英文优先、中文随后，并如实写出限制。
