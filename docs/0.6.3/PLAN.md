# Penglai 0.6.3 release plan

Status: source-development plan. Native candidate work and publication are not
authorized in this phase and remain `NOT_RUN`.

## Goal

Prepare Penglai 0.6.3 with the complete official DeepSeek Harness
`0.1.6-alpha.2` npm cohort, finish source and plugin adaptation, pass source
gates, and merge the reviewed change to `main`. Stop before native installers,
installed upgrades, publication, or website deployment.

## Release sequence

1. Pin and verify all 307 DSH, vendor, and native packages by registry
   integrity. Keep DSH as the only agent core.
2. Rebuild every first-party plugin for alpha.2 and verify its source-level loader,
   permission, enable/disable, restart, and rollback behavior.
   The 0.6.3 first-party set excludes Office/PDF, Budget, and Companion; Memory
   is the only required feature plugin.
3. Disable the upstream session log/upload path and free-form plugin manager in
   the Penglai profile. Keep the signed Penglai catalog as the only install path.
4. Run the deterministic source, contract, integration, security, dependency,
   license, privacy, and clean-export gates.
5. In a later authorized phase, from one clean `main` commit, build Apple Silicon, Windows x64, and UOS 20
   LoongArch. Run installed fresh and 0.6.2 upgrade journeys on Mac and
   Windows. Verify the UOS package, ABI, runtime, and full closure.
6. In that later phase, publish only the exact asset set in `release-contract.json`, verify the
   immutable public bytes, then update README and the existing websites with
   the observed sizes and SHA-256 values.

## Explicit boundaries

- No Intel Mac package, Linux amd64 package, or Windows ARM package.
- No two-hour installed soak.
- UOS native install, startup, UI, file picker, sleep/resume, and functional
  use remain `OWNER_POST_RELEASE`; the Owner tests the published `.deb`.
- No notarization or Authenticode claim.
- No public-download claim until the immutable release can be read back.
- Current public README/site remain on v0.6.2.
- LibreOffice, Office/PDF, Budget, and Companion are not 0.6.3 product
  capabilities and must remain absent from product closure and installers.
