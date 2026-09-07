# Penglai 0.5.11 acceptance delta

This delta is for Penglai **0.5.11**. It does not replace
`docs/0.5.10/ACCEPTANCE_DELTA.md`. Published **v0.5.10** tags and assets stay
immutable.

Public README/website download tables remain **0.5.10** until immutable
`v0.5.11` GitHub Release bytes exist and are read back.

## In scope for this development tree

- Identity and recovery repairs listed in `TODO.md` A/B/C rows.
- First-party Memory library query, official Weixin/Feishu request identity,
  digest-bound PDF inspect/preview, read-only usage projection, and redacted
  Plugin Center diagnostics.
- Bilingual README and `website/` professional redesign that still points
  current downloads at 0.5.10.
- Deterministic source gates. Owner excludes the two-hour installed soak.
  `test:soak` remains required.

## Out of scope until separately evidenced

- Native Apple Silicon / Intel Mac / Windows x64 rebuilds from a clean `main`
  SHA.
- Live model/IM account observations.
- Immutable GitHub Release `v0.5.11` assets.
- UOS/LoongArch as a fourth official target.
- A second Agent core, mixed DSH generations, or enabling Budget enforcement
  merely to show usage.

## Cohort freeze (development)

Exact identities are in `COHORT_FREEZE.json` and must match
`packages/release-identity/src/pins.ts` plus `release-contract.json`.

- Official DSH remains npm `0.1.2-rc.1`, tag `dsh-v0.1.2-rc.1`, commit
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d`, 254-package cohort.
- `dsh-v0.1.3-alpha.1` is rejected as a successor until a complete npm cohort
  exists. Mixed DSH generations are forbidden.
- Product identity, package versions, `release-contract.json` and installer
  names are **0.5.11**. Published **v0.5.10** remains immutable. README and
  website download claims stay on 0.5.10 until public 0.5.11 bytes exist.
- Migration/rollback: preserve the previous DSH Home generation and switch the
  pointer only after health checks; Plugin Center restores last-good profile;
  Windows upgrade stages `$INSTDIR.pending` and restores `$INSTDIR.previous`.

## Conditional records

- Light workbench: only official DSH slots; see `WORKBENCH.md`.
- UOS/LoongArch: feasibility only; see `UOS.md`.
- Mnemon native: retain `0.2.4`; see `MNEMON.md`. Successor `0.2.7`/`0.2.8`
  is not consumed without three-target assets and Windows path/old-db evidence.

## Development documentation

These files are development records, not a public 0.5.11 announcement:

- [Requirement review](REQUIREMENT_REVIEW.md)
- [Development release notes](RELEASE_NOTES.md)
- [Security notes](SECURITY.md)
- [Upgrade design](UPGRADE.md)
- [Memory curator API](MEMORY_CURATOR.md)

Public `SECURITY.md` and `docs/RELEASE_NOTES_0.5.10.md` stay on 0.5.10.

## Remaining publication blockers

- In-scope source is on `codex/0.5.11` / PR 133. Owner `AGENTS.md` /
  `docs/0.5.7/RELEASE_RUNBOOK.md` stay uncommitted.
- Darwin-aarch64 local candidate DMG exists for `d7f20c7e` (ad-hoc, not
  notarized). Intel Mac and Windows x64 matching-native builds do not.
- Installed fresh/restart/Back/retry/upgrade/uninstall evidence is unrun.
- No live model/IM credentials in this session.
- No merge to `main` and no GitHub Release authorization for 0.5.11.

## 中文

本增量只约束 `codex/0.5.11` 开发树，不授权公开发布，也不改写 0.5.10。官方 DSH
仍固定 `0.1.2-rc.1` 完整 npm 队列。源码层隔离、恢复、记忆库、微信/飞书请求身份、
PDF 正文/预览、只读用量和插件诊断已在本树落地；三端安装包、已安装生命周期、
真实账号和 GitHub Release 仍未取证。Mnemon 保留 `0.2.4`。公开身份仍是 0.5.10。
