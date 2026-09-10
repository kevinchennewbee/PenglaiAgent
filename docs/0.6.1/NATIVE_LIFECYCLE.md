# Penglai 0.6.1 native lifecycle gate

Current 0.6.1 native lifecycle is fresh install, restart/resume, and default
uninstall on Apple Silicon, Intel Mac, and Windows x64. This is not a public
download claim.

## Required now

`verify:fresh-install-uninstall` is the `installed-lifecycle` hard subgate.

A passing Mac/Windows receipt must bind:

- exact candidate installer SHA
- clean source SHA and target identity
- actual installation of those bytes into an isolated dedicated destination
- fresh installed boot and normal graceful shutdown
- normal restart/resume on the same owner-data root
- process cleanup after boot, restart, and uninstall
- default uninstall: actual NSIS `Uninstall.exe` on Windows, dedicated
  installed-app removal on Mac
- independent owner-data sentinel preservation

Only verified task-created paths may be removed. Do not delete a whole Windows
`INSTDIR` to manufacture uninstall success. If NSIS leaves only a known
`Uninstall.exe` residue, classify every leftover first and record that exact
narrow behavior.

UOS packaging/ABI evidence is required and distinct. Native UOS
install/startup/function is `OWNER_POST_RELEASE` and must not be labeled PASS.

## Excluded now

- Old-version installed upgrade acceptance: `OWNER_EXCLUDED`
- Previous-installer downloads in the current workflow: not fetched
- Two-hour installed soak: `OWNER_EXCLUDED`

Historical `verify:upgrade-uninstall`, `scripts/fetch-upgrade-sources.mjs`,
and immutable `sources[]` in `UPGRADE_SOURCES.json` remain for prior-version
behavior. Unrun upgrade paths are not PASS.

## Later manager phases

This worker phase is local source. PR, `main` merge, four-target native CI,
immutable publication, and website readback stay manager-managed after
acceptance. Credential-free native wizard-to-API-boundary evidence does not
need personal account credentials. Real provider-account acceptance remains
supplemental per `docs/ACCEPTANCE.md`.
