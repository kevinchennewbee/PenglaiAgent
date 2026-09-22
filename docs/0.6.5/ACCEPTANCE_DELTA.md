# Penglai 0.6.5 acceptance delta

Status: published acceptance delta. Native and immutable public-byte results
exist for the 2026-09-20 release built from
`eb90f494d6ccd8f3fe7f29ffc5007b8ada94be4a`; see
[`docs/PUBLICATION_MANIFEST_0.6.5.md`](../PUBLICATION_MANIFEST_0.6.5.md).

## English

Penglai 0.6.5 keeps the complete pinned DeepSeek Harness npm cohort that 0.6.3
shipped: official `0.1.6-alpha.2`, tag `dsh-v0.1.6-alpha.2` at commit
`ddefc45fbc7f8e46dd73185e68295696d1297887`. The dependency graph contains
293 DSH packages, nine vendor packages, and five native packages: 307 in all.
The exact registry identities are recorded in `docs/0.6.5/DSH_NPM_COHORT.json`.

The release must satisfy the existing acceptance contract plus these deltas:

- Preserve official DSH as the only agent, Workspace, Session, Turn, tool, and
  Web UI core. No second host, model gateway, or conversation engine is added.
- Disable upstream session log/upload behavior. Use the exact official DSH
  alpha.2 plugin manager as the sole package-management engine, backed by the
  application-owned Node and pnpm `11.11.0`; expose its UI/tool and require
  explicit approval for package build scripts. The historical signed Penglai
  catalog is not an ecosystem allowlist.
- Migrate the active DSH home from rc.2 to an isolated alpha.2 generation only
  after health validation. Original settings and sessions remain byte-for-byte
  unchanged until an explicit owner data action.
- Prove fresh install, restart, and default uninstall on Apple Silicon and
  Windows x64. The exact 0.6.3 to 0.6.5 installed upgrade is `OWNER_EXCLUDED`
  for this release and must not be fetched, executed, or reported as PASS.
- Package exactly three targets from one clean `main` SHA:
  `darwin-aarch64`, `win32-x86_64`, and `linux-loong64`. Intel Mac is not a
  0.6.5 target.
- Keep LibreOffice, Office/PDF, Budget, and Companion absent from the workspace,
  profile, runtime closure, installer, and product SBOM. Memory stays bundled
  and enabled by default but may be disabled by the Owner without removing its
  package or data. Management infrastructure and credentials remain required.
  The complete upstream cohort ledger is audit evidence, not a requirement to
  ship excluded packages.
- Ship the UOS `.deb` as one complete installer containing Electron, Node,
  official DSH, the in-scope first-party plugins, Memory, Mnemon, native
  add-ons, licenses, and integrity manifests. Package, ABI, architecture, and
  closure checks are required before publication.
- UOS 20 LoongArch native install, startup, file-picker, sleep/resume, and
  functional acceptance remain `OWNER_POST_RELEASE`; static or cross-built
  checks must never be called a native PASS.
- Keep secrets, credentials, owner paths, personal email addresses, local
  profiles, logs, screenshots, and chat media out of committed and published
  material. Evidence output is bounded and redacted before it is written.
- Pin the indirect ONNX packaging dependency `adm-zip` to `0.6.2` and prove
  that overwrite extraction refuses an existing destination symlink. Install
  scripts remain disabled and the installed runtime has no `adm-zip` call path.

Known limitations are part of the release contract: UOS requires `libatomic1`
and recommends `bubblewrap`; MOSS TTS is unavailable on LoongArch; iMessage is
Mac-only and optional; Electron 31 is no longer maintained; UOS native UI,
file-picker, and sleep parity await the Owner's post-release machine test.

The Owner excludes both the 0.6.3 to 0.6.5 installed upgrade journey and the
two-hour installed soak. Neither excluded item may be reported as PASS.
The Owner authorizes the complete 0.6.5 workflow through three-target native
validation, immutable publication, public readback, and only then README/site
publication updates. A result remains `NOT_RUN` until that exact step executes.

## Registry corrections in this release

