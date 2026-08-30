# Penglai 0.5.8 release notes

Trust tier: `community-verified`. Official DeepSeek Harness remains the only
agent core. Penglai 0.5.8 uses the fixed official source tag
`dsh-v0.1.2-alpha.1` at commit
`cd5ef8148158c3a752a658978873241fdf8e2bbc`; it does not wait for or publish an
unofficial npm package. This release is not a silent auto-update.

## Exact release / 精确发布

The immutable [`v0.5.8` Release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.8)
was built from one reviewed source SHA and passed public byte, SHA-256, and
updater-signature readback.

- Source / 源码: `80c8ee81de7a683a1d366bdba0f354826df0a914`
- DSH source / DSH 源码: `dsh-v0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`
- Public export / 公开源码树: `5dfa28c4e43cfa6039479e7341cf1bdc2f8ced4ce8744dcc00fd4e12c102c69a`
- Native run / 三端原生任务: [33310265795](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33310265795)
- Public readback / 公网回读: [33313380755](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33313380755)
- Release set / 发布文件: exactly 10 immutable assets, including a 778-component SBOM

## English

### DSH source closure and desktop ownership

Penglai 0.5.8 upgrades from the 0.5.7 DSH package baseline to a reproducible
251-package closure built from the fixed official `0.1.2-alpha.1` source. The
source tag, commit, package identities, digests, licenses, and patches are
recorded and replayed on every native release host. No Penglai package is
published under the official DSH npm scope.

The release fixes the failure classes exposed during 0.5.7 operation and the
new integration boundaries introduced by DSH alpha.1:

- DSH child exit, hang detection, restart ownership, and health recovery;
- Windows child-process authentication output forwarding before the child is
  resumed, without widening the inherited-handle set;
- deterministic LF source-closure identity across macOS and Windows;
- Penglai-owned title and welcome flow, with no upstream internal-test notice
  and no duplicate DSH credentials onboarding;
- complete install, enable, restart, settings-open, disable, and restart checks
  for every bundled first-party plugin;
- Plugin Center compatibility and rollback checks against the alpha.1 loader;
- Feishu asynchronous media and error boundaries, plus the existing Office,
  Memory, messaging, ASR, TTS, and Companion contracts.

WhatsApp is not a 0.5.8 product surface. It is not displayed, supported,
planned, or bundled. The historical 0.5.7 release remains immutable.

### Installation and upgrades

| Target | Installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon, macOS 13+ | [`Penglai_0.5.8_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_macos_aarch64.dmg) | 470,071,594 | `cc08a1820f92be4fe5a851a4cfd33f02ab48035c8e98f72feacb2fd074a9b992` |
| Intel Mac | [`Penglai_0.5.8_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_macos_x64.dmg) | 412,716,622 | `14d0c4edf572c134d9d71e6dea69a4bcf53b46cf31ed267fe8472c2f1a4c1b00` |
| Windows x64 | [`Penglai_0.5.8_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_windows_x64_setup.exe) | 359,890,576 | `0a238bec35ea5117619a5112566ba6985f2194873eb60ef7110d1ca21bc1bec5` |

Versions 0.5.1 through 0.5.7 can discover 0.5.8 under **Settings → Penglai →
Updates**, or use the same-platform installer as a manual overlay. There is no
silent auto-update. Version 0.5.0 still requires a manual overlay. External
Workspaces and the `Penglai/0.5` data generation are preserved.

### Known limits

- macOS is ad-hoc signed and not notarized. Windows has no Authenticode.
  Gatekeeper or SmartScreen may warn.
- Penglai has no account, Penglai-operated telemetry backend, cloud memory
  sync, or cloud ASR/TTS.
- Owner-account connector journeys and a two-hour installed soak remain
  supplemental `LIVE_NOT_RUN` evidence. They are not claimed by this release.
- Plugin signatures and permissions protect distribution, not operating-system
  sandboxing. DSH plugins share the local DSH process.

## 中文

### DSH 源码闭包与桌面归属

蓬莱 0.5.8 从 0.5.7 的 DSH 包基线升级到固定的官方 `0.1.2-alpha.1` 源码，
构建出可复现的 251 包本地闭包。标签、提交、包身份、摘要、许可证与补丁均被记录，
并在三个原生发布主机上重放；蓬莱不会冒用官方 DSH npm scope 发布包。

这次同时修复 0.5.7 暴露的真实故障类别，以及 DSH alpha.1 带来的配套边界：

- DSH 子进程退出、卡死检测、重启归属和健康恢复；
- Windows 子进程恢复前完成认证输出转发，同时保持继承句柄白名单；
- macOS 与 Windows 上一致的 LF 源码闭包身份；
- 标题和欢迎流程归蓬莱所有，不显示上游 DSH 内测通知，不重复展示 DSH 密钥引导；
- 每个内置第一方插件都完成安装、启用、重启、打开设置、停用、再次重启验证；
- 插件中心按 alpha.1 Loader 重验兼容性与回滚；
- 飞书异步媒体与错误边界，以及既有办公、记忆、消息、ASR、TTS、陪伴契约。

WhatsApp 不是 0.5.8 的产品能力：不展示、不支持、不列为规划，也不捆绑运行时。
0.5.7 的历史发布保持不可变。

0.5.1 到 0.5.7 可从 **设置 → 蓬莱 → 更新** 发现 0.5.8，也可用同平台安装包
手动覆盖。不会静默自动升级；0.5.0 仍需手动覆盖。外部 Workspace 与
`Penglai/0.5` 数据代际会保留。

macOS 为 ad-hoc 签名且未公证，Windows 没有 Authenticode。Owner 真实账号连接
旅程和两小时安装版稳定运行仍是补充性的 `LIVE_NOT_RUN` 证据，本次发布不宣称完成。
