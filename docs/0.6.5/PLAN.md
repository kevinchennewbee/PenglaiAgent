# Penglai 0.6.5 release plan

Status: completed. The Owner authorized the full release workflow on
2026-09-18; native builds, immutable publication, public readback, and website
deployment all executed and passed. This file records the plan that was run.

## Goal

Prepare Penglai 0.6.5 as a repair release on the official DeepSeek Harness
`0.1.6-alpha.2` cohort that 0.6.3 already ships: the WeChat channel, the assisted
update check, and the verification layer that should have caught both. Pass
source gates, merge the reviewed change to `main`, build and validate all three
exact targets, publish and read back immutable bytes, then update and deploy the
README and existing websites.

## Release sequence

1. Pin and verify all 307 DSH, vendor, and native packages by registry
   integrity. Keep DSH as the only agent core.
2. Rebuild every first-party plugin for alpha.2 and verify its source-level loader,
   permission, enable/disable, restart, and rollback behavior.
   The 0.6.5 first-party set excludes Office/PDF, Budget, and Companion. Memory
   stays bundled/default-on and can be disabled without deleting code or data.
3. Disable the upstream session log/upload path. Mount one exact official DSH
   plugin manager through Penglai Center, expose its UI/tool, and supply only
   application-owned Node/pnpm `11.11.0`; do not add a second resolver or
   signed-catalog ecosystem allowlist.
4. Run the deterministic source, contract, integration, security, dependency,
   license, privacy, and clean-export gates.
5. From one clean `main` commit, build Apple Silicon, Windows x64, and UOS 20
   LoongArch. Run installed fresh, restart, and default-uninstall journeys on
   Mac and Windows. The 0.6.3 installed-upgrade journey is `OWNER_EXCLUDED`.
   Verify the UOS package, ABI, runtime, and full closure.
6. Publish only the exact asset set in `release-contract.json`, verify the
   immutable public bytes, then update README and the existing websites with
   the observed sizes and SHA-256 values and verify deployment.

## Explicit boundaries

- No Intel Mac package, Linux amd64 package, or Windows ARM package.
- No two-hour installed soak.
- No 0.6.3 to 0.6.5 installed-upgrade claim; that journey is `OWNER_EXCLUDED`.
- UOS native install, startup, UI, file picker, sleep/resume, and functional
  use remain `OWNER_POST_RELEASE`; the Owner tests the published `.deb`.
- No notarization or Authenticode claim.
- The public-download claim may name this version's installers only after the
  immutable release has been read back. That readback passed on 2026-09-20, and
  the README/site were then updated with the observed sizes and SHA-256 values.
- LibreOffice, Office/PDF, Budget, and Companion are not 0.6.5 product
  capabilities and must remain absent from product closure and installers.
