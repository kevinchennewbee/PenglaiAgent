# ADR 0039 — DSH 0.1.1-rc.2 continues in Penglai 0.5.7

- Status: Accepted
- Date: 2026-08-25
- Supercedes: ADR 0033 as the *current product pin*; ADR 0033 remains the
  historical rc.1 three-target decision

## Context

Penglai 0.5.6 froze `@deepseek-ai/dsh@0.1.1-rc.2` (GitHub tag `dsh-v0.1.1-rc.2`,
commit `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`). 0.5.7 adds IM channels and
reliability fixes. It must not drift onto an unreleased DSH branch.

Freeze-day observation (2026-08-25):

- npm `latest` = `0.1.1-rc.2`
- npm `next` = `0.1.1-rc.2`
- GitHub default branch HEAD = the rc.2 tag commit (not ahead)

## Decision

1. Keep every direct DSH package at exact `0.1.1-rc.2` with the live npm
   integrity already recorded in `pins.ts`.
2. Do not modify the DSH agent loop, model system, session engine, or
   tool-approval system.
3. Re-verify GitHub tags, npm dist-tags, lockfile, overlay, and compatibility
   docs before merge. A newer official DSH release requires a new ADR and Owner
   decision; 0.5.7 does not auto-follow.

## Consequences

- Overlay directory remains `overlays/dsh-0.1.1-rc.2/`.
- Channel work happens only in Penglai plugins.
