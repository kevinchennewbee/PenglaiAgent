# Penglai 0.5.7 implementation plan

Status: contract freeze. This file is the executable development contract for
branch `0.5.7`. Historical 0.5.6 documents stay unchanged.

## Baseline recorded 2026-08-25

| Field | Value |
|---|---|
| Public repository | `kevinchennewbee/PenglaiAgent` |
| Independent worktree | `E:\PenglaiAgent-0.5.7` (clone of public `main`; the `gh-pages` website checkout is not used for product work) |
| Development branch | `0.5.7` |
| Merge target | `main` |
| Base SHA | `3102135c6821a044fe4f9b50638c91ce9f5e9cd1` |
| Base tag | `v0.5.6` at `75bbd591c61b757dfe015e54e40ad21ccf9ab94b` (`main` is three evidence/readback commits ahead of the tag) |
| Worktree at branch creation | clean |
| Official DSH | `0.1.1-rc.2` / tag `dsh-v0.1.1-rc.2` / commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| npm `latest` | `0.1.1-rc.2` |
| npm `next` | `0.1.1-rc.2` |
| DSH default branch vs tag | not ahead of `dsh-v0.1.1-rc.2` at freeze |
| DSH-IM audit pin | `v2.4.0` / peeled `7211534aeff01dba4ab78c79a5fa31cb9fa9510f` / unsigned annotated tag |
| Remote `0.5.7` at freeze | absent |

Re-verify DSH GitHub tags, npm dist-tags, and Penglai lockfile/overlay consistency before merge.

## Product target

0.5.7 is three things in one version:

1. Selectively reimplement audited DSH-IM channel capability into the single
   `@penglai/im` plugin.
2. Replace the engineering IM UI with ordinary “消息连接 / Messaging” platform
   cards.
3. Close Penglai-owned 0.5.6 audit findings (Owner Broker, IPC, Artifact/Office,
   Plugin Center last-good, profile seed, supervisor, Recovery CSP, IM
   idempotency, Windows uninstall helper path, SBOM completeness).

Nine platforms must have a real connection entry: Weixin, Feishu, DingTalk,
WeCom, QQ, Slack, Telegram, Discord, WhatsApp. The last seven are no longer
roadmap copy. “Supported” requires live evidence named in
`LIVE_IM_MATRIX.md`. Missing evidence is `LIVE_NOT_RUN` or `LIVE_BLOCKED`, never
a mock PASS.

## Boundaries that do not move

- Official DeepSeek Harness is the only agent core. Do not follow unreleased DSH
  branches. Do not modify the DSH agent loop, model system, session engine, or
  tool-approval system. Do not add a second agent host, model gateway, or chat
  UI.
- Do not install whole DSH-IM. Do not copy `lib/`, `bin/`, `cordis.patch.yml`,
  the DSH-IM harness client/agent preset/session binding, its independent
  config store, or its Office implementation.
- Users see one Messaging plugin. Internal channel packages are not nine user
  plugins.
- Adapters authenticate, send/receive, report health, and convert media. They
  never call another model or keep a second session.
- Every channel defaults off. WhatsApp stays experimental, community-protocol,
  default-off, and requires an explicit risk acknowledgement.

## Identity template

Committed `release-info.json` uses `phase=UNFROZEN`, `sourceSha=NONE`, and
`committedIdentity=template`. That is the only honest source identity: a file
cannot contain its own future commit SHA. Candidate builds stamp the real Git
SHA into evidence. README, website, and publication manifests receive observed
SHA/size/hash only after public readback. Do not invent those values.

`imSchema` remains 3 at this freeze. The IM Core commit increments the product
schema to 4 with staging/validate/atomic-swap/last-good migration.

## Commit order

Each commit must compile on its own. Do not skip tests to keep CI green.

1. `docs: freeze 0.5.7 contracts and upstream provenance` — this commit
2. `refactor(im): introduce channel adapter v2 and migration`
3. `feat(im): complete DingTalk WeCom and QQ QR channels`
4. `feat(im): add Slack Telegram and Discord live adapters`
5. `feat(im): add opt-in WhatsApp device-link adapter`
6. `feat(im-ui): replace engineering tabs with platform cards`
7. `fix(security): close owner broker and IPC authority gaps`
8. `fix(reliability): make profile plugin and messaging recovery transactional`
9. `fix(distribution): repair uninstall SBOM and native evidence gates`
10. `docs(site): prepare README website and 0.5.7 release material`
11. `test: close 0.5.7 source native installed and live matrices`

## Grok Build stop line

Push `0.5.7`, open a Draft PR to `main`, and stop. Do not merge, tag `v0.5.7`,
publish a GitHub Release, deploy `gh-pages`, or delete the branch. Codex reviews
before any public release.