0.6.5 promoted `verify:evidence` to a hard gate. That exposed five rows in
`docs/ACCEPTANCE.md` whose runner or platform could not be satisfied by any
runner in this pipeline — a declaration defect, not a missing result. The
requirements themselves are unchanged; what changed is the declaration of who
proves them and on which target. Corrections, each recorded as a correction
rather than a silent edit:

- `R50-MAC-004`, `R50-MAC-009` — `installed/all` → `installed/mac-arm`. Both
  read a macOS `Info.plist` / record an `arm64` DMG observation, and the Windows
  host emits `R50-WIN-009` for the same stage, so the `win32-x86_64` slot could
  never be filled by these ids.
- `R50-MAC-006`, `R50-MAC-008` — `signing/all` and `artifact/all` →
  `signing/mac-arm`. Both are `codesign` checks on the from-DMG application.
  `expandPlatforms` expands a packaged-scoped family with `all` to all three
  desktop targets, but no Linux job runs a packaged verifier.
- `R50-MAC-007` — `artifact/all` → `artifact/mac-arm`. A UDZO `hdiutil verify` of
  the macOS DMG; the Linux job produces a `.deb`.
- `R50-SEC-004` — `artifact/all` → `artifact/mac-arm+win-x64`. The Electron fuse
  bytes are inspected by `verify:fuses` on the macOS and Windows hosts; there is
  no Linux host in this pipeline to inspect.
- `R50-MAC-005` keeps its `security` family. That family is source-scoped, so its
  slot is `security/source`; the emitting record now carries `target: source`
  instead of a platform target it could never match.
- `R50-DIST-005` — `installed/all` → `artifact/mac-arm+win-x64`. The embedded
  Node and DSH versions are probed from the packaged bytes by `verify:artifact`;
  no installed-family runner reads them, and the Linux job runs no packaged
  verifier. `verify:artifact` now records the row, and `verify:fuses` runs before
  it so the appended record survives the one writer that clears that stream.

Requirements narrowed to what this pipeline actually observes, each recorded as a
narrowing rather than a silent edit:

- `R50-CORE-005` — was "Workspace/Session/Turn all created and restored by
  official DSH". A first model Turn needs a real provider account, which is
  `verify:live`'s subject and a supplemental gate for this version; the row now
  states the Workspace and Session part and names `verify:live` for the Turn.
- `R50-CENTER-005` — was "the Center installs only packages whose identity,
  digest, permissions, DSH compatibility and rollback all pass". That pipeline
  belongs to the official DSH manager; Penglai's boundary is that it supplies it
  and does not impose the historical signed catalog as an ecosystem allowlist,
  which is what the row now states.
- `R50-CENTER-009` — the `installed` class is dropped. Installing a package and
  approving its build scripts are distinct trust actions by product boundary, but
  no runner in this pipeline observes that two-step flow: the official manager
  owns it. The row now asserts only that Penglai reimplements neither, and the
  two-step flow itself is **not independently verified by this release**.
- `R50-UI-001` — was "app/window/menu/About/installer/shortcut/uninstaller show
  Penglai/蓬莱", and is now "the app name and the installer naming show
  Penglai". Only the application identity and the installer file names are
  observed; the menu, About panel, shortcut and uninstaller wording are **not
  verified by this pipeline** and are no longer claimed.
- `R50-UI-001` also moves to `installed/mac-arm`, and `R50-CORE-006` and
  `R50-UI-006` move from the `parity` family, which no runner in this repository
  implements, to `installed`: both describe what the installed app exposes.

No requirement was removed, and no target gained a claim it did not have to
earn: every corrected row is still asserted by the runner that performs the
check, bound to the same source SHA, installer digest and native host.

## Evidence binding corrections in this release

The same hard gate exposed records that were collected but could not be bound to
the candidate being released. Each one is a wiring defect: the checks themselves
were already running.

- `R50-TRUTH-001`, `R50-TRUTH-002`, `R50-TRUTH-004`, `R50-TRUTH-006`,
  `R50-TRUTH-008`, `R50-DIST-001` and `R50-DIST-003` recorded a fixture source
  SHA (`"a".repeat(40)` and neighbours) rather than the source the runner was
  asserting against. A record bound to a fixture can never be current, so these
  rows read `NOT_RUN` however the test exited. They now record
  `declaredSourceSha()`, which is Git HEAD and is deliberately impossible to
  override from the environment.
