# Penglai 0.6.2 release ledger

Status: `[x]` means the named work and its direct evidence exist. It does not
turn an unrun native or public check into PASS.

- [x] Verify the official DSH rc.2 Git tag, commit, source tree, archive, npm
      root package, and complete 279-package registry cohort.
- [x] Move product identity, lockfile, runtime closure, profile, and all
      first-party plugins to DSH `0.1.5-rc.2` as one generation.
- [x] Preserve the rc.1 DSH home and migrate settings and sessions into an
      isolated rc.2 home.
- [x] Keep upstream feedback local-only, remove duplicate entry behavior, and
      add regression coverage for the locale-bound official client.
- [x] Make Apple Silicon and Windows x64 installed upgrades from immutable
      0.6.1 packages a required lifecycle gate.
- [x] Add a fail-closed UOS `.deb` verifier for package identity, ABI, closure,
      runtime, plugins, licenses, and architecture.
- [x] Harden evidence output, secret scanning, and owner-path redaction.
- [x] Merge the reviewed source into `main` and record the frozen source SHA.
- [x] Complete native Mac and Windows fresh-install, restart, upgrade, rollback,
      and default-uninstall evidence on the exact frozen SHA.
- [x] Build and verify the exact UOS package on that same SHA.
- [x] Publish and read back the exact immutable asset set.
- [x] Replace candidate wording with observed public sizes, hashes, and source
      identity; deploy and read back both public websites.
- [ ] Owner post-release UOS native test: install, start, UI, file picker,
      sleep/resume, model conversation, Office, and Memory.

The two-hour installed soak is `OWNER_EXCLUDED`.
