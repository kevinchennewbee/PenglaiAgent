# Penglai 0.5.10 acceptance delta

The fixed core is official DeepSeek Harness `0.1.2-rc.1`, tag
`dsh-v0.1.2-rc.1`, commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`.
The product consumes the unmodified official npm packages. The complete
254-package source inventory and registry identities are recorded in
[DSH_NPM_COHORT.json](DSH_NPM_COHORT.json). Dependency overrides and the lock
must agree with that inventory, including optional peer dependencies.

Required evidence for this version:

- The official `Session.snapshotEvents()` API supplies message recovery,
  budget reconciliation and Companion replay. Missing capability fails closed.
- Existing Workspace, account, session, Office approval, Memory isolation,
  connection recovery, plugin health and signed catalog contracts continue to
  pass on rc.1. Office and Memory remain required; optional plugins stay off
  until enabled by the user.
- Upgrades from both 0.5.8 and 0.5.9 preserve their previous DSH Home and prepare
  an isolated rc.1 generation. The active pointer changes only after the new
  runtime and required plugins pass health checks. Rollback preserves the old
  generation's identity and data.
- Apple Silicon, Intel Mac and Windows x64 installers share one clean main
  commit. Each matching native runner verifies the installed executable,
  onboarding recovery, all plugin/Profile modes, both upgrades and default
  uninstall with user data preserved.
- The release contains all ten files declared by `release-contract.json`.
  Draft and immutable public downloads must agree on installer bytes, exact
  source identity, update signatures, increasing update sequence, SBOM,
  third-party notices and the public source export manifest.
- Public README, English and Chinese website pages, release notes and security
  information must identify the released version and verified downloads. A
  later documentation commit must be distinguished from the installer source.

Normal functional and deterministic load tests apply. A two-hour installed
soak is excluded by the Owner and is not a pending release item. Account-based
external model/IM observations are reported only when actually executed;
credential-free tests do not prove a real model response or message delivery.
Community macOS signing is not Apple notarization, and Windows binaries do not
claim Authenticode signing.

## 中文

本版本固定官方 DSH `0.1.2-rc.1`，精确源码提交如上，消费未经修改的官方 npm
包。254 包清单、registry 摘要、签名、间接与可选依赖必须一致。

消息恢复、预算恢复和主动陪伴回放改用官方 `Session.snapshotEvents()`；缺失该
接口时明确失败。工作区、账号和会话隔离、办公动作确认、记忆隔离、断线恢复、
插件健康和签名目录边界继续适用。办公与记忆必装，可选插件默认关闭。

0.5.8 和 0.5.9 均须验证升级：复制到独立 rc.1 数据目录，健康检查通过后才切换，
旧目录保留用于回退。三端安装包来自同一个干净 main 提交，并在各自原生环境
验证安装程序、引导恢复、插件组合、两条升级路径和默认保留用户数据的卸载。

正式发布必须包含契约规定的十项附件，发布前回读完整草稿，发布后验证不可变
公开字节、签名、递增更新序号、源码身份和许可证材料。README、中英文官网、
发行说明与安全信息须对应已发布版本，并区分安装包源码和后续文档提交。

执行正常功能与确定性负载测试；Owner 已排除两小时测试，它不是待办。真实模型
与 IM 账号验证只陈述实际完成的结果。无凭据测试不能证明真实模型回复或消息
送达。社区签名不代表 Apple 公证或 Windows Authenticode。
