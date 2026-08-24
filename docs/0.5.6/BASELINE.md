# Penglai 0.5.6 Phase 0 baseline

Recorded before the first 0.5.6 source change. Local branch only. No push.

## Repository identity

| Field | Value |
|---|---|
| Workspace | `/Volumes/KevinSSD-in/macmini/PenglaiAgent` |
| origin | `https://github.com/kevinchennewbee/PenglaiAgent.git` |
| Other remotes present, unused | `fork` = `kevinchennewbee/GenericAgent`; `private` = `kevinchennewbee/penglai-new`; `upstream` = `lsdefine/GenericAgent` |
| Not this repo | `deepseek-ai/DeepSeek-Harness`, historical `penglai-v2`, any `GenericAgent` |
| Baseline branch | `main` at `d1f61ef61eb3d86f33a4d7e1c05a2137b36c7b22` |
| Baseline upstream | `origin/main`, up to date |
| Baseline worktree | clean; no Owner or other-agent uncommitted files |
| Working branch | `feat/0.5.6` created from that SHA; no upstream; do not push |

## 0.5.5 release and pins

| Field | Value |
|---|---|
| Product | Penglai 0.5.5 public-community-release |
| Tag | `v0.5.5` |
| DSH | `0.1.1-rc.2` / tag `dsh-v0.1.1-rc.2` / commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` |
| DSH integrity | `sha512-UP1UIh6q3Gme/yXRn/QL2P8IsVlv8Shpg22TRJIZPsCRWLm4CBiA1MUvXmJAfsOEETBMLAl+xWPtFw6ICsN3wg==` |
| Electron / Node | `43.4.0` / `22.22.2` |
| Catalog floor | public `plugin-catalog-v1.000006`; local trust ledger is monotonic and has no coded minimum-sequence constant yet |
| Required plugins | Office + Memory required-builtin; IM/ASR/TTS/Companion optional default-off |

## Source facts that differ from review leads

These were checked in current source before implementation, not taken from external reviews.

- Conversation composer draft is `text` + `imageIds`. Official `PromptContentPart` is `text\|image`. `@deepseek-ai/dsh-attachment` v1 is PNG/JPEG/WebP/GIF only.
- `DshAgentLike.followup/steer` in `packages/dsh-bridge/src/index.ts` already types user content as text or official image.
- Memory `list()` throws `SECURITY_POLICY` and tells callers to use `search()`. Status-page search-word lists are still a 0.5.6 defect.
- Companion already uses official `ctx.agents.create/resume` and `tools.guard`. Onboarding casts `tools: false as never`; that field is not in official `AgentOptions`.
- `GenerateOptions` in DSH 0.1.1-rc.2 has no `responseFormat` / `json_schema`.
- Update coordinator still needs the three-digest split (ADR 0038).
- Catalog trust ledger refuses sequence rollback, but 0.5.6 still needs an explicit minimum sequence of 6.

## Spike verdicts

| Spike | Verdict | Evidence |
|---|---|---|
| Ordinary file bound to official Turn | BLOCKED | `packages/dsh-bridge/src/r56-file-intake-spike.ts` |
| Memory Curator via official Agent | PARTIAL | official create + `tools.guard` GO; provider JSON schema BLOCKED; host schema GO |

Owner decision required for FILE composer scope. Phase 1 P0 work does not wait on that decision.
