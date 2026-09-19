# Penglai 0.6.5 release ledger

Status: `[x]` means the named work and its direct evidence exist. It does not
turn an unrun native or public check into PASS.

- [x] Verify the official DSH alpha.2 Git tag, commit, source tree, archive, npm
      root package, and complete 307-package registry cohort.
- [x] Move product identity, lockfile, runtime closure, profile, and all
      first-party plugins to DSH `0.1.6-alpha.2` as one generation.
- [x] Preserve the published rc.2 DSH home and migrate settings and sessions into an
      isolated alpha.2 home.
- [x] Disable upstream session logging/upload; integrate one exact official DSH
      alpha.2 plugin manager with official UI/tool, bundled Node/pnpm, retained
      built-ins, Memory disable persistence, and explicit build-script approval.
- [x] Mark the Apple Silicon and Windows x64 installed upgrade from immutable
      0.6.2 packages `OWNER_EXCLUDED`; keep immutable source pins without a PASS claim.
- [x] Add a fail-closed UOS `.deb` verifier for package identity, ABI, closure,
      runtime, plugins, licenses, and architecture.
- [x] Harden evidence output, secret scanning, and owner-path redaction.
- [ ] Merge the reviewed source into `main` and record the frozen source SHA.
- [x] Exclude Office/PDF, LibreOffice Kit, Budget, and Companion from the 0.6.5
      workspace, profile, catalog, runtime closure, installer staging, and
      product acceptance. Keep their upstream identities only in the upstream
      audit ledger.
- [ ] Complete native Mac and Windows fresh-install, restart, and
      default-uninstall evidence on the exact frozen SHA.
- [ ] Build and verify the exact UOS package on that same SHA.
- [ ] Publish and read back the exact immutable asset set.
- [ ] Replace candidate wording with observed public sizes, hashes, and source
      identity; deploy and read back both public websites.
- [ ] Owner post-release UOS native test: install, start, UI, file picker,
      sleep/resume, model conversation, and Memory.

Unchecked native/public items are `NOT_RUN` until executed in the authorized
full-release sequence. The 0.6.2 installed-upgrade journey and the two-hour
installed soak are both `OWNER_EXCLUDED`.
