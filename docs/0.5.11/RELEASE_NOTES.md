# Penglai 0.5.11 development notes

**This is not a public release.** Product identity, package versions and
installer names are **0.5.11**. There is no immutable `v0.5.11` GitHub Release
yet, so public download tables remain [Penglai 0.5.10](../RELEASE_NOTES_0.5.10.md).
Published **v0.5.10** tags and assets stay immutable.

## What this tree changes (source)

- Official DeepSeek Harness remains the only agent core. The frozen cohort is
  still npm `0.1.2-rc.1` / tag `dsh-v0.1.2-rc.1` / commit
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d` (254 packages). The GitHub tag
  `dsh-v0.1.3-alpha.1` is rejected until a complete npm cohort exists.
- Isolation and recovery repairs: Owner-peer IM gating, Office job
  Workspace/Session ownership, Memory policy-before-write, Center journal
  schema 3 / last-good, Windows NSIS pending-then-previous staging, plugin
  catalog prefer-newer-signed-remote with digest activation, onboarding
  snapshot resume and retryable credential errors.
- First-party workflows through official DSH slots: scoped Memory library
  query, Weixin/Feishu official question/approval identity, bounded text-PDF
  inspect plus digest-bound page preview, read-only usage projection, redacted
  Plugin Center diagnostics.
- Bilingual README and `website/` professional redesign. Download links still
  point at verified 0.5.10 assets.

## What this tree does not claim

- Apple Silicon / Intel Mac / Windows x64 0.5.11 installers.
- Notarization, Authenticode, or a new public SHA.
- Live Weixin, Feishu, or model-account proof.
- A Mnemon native upgrade. The pin remains `0.2.4` pending three-target
  evidence; see `MNEMON.md`.
- UOS/LoongArch as a supported platform.
- Enabling the Budget enforcement plugin merely to display usage.

## Source gates last captured on this dirty tree

`format:check`, `typecheck`, `test:unit` 905 pass / 1 skip, `test:contract` 134,
`test:integration` 64, `test:e2e` 87, `test:security` 15, `test:chaos` 5,
`test:soak` 1, `audit:secrets` ok. The Owner-excluded two-hour installed soak
was not added.

`verify:closure` / `verify:profile` are STALE because the packaged closure
source `d5f76361…` is not this HEAD. `verify:clean-clone` FAILs on the dirty
tree. `package:mac` refuses a dirty tree. Official `verify:office-real` and
`verify:memory-real` ran local helper probes then finished INCOMPLETE because
official PASS is forbidden while the working tree is dirty.

## 中文

这不是 0.5.11 公开发布说明。没有 `v0.5.11` 附件，也没有把产品身份改成 0.5.11
的授权。当前可下载版本仍是 0.5.10。本文只记录 `codex/0.5.11` 开发树已完成的
源码修复与第一方功能，以及明确未完成的三端安装包、真实账号和发布步骤。
