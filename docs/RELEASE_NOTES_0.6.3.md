# Penglai 0.6.3 release notes

Status: `PUBLIC_READBACK_PASS`. The immutable `v0.6.3` Release was published
from `1c103212ad25b7d2a0061c2c4bfa595cd413c138`; all ten public assets passed
post-publication byte, SHA-256, update-signature, and installer-signature
readback.

## English

Penglai 0.6.3 moves the desktop distribution from official DeepSeek Harness
0.1.5-rc.2 to the exact `0.1.6-alpha.2` cohort: tag
`dsh-v0.1.6-alpha.2`, commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`, and 307 source-cohort packages
with registry integrity.

The main compatibility work is Session ownership and alpha.2 client/runtime
contracts. Memory provenance, onboarding final-message proof, and IM
recovery/deduplication use official asynchronous Session Controller inspection.
First-party browser Remote codecs use the alpha.2 `codec.create()` contract.
DSH Home activation is isolated by generation and switches only after
validation.

The alpha.2 DeepSeek adapter advertises `deepseek-flash` /
`DeepSeek-V41-Flash` for the supported `text,image` route. Penglai keeps the
one official DSH host and does not add a parallel agent executor.

Penglai 0.6.3 intentionally excludes LibreOffice, Office/PDF, Budget, and
Companion from the product runtime, profile closure, installer staging and
product SBOM. Memory is bundled and enabled by default but may be disabled by
the Owner without deleting its package or data. Mobile Messaging is installed
and active while every adapter/account remains unconfigured until connected.
ASR and MOSS-TTS are bundled but disabled by default; model weights are
separate pinned downloads. MOSS-TTS is unavailable on UOS LoongArch.

Package management uses the exact official DSH alpha.2 plugin manager as the
sole mutable profile backend. Penglai provides application-owned Node 22.23.2
and pnpm 11.11.0. Installing a package and approving its build scripts remain
separate explicit trust actions. The historical signed Penglai catalog is not
an ecosystem allowlist.

Native publication validation completed on the same source SHA:

- Apple Silicon: exact DMG, closure/artifact/profile, full installed onboarding,
  welcome/process, first-party compatibility, fresh install → restart → default
  uninstall.
- Windows x64: exact NSIS installer, closure/artifact/fuses/signing, complete
  profile matrix, Simplified Chinese installer UI, full installed onboarding,
  first-party compatibility, fresh install → restart → default uninstall.
- UnionTech UOS 20 LoongArch: exact `.deb`, package identity, ABI, runtime,
  architecture and full closure.

The exact `0.6.2 → 0.6.3` installed-upgrade journey and the two-hour installed
soak are `OWNER_EXCLUDED` and are not claimed as PASS. UOS real-machine
acceptance remains `OWNER_POST_RELEASE`. macOS is ad-hoc signed and not notarized;
Windows has no Authenticode.

Authoritative downloads and exact public hashes are recorded in
[`PUBLICATION_MANIFEST_0.6.3.md`](PUBLICATION_MANIFEST_0.6.3.md) and the
immutable [`v0.6.3` Release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3).

## 中文

Penglai 0.6.3 将桌面发行版从官方 DeepSeek Harness 0.1.5-rc.2 升级到精确的
`0.1.6-alpha.2` cohort：固定 tag `dsh-v0.1.6-alpha.2`、commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`，并锁定带 registry integrity 的
307 个源码 cohort 包。

本版主要完成 Session 所有权、alpha.2 浏览器 client/Remote 契约和运行时适配。记忆
来源证明、首次引导终态，以及 IM 恢复/去重改用官方异步 Session Controller；第一方
浏览器 Remote codec 改为 alpha.2 的 `codec.create()` 契约；DSH Home 按 generation
隔离并在验证完成后才切换。

0.6.3 明确不包含 LibreOffice、Office/PDF、预算或主动陪伴。记忆随包且默认启用，
Owner 可以关闭而不删除包或数据；手机消息插件已安装并 active，但通道与账号在用户
连接前保持未配置。ASR 与 MOSS-TTS 默认关闭，模型权重按固定版本另行下载；UOS 龙芯
不支持 MOSS-TTS。

插件管理只使用官方 DSH alpha.2 manager 作为唯一 mutable profile 包管理后端，使用
应用内 Node 22.23.2 / pnpm 11.11.0。安装插件和批准 build script 是两个独立的显式
信任动作，历史签名目录不再是整个插件生态的 allowlist。

同一源码 `1c103212ad25b7d2a0061c2c4bfa595cd413c138` 上完成了三端发布验证：
Apple 芯片通过 DMG、完整安装态引导、第一方插件兼容、全新安装→重启→默认卸载；
Windows x64 通过 NSIS、closure/artifact/fuses/signing、简体中文安装器 UI、完整安装态
引导、第一方插件兼容、全新安装→重启→默认卸载；UOS 龙芯 `.deb` 通过包身份、ABI、
运行时、架构与完整闭包。

`0.6.2 → 0.6.3` 真实安装版升级和两小时安装版 soak 均为 `OWNER_EXCLUDED`，本版不
宣称这两项 PASS。UOS 真机验收仍为 `OWNER_POST_RELEASE`。macOS 未公证，Windows
无 Authenticode。

权威下载、十附件大小和 SHA-256 见
[`PUBLICATION_MANIFEST_0.6.3.md`](PUBLICATION_MANIFEST_0.6.3.md) 与不可变
[`v0.6.3` Release](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3)。
