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
- v0.5.10, v0.5.11, v0.5.12 and v0.6.0 are immutable public history. For
  0.6.1, `docs/0.6.1/` and the current source govern development work. They
  are not public-release truth until immutable `v0.6.1` bytes exist, and must
  not modify or weaken published 0.5.10, 0.5.11, 0.5.12 or 0.6.0.

## Product boundary

- Official DeepSeek Harness is the only agent core. Do not add a parallel host,
  provider gateway, fake plugin runtime, or a second conversation engine.
- For 0.5.7, the fixed core is DSH `0.1.1-rc.2`. Office and Memory are required,
  bundled DSH plugins. Mobile Messaging, ASR, TTS, and Companion are bundled but
  optional and default off.
- 0.5.8 is immutable public history built from official DSH
  `dsh-v0.1.2-alpha.1` / `cd5ef8148158c3a752a658978873241fdf8e2bbc`.
- For 0.6.1, the Owner-fixed upstream baseline is official npm
  `0.1.5-rc.1`, tag `dsh-v0.1.5-rc.1`, commit
  `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`. Penglai consumes the complete
  pinned DSH/vendor/Landlock cohort with exact registry integrity; package
  count is discovered from the graph. It must not mix different DSH
  generations or substitute source paths, Git dependencies, or locally
  repacked packages. The dependency graph, lockfile, runtime closure,
  profile, plugins, and release identity move atomically. RemoteError,
  session projections, DSH Home generation, Session V3 preserve-originals
  migration, connection lifecycle, and every first-party plugin and Plugin
  Center path require renewed evidence.
- Plugin Center may install only signed catalog artifacts with exact identity,
  digest, permission, DSH compatibility, and rollback checks. UI state is never
  proof that a plugin is installed or healthy.
- Keep Workspace, project, account, and IM-route boundaries explicit. Memory from
  one Workspace must not leak into another. Office writes, exports, and returns
  require action-specific owner confirmation.

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
- 0.6.1 identity, native and publication work lands through `codex/0.6.1`
  onto later manager-reviewed `main` freeze. This source phase does not
  create a PR, merge, tag, or public download claim. Do not change an
  existing release tag/asset, publish preview bytes, or deploy a public
  download claim before public bytes exist.

## Verification and release

- Owner explicitly excludes a two-hour installed soak. Run normal deterministic,
  functional, native, lifecycle and release checks; do not add a timed wait gate.

- Start with `pnpm install --frozen-lockfile`, then inspect the scripts in
  `package.json`. Run formatting, typecheck, unit, contract, integration, E2E,
  security, chaos, versions, identity, contracts, dependency, license, secret,
  profile, closure, clean-clone, Office-real, and Memory-real gates as applicable.
- The onboarding wizard must never strand a user. Verify fresh install, restart,
  Back/retry, invalid folder rejection, credential failure recovery, first official
  message, upgrade, and uninstall on Apple Silicon, Intel Mac, Windows x64, and
  Loongson UnionTech UOS.
- Native artifacts for all four targets must come from one clean `main` SHA.
  Follow the current version contract and acceptance delta; publish only the
  exact asset set in `release-contract.json`, then verify immutable public bytes.
  A feasibility report, cross-build or three-platform set is not a completed
  four-platform release.
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
- v0.5.10、v0.5.11、v0.5.12、v0.6.0 已不可变。0.6.1 以 `docs/0.6.1/` 与当前源码约束开发；
  在不可变 `v0.6.1` 公网字节存在前它们不是公开发布事实，也不得修改或削弱已经
  不可变发布的 0.5.10、0.5.11、0.5.12 或 0.6.0 历史。

## 产品边界

- 官方 DeepSeek Harness 是唯一 Agent 核心，禁止另建 Host、模型网关、假插件
  运行时或第二套会话引擎。
- 0.5.7 固定 DSH `0.1.1-rc.2`。蓬莱办公与蓬莱记忆为必装、默认启用的 DSH
  插件；手机消息、语音识别、语音生成、主动陪伴为内置可选插件，默认关闭。
- 0.5.8 是基于官方 DSH `dsh-v0.1.2-alpha.1` /
  `cd5ef8148158c3a752a658978873241fdf8e2bbc` 的不可变公开历史。
- 0.6.1 的 Owner 固定上游基线为官方 npm `0.1.5-rc.1`，tag
  `dsh-v0.1.5-rc.1`、commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e`。
  Penglai 必须消费完整固定且带 registry integrity 的 DSH/vendor/Landlock
  cohort，包数以实际图为准；不得混装不同 DSH 代际，也不得用源码路径、Git
  依赖或本地重打包替代。依赖图、lockfile、runtime closure、profile、插件和
  release identity 必须原子迁移；RemoteError、会话投影、DSH Home generation、
  会话 V3 保原文件迁移、连接生命周期、全部第一方插件与插件中心都须重新取证。
- 插件中心只接受签名目录中身份、摘要、权限、DSH 兼容性与回滚均通过的包。
  UI 显示不等于真实安装或健康。
- Workspace、项目、账号、IM 路由必须隔离。记忆不得跨工作区串联；办公写入、
  导出和回传必须使用与具体动作绑定的用户确认。

## 安全开发与验证

- Owner 明确排除两小时测试。执行正常确定性测试、功能、原生、生命周期与发布验证，
  不增加计时等待门禁。

- 保留用户和其他人的未提交工作，禁止用 reset、clean、stash 或覆盖来制造绿灯。
- 修能力类别，不写输入特判，不伪造 PASS，不用 mock 冒充生产，不用超时当成功。
- 禁止提交 API Key、Token、私钥、个人路径、聊天媒体、本地配置或含隐私截图。
- 源码测试不等于已安装、原生、在线、Windows、Intel、公证或公开发布证据。
- 0.6.1 身份、原生与发布工作经 `codex/0.6.1` 进入后续 manager 审查的 `main`
  冻结。本源码阶段不创建 PR、不合并、不打 tag、不部署公开下载声明；不得改写
  既有发布 tag/附件，也不得在公网字节存在前部署 0.6.1 下载声明。
- 四端安装引导必须完整验证全新安装、重启续跑、返回/重试、非法目录、凭据失败
  恢复、首条官方消息、升级和卸载；四个安装包必须来自同一个干净 main SHA。
  可行性备忘、交叉编译或三端集合不能冒充四端完成。
- 发布严格执行当前版本契约与验收增量，README、官网、发行说明与用户
  文档均为英文优先、中文随后，并如实写出限制。
