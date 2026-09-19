# Penglai release runbook index

The executable contract for a release is the **current version's**
`docs/<version>/ACCEPTANCE_DELTA.md`, together with `release-contract.json` and
`AGENTS.md`. This index deliberately does not name one version: it previously
pointed at `docs/0.6.2/ACCEPTANCE_DELTA.md` and was still doing so two versions
later, which meant the published index sent readers to a superseded contract.

Historical versioned runbooks remain beside their corresponding source and
publication records. They do not override the current version, exact asset set,
native targets, or authorization.

The step-by-step operator procedure — draft assembly, offline signing key
handling, the public readback sequence, and the explicit GitHub Pages build
request — is maintained **outside** this repository, so that it can carry local
paths and operator-only detail without publishing them. This file is the public
index into the contract, not that procedure. Publishing a redacted form of it
would close a real gap for anyone reproducing a release.

For every release, keep source, package, native, installed, live, and public
evidence separate. A green source suite cannot prove an installed client, a
cross-build cannot prove a native target, and a local hash cannot prove public
bytes. Never include credentials, private keys, private paths, QR data, chat
bodies, account identities, profiles, logs, or private media in a public release.

## What a release must be able to say

A release is complete only when every applicable item below has evidence:

| phase | evidence |
| --- | --- |
| upstream identity | pinned tag, commit and full cohort with registry integrity |
| source gates | every hard subgate green at one clean `main` SHA |
| native | one installer per selected target, all from that same SHA |
| installed | fresh install, restart and default uninstall on the supported hosts |
| upgrade | the installed-upgrade journey, executed or explicitly Owner-excluded |
| publication | immutable Release carrying exactly the declared assets |
| public bytes | downloaded from the public URL and compared byte-for-byte |
| drift | `pnpm verify:drift` result, published rather than hidden |

A red drift probe does not block the release. It blocks the release from claiming
that everything is fine. See `DRIFT_SUBGATES` in
`packages/release-identity/src/pins.ts`.
