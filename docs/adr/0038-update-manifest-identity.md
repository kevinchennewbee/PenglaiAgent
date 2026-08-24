# ADR 0038 — Update manifest identity

- Status: Accepted
- Date: 2026-08-24
- Version: Penglai 0.5.6 implementation
- Requirements: R56-UPD-001 .. R56-UPD-007, R56-DIST-005

## Context

0.5.5 Update Coordinator stores the signed update-manifest digest in the `releaseManifestSha256` field. Those are three different identities: update manifest, release manifest, and installer asset.

## Decision

1. Keep schema id `penglai.app-update.v1` and current asset names so 0.5.1-0.5.5 clients can discover 0.5.6.
2. The signed update JSON gains a required real `releaseManifestSha256`.
3. Coordinator stores three fields separately: `updateManifestSha256`, `releaseManifestSha256`, and the target asset sha256, plus the source commit.
4. Build order: installers, SBOM, Notices, and public export ->
   `release-manifest.json` -> hash it -> write that hash into
   `update-manifest-v1.json` -> sign the update manifest -> write
   `SHA256SUMS` over every asset except itself. Detailed test evidence remains
   bound to the source/native runs and is not an extra Release asset.
5. Mutation tests must swap the two manifest digests, replace the release manifest, replace an installer, and prove old clients ignore the new field.

## Consequences

- Release-freeze correction (2026-08-25): the proposed signed evidence-summary
  assets were not adopted. The authoritative `release-contract.json` and
  publication contract fix 0.5.6 at exactly ten assets: three installers plus
  seven metadata assets.
- A single digest must never fill two identity fields.
