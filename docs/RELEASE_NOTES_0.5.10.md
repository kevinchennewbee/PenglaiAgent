# Penglai 0.5.10

Penglai 0.5.10 uses the unmodified official DeepSeek Harness `0.1.2-rc.1` npm packages, fixed to tag `dsh-v0.1.2-rc.1` and commit `a66e4702047846cdaa10c66c9d3df3951f5ea70d`. DSH remains the only agent core. Penglai supplies the desktop application, onboarding, local data lifecycle and bundled plugins.

## Changes

- Message recovery, budget reconciliation and Companion replay now read the official Session snapshot API. A missing API produces an explicit compatibility error.
- The complete 254-package upstream cohort is pinned and verified against official registry archives, registry signatures and fixed-source manifests, including optional peer dependencies.
- Upgrades from both 0.5.8 and 0.5.9 prepare a separate rc.1 DSH Home, switch only after required runtime/plugin health checks, and preserve the previous generation for rollback.
- Speech verification now disposes native workers and model resources before returning an error.
- Publication requires the complete ten-file signed release set. All draft assets are downloaded and verified before publication, and their identities are checked again immediately before the draft becomes public. The signed update sequence is 6.

## Downloads and verification

Apple Silicon, Intel Mac and Windows x64 installers were built on matching native hosts from the same clean main commit: `c5c0bcb022c5ae47cca242deb27fe1d30444c41d`.

[Native build and installed checks](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33775824578) cover installed startup, credential-free onboarding/recovery, bundled plugin modes, both upgrade paths and default uninstall with user data preserved. Source CI covers the upstream cohort, type and contract checks, integration, desktop regression, security, actual Office/Memory/ASR/TTS operations and clean-clone installation/build.

The assets below include three installers, `SHA256SUMS`, a signed update manifest and its detached signature, a release manifest, the three-target CycloneDX SBOM, third-party notices and the public source export manifest. Check the downloaded installer against `SHA256SUMS` before running it.

Office and Memory start enabled. Messaging, speech recognition, voice generation and Companion start disabled. Voice model weights download only after an explicit user action. The signed Plugin Center retains its reviewed catalog and does not accept arbitrary packages.

## Known boundaries

macOS is ad-hoc signed and **not notarized**. Windows has **no Authenticode**. Penglai's Ed25519 signatures establish content integrity, not Apple or Microsoft publisher trust. Updates require user confirmation.

Credential-free automated checks do not prove an external model response or private messaging delivery. Account-based journeys are reported only when actually run. WhatsApp is not displayed, supported or bundled. The immutable 0.5.9 release's missing metadata has not been retroactively replaced; 0.5.10 supplies a complete release set.

## 中文

蓬莱 0.5.10 使用未经修改的官方 DSH `0.1.2-rc.1` npm 包，固定上游标签与提交见上方。DSH 是唯一 Agent 核心，蓬莱负责桌面发行、安装引导、本地数据生命周期和内置插件。

- 消息恢复、预算结算、主动陪伴回放适配官方 Session 快照接口；缺少接口时明确报错。
- 完整固定并验证 254 个上游包，包括归档字节、registry 签名、固定源码 manifest 和可选间接依赖。
- 0.5.8、0.5.9 均可升级：独立准备 rc.1 数据目录，必需运行时与插件健康检查通过后才切换，保留旧代际用于回退。
- 语音验证在失败退出前正确释放原生 worker 和模型资源。
- 正式发布要求十项完整附件，先下载并校验草稿全部字节与签名，公开前再次核对附件身份。签名更新序号为 6。

Apple Silicon、Intel Mac、Windows x64 均在对应原生环境从同一个干净 main 提交 `c5c0bcb022c5ae47cca242deb27fe1d30444c41d` 构建。安装版检查覆盖启动、无凭据引导与恢复、内置插件组合、两条升级路径，以及默认保留用户数据的卸载。源码 CI 另行验证上游包组、类型与契约、集成、桌面回归、安全、真实办公/记忆/语音操作和干净克隆构建。

办公与记忆默认开启；消息、语音识别、语音生成、主动陪伴默认关闭，模型权重由用户主动下载。请核对 `SHA256SUMS` 后运行安装器。macOS 未公证，Windows 无 Authenticode；蓬莱签名不代表 Apple 或 Microsoft 发布者认证，更新必须由用户确认。

无凭据自动检查不代表真实模型回复或私密消息送达，账号旅程仅按实际执行结果报告。WhatsApp 不展示、不支持、不捆绑。0.5.9 历史不可变发布缺少元数据的问题未通过改写旧附件掩盖；0.5.10 提供完整发布附件。
