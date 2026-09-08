# Penglai 0.5.12 acceptance delta

This delta is for Penglai **0.5.12**. It does not replace
`docs/0.5.11/ACCEPTANCE_DELTA.md` or `docs/0.5.10/ACCEPTANCE_DELTA.md`.
Published **v0.5.10** and **v0.5.11** tags and assets stay immutable.

The 0.5.11 development-tree acceptance delta is a **historical snapshot**.
Final published ruling: **v0.5.11** from source SHA
`77e7105773b4d43abb7315ea6e83abe17e646cb4` on 2026-09-07; see
`docs/PUBLICATION_MANIFEST_0.5.11.md`. Live website origin readback is
recorded from `main` `87f6aec04b2b77d45a5c2b280d1b75332a80eb33`.

Public README/website download tables remain **0.5.11** until immutable
`v0.5.12` GitHub Release bytes exist and are read back.

## In scope for this development tree

- Independent audit repairs I01–I07 in `TODO.md`.
- Official DSH successor freeze: prefer complete npm `0.1.3-alpha.2` with
  exact registry integrity. Package count is discovered from the actual
  graph. Mixed DSH generations are forbidden.
- Justified Node / Electron / Mnemon / production SDK upgrades.
- First-party plugin, Remote, IM, Memory, session projection, Home
  generation and old-session migrate/rollback re-verification on the frozen
  cohort.
- Deterministic source gates. Owner excludes the two-hour installed soak.
  `test:soak` remains required.
- Three-target native builds from one clean `main` SHA, exact asset set,
  immutable publication, README/website update and public readback.
- Presentation addendum: README, existing website origins, DMG/NSIS, and
  the first-run wizard must be redesigned and visually QA'd on real
  renders (desktop + mobile, keyboard, reduced motion). Downloads on the
  public site remain published 0.5.11 until v0.5.12 bytes are read back.

## Out of scope until separately evidenced

- Rewriting published v0.5.10 or v0.5.11 tags or assets.
- Treating fixtures as live model/IM PASS.
- Promoting missing live credentials into a new release blocker.
- UOS/LoongArch as a fourth official target.
- A second Agent core, mixed DSH generations, or enabling Budget
  enforcement merely to show usage.
- Two-hour installed soak / timed wait gates.

## Cohort freeze (development)

Exact identities will be recorded in `COHORT_FREEZE.json` and must match
`packages/release-identity/src/pins.ts` plus `release-contract.json` after
F03/F04. Until that freeze, product identity remains 0.5.11 in shipped
pins; this delta authorizes the 0.5.12 retitle only together with the
chosen cohort.

GitHub facts already observed (2026-09-08):

- `dsh-v0.1.3-alpha.2` / short commit `82a5fd6`, immutable GitHub release
  2026-09-07. Breaking/behavior notes: persona prefix/suffix, subprocess
  handle without pid, Web disconnect recovery, long-session memory.
- `dsh-v0.1.3-alpha.1` / short commit `d347e70`. Breaking: `SessionHandle`,
  async `agentLoop.create`, session lock, session log v2.
- Current public Penglai freeze remains DSH `0.1.2-rc.1` /
  `a66e4702047846cdaa10c66c9d3df3951f5ea70d` / 254-package npm cohort until
  a complete successor is proven.

## Conditional records

- Live model/IM: `LIVE_NOT_RUN` when credentials are absent.
- Mnemon Windows special-character / old-db rows: use matching native CI,
  not “this Mac has no Windows”.
- Native run 34151469696 Windows Defender weakening is not default-OS
  evidence for 0.5.12.

## 中文

本增量约束 `codex/0.5.12`。不改写已发布 0.5.10/0.5.11。0.5.11 验收增量里
“未合 main / 未授权 / 公开仍是 0.5.10”的句子是开发树快照，终裁以
`docs/PUBLICATION_MANIFEST_0.5.11.md` 为准。0.5.12 优先消费可证明完整的
官方 `0.1.3-alpha.2` npm 队列；包数以实际图为准。公开下载在 v0.5.12
回读前仍指向 0.5.11。
