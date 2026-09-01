# Penglai 0.5.9 release TODO / 蓬莱 0.5.9 发布清单

This file tracks the exact remaining work for the `0.5.9-preview` candidate.
Checked items require current evidence; historical 0.5.8 or earlier evidence is
never reused.

本文件跟踪 `0.5.9-preview` 候选的精确剩余工作。勾选项必须有当前证据，绝不
复用 0.5.8 或更早版本的历史证据。

## Source freeze / 源码冻结

- [x] Pin the exact official npm alpha cohort: DSH `0.1.2-alpha.2`, upstream
  commit `0a53fb55bea101816fa226bb964ae2bed71c343b`, 257 packages with integrity.
- [x] Move release identity, dependency graph, lockfile, runtime closure,
  profile, first-party plugins, and Plugin Center together.
- [ ] Close every P0/P1 finding from the independent architecture, security,
  supply-chain, and release-evidence reviews.
- [ ] Pass the full local source suite on a clean `0.5.9-preview` HEAD.
- [ ] Open and review the PR, then merge it to `main` without rewriting history.

## Exact native candidates / 精确原生候选

- [ ] Freeze one clean `origin/main` SHA for all three targets.
- [ ] Build Apple Silicon, Intel Mac, and Windows x64 installers from that SHA.
- [ ] On every matching native runner, pass closure, artifact, fuses, community
  signing contract, full Profile/plugin matrix, installed E2E, welcome/plugin
  compatibility, real 0.5.8 upgrade, and default uninstall.
- [ ] Aggregate three target-bound evidence sets and reject missing, copied,
  stale, wrong-host, wrong-installer, or mixed-SHA evidence.
- [ ] Report any supplemental long-running or Owner-account acceptance that was
  actually collected; absence is visible but does not block publication.

## Publication / 发布

- [ ] Create a mutable draft `v0.5.9` bound to the exact final `main` SHA and
  upload only the three already-verified installers.
- [ ] Assemble the exact ten-asset contract after binding installer hashes,
  source SHA, public-export tree, SBOM, notices, and updater signatures.
- [ ] Publish once, then read back the immutable tag, Release, exact asset set,
  sizes, hashes, signatures, and embedded source identity from public bytes.
- [ ] Only after successful public readback, update README, website, bilingual
  release notes, and download observations; deploy only from exact `main`.
- [ ] Re-read the public site and downloads and record the final result.
