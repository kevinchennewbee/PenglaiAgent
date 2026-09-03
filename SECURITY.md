# Security Policy

Penglai 0.5.10 is a **community-verified** desktop distribution of official DeepSeek Harness (DSH). This file is the public security entry. The full product contract lives in [`docs/SECURITY.md`](docs/SECURITY.md).

## Supported versions

| Version | Status |
| --- | --- |
| 0.5.10 | Current immutable public release |
| 0.5.8 and 0.5.9 | Historical releases; native upgrades to 0.5.10 verified on all three targets |
| Earlier 0.5.x | Historical releases; use the documented migration path |
| 0.4.1 and earlier | Unsupported; 0.5 does not silently import or delete old secrets or databases |

The 0.5.10 release contains all ten files in its release contract, including
signed update metadata, SHA256SUMS, the three-target SBOM and third-party notices.
The immutable 0.5.9 release contains only its three installers; its missing
metadata is a historical publication defect. Do not infer signed updater
coverage for that release from its installer availability. The published 0.5.9
assets have not been changed.

## Trust tier

- macOS: ad-hoc sealed, **not notarized**, no Developer ID.
- Windows: **no Authenticode**.
- Penglai Ed25519 signatures protect installer and updater integrity. They are **not** Apple or Microsoft publisher trust.
- First launch may show an OS reputation warning. Penglai will not tell users to turn off Gatekeeper or SmartScreen.
- There is **no silent auto-update**. Later 0.5.x upgrades are signed assisted upgrades that the user must confirm.

## Secrets and local data

API keys, Weixin tokens, and Feishu App Secrets are stored only through the official DSH credentials seam in an app-private YAML file. The renderer never reads plaintext secrets.

On macOS the credentials directory/file use 0700/0600. On Windows they use a current-user ACL. A local process running as the same OS user may still read the YAML. That is an accepted boundary, not Keychain or hardware isolation.

0.4.1 credentials and databases are not read, imported, or deleted.

Official DSH 0.1.2-rc.1 bundles a session-telemetry adapter and a configured DeepSeek
OTLP endpoint. Penglai does not operate that backend and does not rely only on
the adapter's default mode: the owned DSH child receives
`DSH_TELEMETRY_DISABLED=1` from a closed environment allowlist. DSH applies that
disable after profile patches and constructs no telemetry SDK provider or upload
pipeline.

## Instant messaging risk

`@penglai/im` is the only IM plugin. Eight platforms have connection entries.
Adapters cannot call a parallel Agent. `docs/0.5.7/LIVE_IM_MATRIX.md` preserves
historical account-test requirements; it does not establish current-version live
results. Current account journeys are claimed only with current evidence. Slack,
Telegram, and Discord do not fake QR.
WhatsApp is not displayed, supported, planned, or bundled in 0.5.10.

- Weixin: real QR login. The scanner is the only allowed identity unless the user expands the allowlist.
- Feishu: the official application-registration QR flow is used where available, with manual App ID/Secret setup as a fallback. Penglai does not host the application or invent a login QR.
- Both channels accept private text, supported images, files, and audio. Images use the official DSH image path; non-image bytes use Workspace/Session-scoped opaque artifacts. Group chat, video, and unsupported rich content are rejected before they reach the model.
- Route binding is explicit Workspace/Session. Focus, recency, or “any agent” guesses are not used.

QR payloads, chat bodies, and identities must never appear in Git, logs, diagnostics, evidence, or screenshots.

## Reporting a vulnerability

Use GitHub's private
[`Report a vulnerability`](https://github.com/kevinchennewbee/PenglaiAgent/security/advisories/new)
flow. Do not open a public issue that contains secrets, QR images, chat text,
owner paths, or updater private keys.

Please include:

- Penglai version and platform (`macos_aarch64`, `macos_x64`, or `windows_x64`)
- Whether the build is the publication candidate
- Reproduction without real API keys or account material
- Impact on credentials, IM routing, update/uninstall, or Electron hardening

If a real credential may have leaked, rotate it immediately and say so in the report. Do not attach the secret.

## What this project will not claim

Penglai will not claim notarization, Authenticode, App Store trust, silent auto-update, zero-config Feishu, or “absolute security”.

## 中文

当前正式版本为 0.5.10，使用固定的官方 DSH `0.1.2-rc.1` npm 包。
Apple Silicon、Intel Mac 和 Windows x64 均验证从 0.5.8、0.5.9 升级并在默认
卸载后保留用户数据。旧版 DSH Home 保留，rc.1 在独立目录通过健康检查后启用。

0.5.10 的正式发布包含十项完整附件，包括签名更新清单、校验和、三端 SBOM 与
第三方声明。0.5.9 历史发布只有三个安装包，缺少元数据属于当时的发布缺陷；
不能据此声称该版签名更新链路完整。原有不可变附件未被修改。

macOS 为社区 ad-hoc 签名、未公证；Windows 无 Authenticode。蓬莱 Ed25519
签名保护字节完整性，不等于 Apple 或 Microsoft 发布者认证。更新必须由用户确认。

密钥由官方 DSH 保存在应用私有 YAML 中，受文件权限或当前用户 ACL 保护；
这不是 Keychain 或硬件隔离，同一操作系统用户下的进程仍可能读取。蓬莱启动的
DSH 强制禁用官方遥测管线；模型调用仍会把任务需要的上下文发送给用户选择的
供应商。插件与 DSH 共享进程权限，签名目录不是操作系统沙箱。

外部模型与消息账号只报告实际执行的验证，无凭据自动检查不代表真实回复或消息
送达。WhatsApp 不展示、不支持、不捆绑。发现漏洞请使用上面的私密报告入口，
不要把密钥、扫码内容、私人消息或本地资料放进公开 issue。
