# Penglai 0.5.9 release runbook / 蓬莱 0.5.9 发布手册

This runbook is additive to `docs/0.5.7/RELEASE_RUNBOOK.md`. It does not alter
the immutable 0.5.8 Release or permit preview bytes on public surfaces.

本手册是 `docs/0.5.7/RELEASE_RUNBOOK.md` 的增量，不修改不可变的 0.5.8
Release，也不允许把预览字节提前放到公开页面。

## 1. Freeze preview source / 冻结预览源码

1. Verify remote identity, `0.5.9-preview`, clean worktree, and exact upstream
   alpha.2 cohort.
2. Run frozen install, formatting, type, unit, contract, integration, E2E,
   security, chaos, dependency, license, secret, source replay, Profile,
   Office-real, Memory-real, ASR-real, MOSS-real, and clean-clone gates.
3. Close all P0/P1 review findings. Open the PR and merge only reviewed bytes.

## 2. Freeze one main SHA / 冻结同一个 main SHA

1. Record the exact clean `origin/main` SHA after merge.
2. Dispatch the native workflow from `refs/heads/main`; every job must assert
   `GITHUB_SHA == origin/main`.
3. Build Apple Silicon, Intel Mac, and Windows x64 without reusing an older
   installer or evidence file.

## 3. Native and installed proof / 原生与安装后证明

For each target, require closure, artifact, fuses, signing contract, Profile
matrix, installed onboarding, reconnect, required plugin health, two-hour soak,
and target-specific supply-chain inventory. Then download the immutable 0.5.8
installer, verify its public SHA256SUMS, perform a real upgrade to 0.5.9, boot
the upgraded product, run default uninstall, and prove isolated Owner data was
preserved. Aggregate all three targets and reject a mixed source SHA.

## 4. Owner live proof / Owner 真实在线证明

Use no-echo credential entry. Evidence must contain no credential, prompt,
response, account identifier, chat media, local path, or private diagnostics.
Generate only redacted runner records with per-run UUIDs, bounded timestamps,
random challenge digests, event/result digests, and the exact runner-file hash.
The release aggregate is assembled from those files; a hand-written boolean
summary is not accepted. Prove:

- official DSH provider nonce Turn and first user Turn;
- authentication, inbound private text, bound official Workspace/Session,
  outbound reply, restart restore, and safe logout for Weixin, Feishu,
  DingTalk, WeCom, QQ, Slack, Telegram, and Discord;
- binding to the final source SHA and all three native installer hashes.

## 5. Draft, assembly, and publication / 草稿、组装与发布

1. Create draft `v0.5.9` with `target_commitish` equal to the final main SHA.
2. Upload only the three verified installers.
3. Assemble the exact ten-asset contract with the three-target SBOM/notices,
   public-export manifest, release manifest, updater signature, and checksums.
4. Run the complete hard release aggregate. Do not publish an INCOMPLETE,
   STALE, BLOCKED, or FAIL result.
5. Publish once. Read back the peeled tag, immutable Release, exact asset set,
   sizes, hashes, updater signature, and installer-embedded identity.

## 6. Post-readback public update / 公开回读后的页面更新

Only after immutable readback, make a publication-only commit updating README,
English/Chinese release notes, publication manifests, and both website pages.
Deploy from current main with read-only verification first and narrowly scoped
write permission second. Re-read the public site and all three download links.
