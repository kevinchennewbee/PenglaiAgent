# Penglai 0.5.7 release runbook

This is the executable release order for public repository
`kevinchennewbee/PenglaiAgent`. Every product, native, installed, live, and
public claim must name its evidence class. A source test or successful package
command is not installed, native, live-account, or public evidence.

Grok Build stops after the Draft PR. Codex performs review, merge, rebuild,
Release, readback, README observed values, and website deploy.

## 1. Freeze the source candidate

1. Verify `origin` is `kevinchennewbee/PenglaiAgent`, branch `0.5.7` or the
   merged `main` SHA, a clean worktree, and no confusion with DeepSeek Harness,
   historical `penglai-v2`, or `GenericAgent`.
2. Confirm every package, profile seed, installer, workflow, `release-info.json`,
   and `release-contract.json` says `0.5.7`. Official DSH `0.1.1-rc.2` remains
   the only agent core. DSH-IM remains unsigned `v3.0.1` /
   `fb8a9df652ed6eaa4b99a9338cab15db1b626b1c`.
3. Re-verify GitHub DSH tags, npm `latest`/`next`, and Penglai lockfile/overlay
   pins. Do not follow a newer unpublished DSH or DSH-IM unless Owner re-pins
   for a security fix that affects ported code.
4. Keep Office and Memory required and active on a fresh profile. Keep Mobile
   Messaging, ASR, TTS, and Companion bundled but disabled by default.
5. Confirm `LIVE_IM_MATRIX.md` matches actual adapters. Do not claim nine-platform
   support without live rows.
6. Commit before collecting candidate evidence. Any later source change creates
   a new candidate SHA and invalidates previous package evidence.

## 2. Run source, security, and reproducibility gates

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm typecheck
pnpm test:unit
pnpm test:contract
pnpm test:integration
pnpm test:e2e
pnpm test:security
pnpm test:chaos
pnpm test:soak
pnpm test:failure-baseline
pnpm audit:secrets
pnpm audit:dependencies
pnpm audit:licenses
pnpm audit:supply-chain
pnpm verify:versions
pnpm verify:identity
pnpm verify:contracts
pnpm verify:dependencies
pnpm build
pnpm pack:plugins
pnpm verify:profile
pnpm verify:closure
pnpm verify:memory-real
pnpm verify:office-real
pnpm prepare:public-export -- --clean-room
pnpm verify:clean-clone
```

`INCOMPLETE`, `NOT_RUN`, and timeouts are not PASS. `--report` must not convert
a hard-gate failure into exit 0.

## 3. Native and installed product

Dispatch `.github/workflows/native-release-candidate.yml` for the exact
candidate SHA. Produce:

- `Penglai_0.5.7_macos_aarch64.dmg` on Apple Silicon
- `Penglai_0.5.7_macos_x64.dmg` on Intel macOS
- `Penglai_0.5.7_windows_x64_setup.exe` on Windows x64

Installed tests must launch the final product binary, not only an Electron
harness over `resources/app`. Verify wizard, Messaging cards, QR/connect
modals, cancel/retry, restart resume, update discovery, keep-data uninstall,
full-delete uninstall, and no leftover processes.

## 4. Live accounts

Fill `LIVE_IM_MATRIX.md` with redacted evidence or explicit `LIVE_NOT_RUN` /
`LIVE_BLOCKED`. Do not store QR, tokens, user IDs, group names, chat bodies,
phone numbers, or WhatsApp session keys.

## 5. Merge, rebuild, draft Release

Codex merges only after review. Rebuild all three native installers from the
final `main` SHA. Create a draft `v0.5.7` Release, assemble the exact ten-asset
set, publish after inspection, then run `pnpm readback:release v0.5.7`.

## 6. Public narrative and website

Only after readback PASS: write observed SHA/size/hash into README and
`docs/PUBLICATION_MANIFEST_0.5.7.md`. Deploy `website/` to `gh-pages` through
the manual workflow that requires tag `v0.5.7` and a successful public
readback. Re-check Chinese and English homepages and the three download links.
