# Penglai 0.5.11 development security notes

Public supported-version and trust-tier statements remain those in
[`SECURITY.md`](../../SECURITY.md) and [`docs/SECURITY.md`](../SECURITY.md) for
**0.5.10**. This file records security work on the `codex/0.5.11` development
branch. It does not extend the supported-version table to 0.5.11.

## Still in force

- Official DSH is the only agent core. No parallel host, provider gateway, or
  second conversation engine.
- Plugin Center accepts only signed catalog artifacts with exact identity,
  digest, permission, DSH compatibility and rollback checks.
- Workspace, Session, account and IM-route isolation. Memory must not leak
  across Workspaces.
- Office writes, exports and returns require action-specific owner confirmation.
- Credentials, chat bodies, QR payloads and private absolute paths must not
  enter Git, diagnostics, evidence or screenshots.
- macOS remains ad-hoc sealed and not notarized; Windows has no Authenticode.
  Those facts do not change because this branch exists.

## Development-tree repairs that affect the security boundary

- Unapproved private IM senders are rejected before route binding or DSH
  submit on the six SDK channels. Weixin/Feishu keep the official-identity path.
- Office job identifiers are checked for Workspace/Session ownership on
  preview, accept, discard, approval, commit and undo.
- Destructive path operations re-validate ancestor/canonical identity.
- Windows helper no longer reaps supervisors by executable path across
  instances; Darwin orphan cleanup is data-root scoped.
- Memory candidates are policy-checked before materialization; rejected
  personal promotion stays pending.
- Context PDF/OOXML decompression is budgeted before allocation.
- Secret scanner URL/detector exemptions no longer hide credentials.
- Center journal schema is shared between writer and preboot recovery.
- Weixin blocked receive keeps the previous vendor cursor in memory and does
  not persist it; CDN fetch uses a 30s timeout.
- Plugin activation hashes the staged tarball bytes, not the declared package
  hash.
- Diagnostic export redacts credentials, chat, QR, account identifiers and
  private paths.
- Usage projection is read-only and must not enable Budget enforcement.

## Known open security evidence

- No live IM or model-account observations in this session.
- No signed newer first-party catalog artifact was installed.
- Windows native helper, NSIS activation and special-character Memory paths
  were not executed on Windows.
- Dirty working tree forbids official Office/Memory PASS and packaging.

Vulnerability reporting remains the public `SECURITY.md` process. Do not file
secrets, QR payloads or chat bodies in GitHub issues.

## 中文

公开安全合同仍以 0.5.10 的 `SECURITY.md` 为准。本文只记录 0.5.11 开发分支上已
落地的隔离、恢复和诊断修复，以及尚未取证的 Windows 原生、真实账号和签名目录
安装。不要把开发分支写成已支持的公开发布版本。
