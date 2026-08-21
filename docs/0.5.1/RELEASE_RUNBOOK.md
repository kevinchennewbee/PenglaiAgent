# Penglai 0.5.1 three-target runbook

This is the 0.5.1 candidate runbook. The 0.5.0 Apple Silicon publication is historical (`docs/RELEASE_RUNBOOK.md`, `v0.5.0`).

Kernel: official DSH `0.1.1-rc.1` (`dsh-v0.1.1-rc.1` / `528c682e061696f5a160f363f236ecbf53cbd006`).

Declared installers from one source SHA:

- `Penglai_0.5.1_macos_aarch64.dmg`
- `Penglai_0.5.1_macos_x64.dmg`
- `Penglai_0.5.1_windows_x64_setup.exe`

Missing Intel/Windows native runners, PluginRegistry, immutable Releases, or key backup are **BLOCKED**, never native PASS. Do not push, tag, or publish until Owner freeze.

## Local source gates

```bash
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:security
pnpm verify:identity
pnpm verify:contracts
pnpm verify:clean-clone
```

`package:mac --target darwin-x64` and `package:windows` must exit 4 on a non-matching host.

## After Owner approval

1. WIP branch + Draft PR only if the Owner asks to backup collaboration.
2. Merge main only after review. Build the three artifacts from exact main.
3. Draft GitHub Release readback; publish only when Hard evidence is PASS.
