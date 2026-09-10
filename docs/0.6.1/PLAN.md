# Penglai 0.6.1 source and representative-package plan

Status: source implementation. Not a public release. Public downloads remain
immutable `v0.6.0`.

## Objective

Deliver 0.6.1 source on `codex/0.6.1` from baseline
`8f7997130fc6579e429cf1e13bec470538638374`: official DSH `0.1.5-rc.1`
cohort, class-level audit repairs, first-party adaptation, installer and
docs staging, deterministic source gates, and one local Apple Silicon
representative app for Codex GUI testing.

## Out of this phase

PR, `main` merge, four-target native CI, tag, upload, site deploy, live IM,
and UOS native PASS. UOS native install/startup/function is
`OWNER_POST_RELEASE`; the Owner tests the published installer. Four exact
targets remain required.

## Workstreams

1. Pin the discovered 279-package npm cohort and rewrite identity atomically.
2. Repair IM cold recovery, session existence, inventory liveness, publication
   input, UOS Node/Depends, signed plugin preservation, and `deepseek-flash`
   onboarding.
3. Keep Office action confirmation and Workspace isolation.
4. Stage 0.6.1 public copy under `docs/0.6.1/`; do not claim public bytes.
5. Run source gates and package a representative darwin-arm64 app from a local
   candidate commit.
