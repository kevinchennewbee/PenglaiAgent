# Penglai 0.5.1 three-target runbook

This is the 0.5.1 candidate runbook. The 0.5.0 Apple Silicon publication is historical (`docs/RELEASE_RUNBOOK.md`, `v0.5.0`).

Kernel: official DSH `0.1.1-rc.1` (`dsh-v0.1.1-rc.1` / `528c682e061696f5a160f363f236ecbf53cbd006`).

Declared installers from one source SHA:

- `Penglai_0.5.1_macos_aarch64.dmg`
- `Penglai_0.5.1_macos_x64.dmg`
- `Penglai_0.5.1_windows_x64_setup.exe`

The public Plugin Registry exists, both repositories have Immutable Releases enabled, and the embedded public-key fingerprints match the maintainer key directory plus backup. Catalog `plugin-catalog-v1.000001` has passed immutable REST read-back and production-client verification. Native evidence may not be replaced by cross-build output. Do not tag or publish until the exact three-target set is frozen.

## Local source gates

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:security
pnpm verify:identity
pnpm verify:contracts
pnpm verify:clean-clone
node scripts/verify-release-keys.mjs
```

`package:mac --target darwin-x64` and `package:windows` must exit 4 on a non-matching host. Before every native build, run `pnpm prepare:public-export` on the same clean `main` SHA.

## Native build and publication

1. Build Apple Silicon with `pnpm package:dmg:arm` on a native Apple Silicon Mac.
2. Build Intel with `pnpm package:dmg:intel` on a native Intel Mac.
3. From an x64 Native Tools Command Prompt with NSIS installed, build Windows with `pnpm package:windows`. This compiles the native helper, stamps `Penglai.exe`, creates Setup, reinstalls the exact Setup, and writes target-bound installer evidence.
4. On each native runner, execute `test:e2e:installed`, `verify:installed`, and the two-hour `test:soak:installed` with the exact `PENGLAI_TARGET`; retain the target-specific evidence files.
5. Aggregate the three native evidence sets and require `verify:installed --aggregate`, `verify:evidence`, and `verify:release` to PASS.
6. Create draft GitHub Releases, attach all exact assets, and publish only after every Hard gate is PASS. Immutable Releases are effective when the draft is published; read them back afterward.
