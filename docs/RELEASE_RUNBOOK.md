# Penglai release runbook index

The current executable runbook is
[`docs/0.6.2/ACCEPTANCE_DELTA.md`](0.6.2/ACCEPTANCE_DELTA.md) together with
`release-contract.json` and `AGENTS.md`. Historical versioned runbooks remain
beside their corresponding source and publication records. They do not override
the current version, exact asset set, native targets, or authorization.

For every release, keep source, package, native, installed, live, and public
evidence separate. A green source suite cannot prove an installed client, a
cross-build cannot prove a native target, and a local hash cannot prove public
bytes. Never include credentials, private keys, private paths, QR data, chat
bodies, account identities, profiles, logs, or private media in a public release.
