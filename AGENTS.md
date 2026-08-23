# Instructions for AI contributors

## Repository identity

- This checkout is the public `kevinchennewbee/PenglaiAgent` product repository.
  Verify `git remote -v`, branch, HEAD, and worktree state before changing it.
- Do not confuse it with upstream `deepseek-ai/DeepSeek-Harness`, historical
  `penglai-v2`, or any repository named `GenericAgent`.
- `PRODUCT_CONSTITUTION.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`,
  `docs/ACCEPTANCE.md`, `docs/0.5.5/RELEASE_RUNBOOK.md`,
  `release-contract.json`, and the current source are the release truth. Reports
  from another model are leads, not evidence. Do not cite files that do not
  exist.

## Product boundary

- Official DeepSeek Harness is the only agent core. Do not add a parallel host,
  provider gateway, fake plugin runtime, or a second conversation engine.
- For 0.5.5, the fixed core is DSH `0.1.1-rc.2`. Office and Memory are required,
  bundled DSH plugins. Mobile Messaging, ASR, TTS, and Companion are bundled but
  optional and default off.
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

## Verification and release

- Start with `pnpm install --frozen-lockfile`, then inspect the scripts in
  `package.json`. Run formatting, typecheck, unit, contract, integration, E2E,
  security, chaos, versions, identity, contracts, dependency, license, secret,
  profile, closure, clean-clone, Office-real, and Memory-real gates as applicable.
- The onboarding wizard must never strand a user. Verify fresh install, restart,
  Back/retry, invalid folder rejection, credential failure recovery, first official
  message, upgrade, and uninstall on Apple Silicon, Intel Mac, and Windows x64.
- Native artifacts for all three targets must come from one clean `main` SHA.
  Follow `docs/0.5.5/RELEASE_RUNBOOK.md`; publish only the exact asset set in
  `release-contract.json`, then verify immutable public bytes.
- Public README, site, release notes, and user-facing documentation are English
  first and Chinese second. State known limitations honestly.

---

# AI 贡献者说明

## 仓库身份

- 当前仓库是公开产品仓库 `kevinchennewbee/PenglaiAgent`。修改前必须核对
  remote、分支、HEAD 和工作区状态。
- 不要把它与上游 `deepseek-ai/DeepSeek-Harness`、历史 `penglai-v2` 或任何
  `GenericAgent` 仓库混淆。
- 产品宪法、产品与架构文档、验收清单、0.5.5 发布手册、发布契约和当前源码
  才是发布事实；不要引用不存在的状态或计划文件。其他模型的报告只能作为线索，
  不能作为证据。

## 产品边界

- 官方 DeepSeek Harness 是唯一 Agent 核心，禁止另建 Host、模型网关、假插件
  运行时或第二套会话引擎。
- 0.5.5 固定 DSH `0.1.1-rc.2`。蓬莱办公与蓬莱记忆为必装、默认启用的 DSH
  插件；手机消息、语音识别、语音生成、主动陪伴为内置可选插件，默认关闭。
- 插件中心只接受签名目录中身份、摘要、权限、DSH 兼容性与回滚均通过的包。
  UI 显示不等于真实安装或健康。
- Workspace、项目、账号、IM 路由必须隔离。记忆不得跨工作区串联；办公写入、
  导出和回传必须使用与具体动作绑定的用户确认。

## 安全开发与验证

- 保留用户和其他人的未提交工作，禁止用 reset、clean、stash 或覆盖来制造绿灯。
- 修能力类别，不写输入特判，不伪造 PASS，不用 mock 冒充生产，不用超时当成功。
- 禁止提交 API Key、Token、私钥、个人路径、聊天媒体、本地配置或含隐私截图。
- 源码测试不等于已安装、原生、在线、Windows、Intel、公证或公开发布证据。
- 三端安装引导必须完整验证全新安装、重启续跑、返回/重试、非法目录、凭据失败
  恢复、首条官方消息、升级和卸载；三个安装包必须来自同一个干净 main SHA。
- 发布严格执行 `docs/0.5.5/RELEASE_RUNBOOK.md`，README、官网、发行说明与用户
  文档均为英文优先、中文随后，并如实写出限制。
