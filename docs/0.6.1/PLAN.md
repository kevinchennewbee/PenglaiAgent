# Penglai 0.6.1 source and representative-package plan

Status: source implementation under an already-authorized full 0.6.1 release
workflow. Not a public release. Public downloads remain immutable `v0.6.0`.

## Objective

Deliver 0.6.1 source on `codex/0.6.1` from baseline
`8f7997130fc6579e429cf1e13bec470538638374`: official DSH `0.1.5-rc.1`
cohort, class-level audit repairs, first-party adaptation, installer and
docs staging, deterministic source gates, current native lifecycle
automation, and one local Apple Silicon representative app for Codex GUI
testing.

Owner authorized the full 0.6.1 workflow, including later PR/`main` freeze,
three-target native CI, immutable publication, README and existing websites.
Owner 2026-09-11 excluded Intel Mac from this version.
Per-phase source-only limits are sequencing, not a requirement to re-ask
for that authorization.

## Out of this worker phase

PR, `main` merge, three-target native CI dispatch, tag, upload, site deploy,
live IM, and UOS native PASS. Those remain manager-managed after source
acceptance. UOS native install/startup/function is `OWNER_POST_RELEASE`;
the Owner tests the published installer. Three exact targets remain required.
Old-version installed upgrade and previous-installer downloads are
`OWNER_EXCLUDED`. No two-hour soak.

## Workstreams

1. Pin the discovered 279-package npm cohort and rewrite identity atomically.
2. Repair IM cold recovery, session existence, inventory liveness, publication
   input, UOS Node/Depends, signed plugin preservation, and `deepseek-flash`
   onboarding. Include Office object-root schemas, Memory execution-context
   and Mnemon category mapping, durable cold IM recovery, and missing-session
   classification from accepted core source `cbe557bf`.
3. Adapt current dsh-im 4.18.1 / unpublished 606ced1 inside `@penglai/im`:
   official inbound FileBlock, bot aliases, RemoteError/preset copy, optional
   Darwin iMessage. Do not install the community runtime.
4. Keep Office action confirmation and Workspace isolation.
5. Stage 0.6.1 public copy under `docs/0.6.1/`; do not claim public bytes.
6. Run source gates on the combined tree. Representative darwin-arm64 packaging
   waits for the manager's accepted native-proof descendant.
7. Make current native/release automation implement the authorized 0.6.1
   scope: fresh install, restart/resume, and default uninstall on
   Mac/Windows; keep historical upgrade verifiers; do not fetch old
   installers in this workflow.

## Native lifecycle

Current hard lifecycle gate: `verify:fresh-install-uninstall`.
Historical `verify:upgrade-uninstall` stays in-tree and is not a 0.6.1 PASS.
See `docs/0.6.1/NATIVE_LIFECYCLE.md`.
