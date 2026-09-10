# Penglai 0.6.1 native lifecycle gate

Current 0.6.1 native lifecycle is fresh install, restart/resume, and default
uninstall on Apple Silicon, Intel Mac, and Windows x64. This is not a public
download claim.

## Required now

`verify:fresh-install-uninstall` is the `installed-lifecycle` hard subgate.

A passing Mac/Windows receipt must bind:

- exact candidate installer SHA
- clean source SHA and target identity
- actual installation of those bytes: Mac uses a dedicated task-created app
  copy; Windows uses the exact default native path
  `%LOCALAPPDATA%\Penglai\app\0.5` with an explicit clean-host/unowned-install
  refusal. Custom INSTDIR remains protected in NSIS and is not the 0.6.1
  uninstall fixture.
- fresh installed boot and a normal application shutdown. Forced
  SIGKILL/taskkill `/F` or Windows Node `SIGTERM` is not a graceful pass.
- normal restart/resume on the same owner-data root, with persisted
  current-generation identity (`dsh-home-active.json` plus
  `dsh-homes/dsh-v0.1.5-rc.1`) and exact sentinel bytes/digest. Inventory
  `launchNonce`/`dshPid` must change; they are not the stable identity.
  Schema 4 also binds the activation manifest, Home manifest, web profile
  package/configuration, and any existing default settings/patch file to
  unchanged bytes. Missing profile files or an unsuccessful required-plugin
  inventory fail the gate. Vault, session, media, and Memory data are excluded
  from this fresh-profile fingerprint.
  First-run `activationKind: fresh` is not onboarding completed.
- process cleanup after boot, restart, and uninstall waits for owned
  processes to disappear without killing. Forced `taskkill /F` is only for
  abandoned leftover cleanup and fails the normal lifecycle proof.
- default uninstall: actual NSIS `Uninstall.exe` on the default INSTDIR, or
  dedicated installed-app removal on Mac
- Windows owner-data sentinel lives in `%LOCALAPPDATA%\Penglai\0.5`, which
  NSIS preserves, not in an env-overridden helper profile or the update cache.
  Existing-install and owner-profile preflight runs before any sentinel write.

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
