# Penglai 0.6.2 release plan

Status: active release work. This is not proof of a public release.

## Goal

Ship Penglai 0.6.2 with the complete official DeepSeek Harness
`0.1.5-rc.2` npm cohort, restore installed upgrades from 0.6.1 on Apple
Silicon and Windows x64, and publish one complete UOS 20 LoongArch package.

## Release sequence

1. Pin and verify all 279 DSH, vendor, and native packages by registry
   integrity. Keep DSH as the only agent core.
2. Rebuild every first-party plugin for rc.2 and verify its real loader,
   permission, enable/disable, restart, and rollback behavior.
3. Keep feedback local to the device and say so in the interface. Never attach
   or upload conversation content through the feedback surface.
4. Run the deterministic source, contract, integration, security, dependency,
   license, privacy, and clean-export gates.
5. From one clean `main` commit, build Apple Silicon, Windows x64, and UOS 20
   LoongArch. Run installed fresh and 0.6.1 upgrade journeys on Mac and
   Windows. Verify the UOS package, ABI, runtime, and full closure.
6. Publish only the exact asset set in `release-contract.json`, verify the
   immutable public bytes, then update README and the existing websites with
   the observed sizes and SHA-256 values.

## Explicit boundaries

- No Intel Mac package, Linux amd64 package, or Windows ARM package.
- No two-hour installed soak.
- UOS native install, startup, UI, file picker, sleep/resume, and functional
  use remain `OWNER_POST_RELEASE`; the Owner tests the published `.deb`.
- No notarization or Authenticode claim.
- No public-download claim until the immutable release can be read back.
