# Penglai 0.6.1 source ledger

Status: source phase. `[x]` requires implementation plus captured evidence.

- [x] Verify repository/HEAD `codex/0.6.1` at
      `8f7997130fc6579e429cf1e13bec470538638374`; do not touch the Owner
      checkout.
- [x] Independently verify official DSH `0.1.5-rc.1` npm/GitHub identity.
- [x] Write `docs/0.6.1/` authorization, delta, cohort freeze, and plugin
      inventory. Keep 0.6.0 public downloads.
- [x] Pin the 279-package registry cohort into workspace, lockfile, and
      release identity.
- [x] Class-level repairs: IM inspect recovery, session existence,
      generation-bound inventory, four-target publication input, UOS Node
      credential and Depends, signed overlay preservation, official Flash
      catalog consumption.
- [x] Deterministic source gates on the rc.1 graph (source unit/contract/e2e
      plus identity/contracts; live/native/UOS host remain later phases).
- [x] Wire current 0.6.1 native lifecycle: fresh install/restart/default
      uninstall as the hard `installed-lifecycle` gate; keep historical
      upgrade verifier; do not fetch previous installers; record UOS native
      as `OWNER_POST_RELEASE` without PASS.
- [ ] Local candidate commit and representative Apple Silicon package.
- [ ] Remaining manager phases: PR/main freeze, four-target natives
      executing `verify:fresh-install-uninstall` on Mac/Windows, UOS
      package/ABI, immutable publication, public-byte readback. UOS native
      install/startup/function is `OWNER_POST_RELEASE` (Owner tests the
      published installer); not a 0.6.1 native PASS. Old-version installed
      upgrade remains `OWNER_EXCLUDED`.
