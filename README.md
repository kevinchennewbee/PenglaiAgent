<p align="center">
  <img src="website/art/readme-hero-060.png" width="100%" alt="Penglai 蓬莱: DeepSeek Harness, on your computer">
</p>

# Penglai · 蓬莱

Your own AI workspace, ready to install.

[English](#english) · [中文](#中文) · [Website](https://penglai.pages.dev) · [中文网站](https://penglai.pages.dev/zh/) · [Security](SECURITY.md)

**Penglai 0.6.3 is the current public release.** It packages the exact official
[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
`0.1.6-alpha.2` cohort for Apple Silicon, Windows x64, and UnionTech UOS 20
LoongArch. Memory and Mobile Messaging are installed on a fresh profile;
messaging channels remain inert until you connect them. ASR and MOSS-TTS are
bundled but default off. Office/PDF, LibreOffice, Budget, and Companion are not
part of the 0.6.3 product runtime.

[Download 0.6.3](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3)
· [Release notes](docs/RELEASE_NOTES_0.6.3.md)
· [Publication manifest](docs/PUBLICATION_MANIFEST_0.6.3.md)
· [Security](SECURITY.md)

The immutable release was built from
`1c103212ad25b7d2a0061c2c4bfa595cd413c138`. The complete ten-asset Release,
SHA-256 digests, updater signature, installer signatures, and public-byte
readback all passed before this README was updated.

<p align="center">
  <img src="website/shots/0.5.5/welcome.png" width="78%" alt="Penglai first-run welcome">
</p>
<p align="center"><sub>Installed 0.5.5 first-run screen, kept as a historical UI reference.</sub></p>

<a id="english"></a>

## English

### One official DSH core

Penglai is a desktop distribution of DeepSeek Harness. DSH remains the one
agent core: it owns models, tools, approvals, Workspaces, Sessions, turns, and
the conversation. Penglai supplies native installers, guided first launch,
local paths, lifecycle supervision, an updater you approve, and a bounded set
of first-party integrations.

0.6.3 uses official DSH `0.1.6-alpha.2`, tag `dsh-v0.1.6-alpha.2`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`, and the fixed 307-package source
cohort. There is no parallel Penglai agent runtime.

### What is included

| Surface | Fresh profile | Notes |
| --- | --- | --- |
| Official DSH plugin manager / Penglai Center | On | Sole mutable profile package-management backend; application-owned Node/pnpm |
| Penglai Memory | On | Workspace-scoped project memory; Owner may disable it without deleting package/data |
| Mobile Messaging | On, unconfigured | Weixin, Feishu, DingTalk, WeCom, QQ, Slack, Telegram, Discord; adapters/accounts remain inert until connected |
| Speech Recognition | Off | Local SenseVoice transcription; model assets are pinned downloads |
| Voice Generation | Off | Local MOSS-TTS on supported Mac/Windows systems; unavailable on UOS LoongArch |

Office/PDF, LibreOffice, Budget, and Companion are intentionally excluded from
0.6.3. Attachments and other tool surfaces remain those provided by the exact
DSH runtime; Penglai does not claim a separate Office plugin in this release.

Memory follows the Workspace you chose. One project cannot quietly search
another. Personal memory is a separate explicit choice.

<p align="center">
  <img src="website/shots/0.5.5/plugin-center.png" width="48%" alt="Historical Penglai Plugin Center UI">
  <img src="website/shots/0.5.5/memory.png" width="48%" alt="Historical Penglai Memory UI">
</p>
<p align="center"><sub>Installed 0.5.5 screens kept as UI references; they are not 0.6.3 screenshots.</sub></p>

### Download 0.6.3

GitHub Releases is the authoritative source. Verify downloads against
`SHA256SUMS` on the immutable
[`v0.6.3` release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3).
All three installers were built from source
`1c103212ad25b7d2a0061c2c4bfa595cd413c138`.

#### Apple Silicon, macOS 13+

[`Penglai_0.6.3_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_macos_aarch64.dmg)

271,997,944 bytes · SHA-256
`58b6df9704148403b229c06ee0f0a5d7a3ae328b8ac61a56d8d2d13e1c7a0129`

#### Windows 10+ x64

[`Penglai_0.6.3_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_windows_x64_setup.exe)

358,353,527 bytes · SHA-256
`6fe9d3b59c644cfca15a374c03959ae117dce24de2382014f177257bdeaa9edd`

#### UnionTech UOS 20 LoongArch

[`Penglai_0.6.3_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_uos_loong64.deb)

280,873,186 bytes · SHA-256
`2dfc77f88cc436bdcf6abf3ce22c6098c6ee5f9dbbf2b097f7c8ce457faaf4dd`

### What was actually validated

The same clean source SHA passed Source CI and the exact three-target native
aggregate.

- Apple Silicon: exact DMG, closure/artifact/profile validation, full installed
  onboarding suite, welcome/process smoke, first-party plugin compatibility,
  fresh install → restart → default uninstall.
- Windows x64: exact NSIS installer, closure/artifact/fuses/signing, profile
  matrix, Simplified Chinese installer UI, full installed onboarding suite,
  first-party plugin compatibility, fresh install → restart → default uninstall.
- UOS LoongArch: exact `.deb`, package identity, ABI, runtime, architecture and
  full closure verification.
- Production dependency advisory audit, secret scan, supply-chain checks, DSH
  cohort verification, draft ten-asset readback, updater signature, installer
  signatures, and immutable public-byte readback all passed.

Explicitly **not** claimed as PASS:

- `0.6.2 → 0.6.3` installed-upgrade journey: `OWNER_EXCLUDED`.
- Two-hour installed soak: `OWNER_EXCLUDED`.
- Native UOS machine acceptance (install/start/UI/file picker/sleep-resume/model
  conversation): `OWNER_POST_RELEASE`.
- Optional private-account IM/iMessage live delivery: not part of publication acceptance.
- macOS notarization and Windows Authenticode are not present.

### Security and lifecycle notes

- There is no Penglai account, Penglai telemetry backend, or cloud memory
  service. Model requests still send task context to the provider you choose.
- Credentials live in app-private DSH YAML; this is not Keychain or hardware
  isolation.
- The canonical DSH session-log/upload path is disabled by the Penglai profile.
- The exact official DSH alpha.2 plugin manager is the sole package-management
  backend. Package installation and build-script approval are separate trust
  actions. Plugins share the local DSH process.
- macOS is ad-hoc signed and not notarized. Windows has no Authenticode. Do not
  disable system security to install.
- Default uninstall removes the app/cache while preserving user data and external Workspaces.

### Build and contribute

This repository uses Node `22.23.2` and pnpm `11.11.0`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm fetch:mnemon-assets
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm verify:contracts
pnpm verify:dependencies
pnpm audit:secrets
pnpm audit:advisories
```

Native packages must be built on their matching hosts. Start with
[CONTRIBUTING.md](CONTRIBUTING.md), and give an AI coding tool
[AGENTS.md](AGENTS.md) before it works in this repository.

Penglai is created and maintained by
[Kevin Chen / 陈克文](https://github.com/kevinchennewbee). It is built with
DeepSeek Harness, Electron, Node.js, TypeScript, pnpm, SenseVoice,
sherpa-onnx, MOSS-TTS-Nano, Mnemon, Lark SDK, openclaw-weixin, and the work of
many contributors. Every dependency keeps its own license.

<a id="中文"></a>

## 中文

### 认识一下蓬莱

蓬莱是 DeepSeek Harness 的桌面发行版。DSH 始终是唯一 Agent 核心，负责模型、工具、
审批、Workspace、Session、Turn 和会话；蓬莱负责原生安装包、首次引导、本地目录、
进程生命周期、需要你确认的更新，以及一组边界明确的第一方集成。

0.6.3 固定官方 DSH `0.1.6-alpha.2`，tag `dsh-v0.1.6-alpha.2`，commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`，并锁定 307 个源码 cohort 包。

全新 profile 中，记忆和消息插件已经安装并 active；消息通道与账号仍保持未配置，
只有你连接后才真正工作。ASR 与 MOSS-TTS 默认关闭，模型权重另行按固定版本下载。
记忆可以由 Owner 关闭而不删除插件包或数据。Office/PDF、LibreOffice、预算和主动陪伴
不属于 0.6.3 产品运行闭包。

### 下载 0.6.3

权威公开版是不可变
[`v0.6.3`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3)。
三个安装包都来自同一源码
`1c103212ad25b7d2a0061c2c4bfa595cd413c138`，请使用 Release 页的
`SHA256SUMS` 核对下载文件。

- [Apple 芯片安装包](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_macos_aarch64.dmg) — 271,997,944 bytes — `58b6df9704148403b229c06ee0f0a5d7a3ae328b8ac61a56d8d2d13e1c7a0129`
- [Windows x64 安装包](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_windows_x64_setup.exe) — 358,353,527 bytes — `6fe9d3b59c644cfca15a374c03959ae117dce24de2382014f177257bdeaa9edd`
- [统信 UOS 20 龙芯安装包](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_uos_loong64.deb) — 280,873,186 bytes — `2dfc77f88cc436bdcf6abf3ce22c6098c6ee5f9dbbf2b097f7c8ce457faaf4dd`

### 本版真实验收边界

- Apple 芯片：DMG、closure/artifact/profile、完整安装态引导、welcome/process、第一方插件兼容，以及全新安装 → 重启 → 默认卸载全部通过。
- Windows x64：NSIS、closure/artifact/fuses/signing、完整 profile matrix、简体中文安装器 UI、完整安装态引导、第一方插件兼容，以及全新安装 → 重启 → 默认卸载全部通过。
- UOS 龙芯：`.deb` 身份、ABI、运行时、架构与完整闭包验证通过。
- secret/advisory/supply-chain、DSH cohort、十附件 draft 回读、更新签名、安装器签名与正式发布后的不可变公网字节回读全部通过。

明确**不宣称 PASS**：

- `0.6.2 → 0.6.3` 真实安装版升级：`OWNER_EXCLUDED`。
- 两小时安装版 soak：`OWNER_EXCLUDED`。
- UOS 真机安装/启动/UI/文件选择器/休眠恢复/模型会话：`OWNER_POST_RELEASE`。
- 可选私人账号 IM/iMessage live：不属于本次发布验收。
- macOS 未公证，Windows 无 Authenticode。

### 安装前值得知道

- 没有蓬莱账号、蓬莱遥测后台或云端记忆同步；模型请求仍会把任务所需上下文发给你选择的模型供应商。
- 凭据保存在应用私有的 DSH YAML 中，不是 Keychain，也不是硬件隔离。
- Penglai profile 默认关闭 canonical DSH session-log/upload。
- 插件包管理只使用 exact official DSH alpha.2 manager；安装包与批准 build script 是两个独立信任动作。
- 默认卸载移除应用和缓存，保留用户数据与外部 Workspace。

更多资料：
[0.6.3 发布说明](docs/RELEASE_NOTES_0.6.3.md) ·
[0.6.3 发布清单](docs/PUBLICATION_MANIFEST_0.6.3.md) ·
[产品](docs/PRODUCT.md) · [架构](docs/ARCHITECTURE.md) ·
[插件中心](docs/PLUGIN_CENTER.md) · [安全说明](SECURITY.md) ·
[0.6.3 验收增量](docs/0.6.3/ACCEPTANCE_DELTA.md)
