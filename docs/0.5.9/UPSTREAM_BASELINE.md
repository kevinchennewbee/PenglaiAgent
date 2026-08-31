# Penglai 0.5.9 DSH upstream baseline

## Decision

Penglai 0.5.9 migrates as one product generation to the official npm cohort
for DeepSeek Harness `0.1.2-alpha.2`. The npm `alpha` dist-tag is discovery
evidence only. Product manifests, the lockfile, release identity, SBOM, plugin
compatibility, and installed readback must use the exact version and registry
integrities recorded in `DSH_NPM_COHORT.json`.

This is an official pre-release, not a stable DSH release. Penglai 0.5.8 and
its alpha.1 source closure remain immutable historical release evidence.

## Fixed source identity

| Field | Value |
| --- | --- |
| Repository | `https://github.com/deepseek-ai/DeepSeek-Harness.git` |
| Tag | `dsh-v0.1.2-alpha.2` |
| Commit | `0a53fb55bea101816fa226bb964ae2bed71c343b` |
| DSH packages | 245 at exact `0.1.2-alpha.2` |
| Vendor packages | 9 at their exact upstream versions |
| Landlock packages | 3 at exact `0.1.1` |
| Root npm integrity | `sha512-4TvTC5kRKlgtSU2UTBv+cID9a2Z+6+m6mpvjXWJfVzuTkflCff6s4MsQpFJTCmwFh/k7zNWe7qFXcLYMV/5VvA==` |

Compared with the alpha.1 DSH family, alpha.2 adds
`dsh-client-ui-schedule`, `dsh-deque`, `dsh-util-time`, and
`dsh-util-values`. It removes no alpha.1 DSH package from the published family.
`dsh-client-runtime` is not part of either published alpha cohort and remains a
forbidden compatibility shim.

## Migration boundaries

The migration is not a top-level dependency bump. It includes:

- the namespaced Remote error contract and structured error preservation;
- session projections and `SessionEvent.ignorable` semantics;
- settings providers and client connection/reconnect ownership;
- SQLite schema 20 in a new, isolated DSH Home generation;
- exact Cordis 4.0.2 and matching vendor versions with one physical Cordis;
- all first-party Penglai plugins, their client owners, packed artifacts, and
  the signed Plugin Center catalog;
- fresh, upgrade, rollback, restart, and real-account evidence on every
  publicly claimed platform or connector.

The browser reconnect feature does not prove recovery of a dead DSH process,
Windows helper supervision, or HTTP 502/Stop failures. The upstream plugin
inventory UI is diagnostic and does not replace Penglai installation,
signature, digest, permission, activation, or rollback transactions.

## Reproducible cohort gate

Generate the snapshot only from a clean checkout at the fixed commit:

```powershell
node scripts/verify-dsh-npm-cohort.mjs --write --upstream <fixed-upstream-checkout>
```

Validate the checked-in snapshot without network access:

```powershell
node scripts/verify-dsh-npm-cohort.mjs
```

Re-read every exact registry record and the current DSH dist-tags:

```powershell
node scripts/verify-dsh-npm-cohort.mjs --live
```

The lockfile migration must stop on a missing package, registry metadata drift,
mixed alpha.1/alpha.2 graph, more than one Cordis instance, unexpected install
lifecycle script, or an unreconciled source/registry identity.