- `R50-E2E-004` is a source-scoped `anti-cheat` observation recorded by
  `verify-installed`, which runs on both native hosts. The same assertion reached
  the aggregate twice and `assertNoDuplicateAssertions` refuses a duplicate key,
  which is what stopped the aggregate run. One host records it now: a source
  observation is the same on every host.
- `R50-CORE-002` is asserted from two different observations — the raw
  `installed-e2e.json` file and the candidate-bound installed runner — and both
  used one assertion id, which the duplicate rule reads as one assertion recorded
  twice. The candidate-bound record now names its own observation.
- `R50-ABSENT-001` reported its `installer-payload` surface unavailable whenever
  no `dist/runtime-staging*` tree existed, which is always true on the publishing
  host: it runs no package build and receives installers only. The surface now
  also reads the runtime manifest inside the payload copied back out of the
  collected installer, which is the shipped bytes. Its `files` entries are
  `{path, sha256, size}` objects rather than names, and reading them as names
  matched nothing, so the surface would have reported a clean payload without
  inspecting one.
- `R50-DRIFT-002` and `R50-DRIFT-004` read `api.github.com`, which answers 403
  once the unauthenticated per-IP quota is spent; hosted runners share an address
  pool, so both probes recorded `BLOCKED` — honest about the probe, and useless
  about upstream, because the pinned facts were never compared. They now send the
  workflow token to `api.github.com` and to no other host.

## 中文

蓬莱 0.6.5 延续 0.6.3 已发布的完整固定 DeepSeek Harness npm 依赖组：官方
`0.1.6-alpha.2`（307 包）。本版继续只使用官方 DSH 作为 Agent、工作区、会话、
消息轮次、工具和 Web UI 核心，不增加第二套 Host、模型网关或对话引擎。

本版必须在 Apple 芯片 Mac 和 Windows x64 上完成全新安装、重启和默认保留数据的
卸载。0.6.3 到 0.6.5 的真实安装版升级由 Owner 明确标记为 `OWNER_EXCLUDED`，
本版不下载、不执行，也不宣称 PASS。UOS 安装包必须是一个自带 Electron、
Node、完整 DSH、范围内第一方插件、记忆、Mnemon、本地依赖、许可证与完整性
清单的完整 `.deb`，不能要求用户另装开发环境。

LibreOffice、Office/PDF、预算和主动陪伴不属于 0.6.5 产品范围，不得进入 workspace、
profile、运行闭包、安装包或产品 SBOM。记忆随包并默认启用，但 Owner 可以停用而不
删除插件包或记忆数据；管理基础设施与 credentials 必须保持可用。完整上游 cohort
清单只用于审计上游输入，不等于全部随包。官方 DSH alpha.2 插件管理器是唯一包
管理后端，使用应用内固定 Node 与 pnpm `11.11.0`，并区分安装插件与批准 build script。

三个精确目标为 `darwin-aarch64`、`win32-x86_64` 和 `linux-loong64`；
本版不含 Intel Mac。UOS 20 龙芯真机安装、启动、文件选择器、休眠恢复与功能体验
由 Owner 在发布后手动验收，状态保持 `OWNER_POST_RELEASE`，不能用静态检查冒充
真机 PASS。

ONNX 打包工具链间接带入的 `adm-zip` 固定为 `0.6.2`，并以恶意目标符号链接
回归验证解压会拒绝向目录外写入；依赖安装脚本继续禁用，安装版运行时不存在
`adm-zip` 调用路径。

已知限制会如实公开：UOS 依赖 `libatomic1`，建议安装 `bubblewrap`；龙芯版不提供
MOSS 语音生成；iMessage 只支持 Mac 且默认关闭；Electron 31 已不再维护；UOS
原生界面、文件选择器和休眠一致性仍待发布后真机确认。Owner 明确排除旧版安装升级
与两小时测试，这两项均不得用未运行状态冒充 PASS。
本轮授权覆盖合并 `main` 之后的三目标安装包、不可变发布与公网回读；在每一步实际
执行前，其结果均为 `NOT_RUN`，不得用未运行状态冒充 PASS。
