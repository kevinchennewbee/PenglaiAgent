# Penglai 0.5.8 release runbook

This is the executable release order for public repository
`kevinchennewbee/PenglaiAgent`. Source, package, native, installed,
Owner-live, public-byte, and live-site evidence are separate. A lower evidence
plane never promotes a higher one.

## 1. Freeze the source candidate

1. Verify the checkout identity, clean worktree, `main` HEAD, `origin/main`, and
   the reviewed PR merge SHA all agree.
2. Verify every active product manifest, lockfile, profile, plugin descriptor,
   package builder, release identity, and workflow says Penglai `0.5.8` and DSH
   `0.1.2-alpha.1`.
3. Verify the DSH baseline is the unmodified official tag
   `dsh-v0.1.2-alpha.1` at
   `cd5ef8148158c3a752a658978873241fdf8e2bbc`, with the exact 251-package
   closure and committed digests. Official npm publication is not required and
   Penglai must not publish into the official `@deepseek-ai` scope.
4. Keep official DSH as the sole Agent core. Office and Memory are required and
   active on a fresh profile. IM, ASR, TTS, Budget, and Companion remain bundled
   optional capabilities; product defaults and evidence must remain truthful.
5. Confirm the published 0.5.7 tag, assets, release documents, and public bytes
   are unchanged. WhatsApp remains absent from the active 0.5.8 product.
6. Commit before collecting candidate evidence. Any source change invalidates
   package, native, installed, and public evidence bound to the prior SHA.

## 2. Source, package, and reproducibility gates

Run from the exact clean candidate:

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
pnpm audit:supply-chain
pnpm verify:versions
pnpm verify:identity
pnpm verify:contracts
pnpm verify:dependencies
pnpm verify:dsh-vendored-closure
pnpm verify:dsh-local-dependencies
pnpm verify:058-migration-inventory
pnpm verify:058-overlay-map
node scripts/verify-058-preview.mjs
pnpm build
pnpm pack:plugins
node scripts/embed-runtime.mjs --target darwin-aarch64
pnpm verify:closure
pnpm verify:profile
pnpm verify:memory-real
pnpm verify:office-real
pnpm prepare:public-export -- --clean-room
pnpm verify:clean-clone
```

`FAIL`, `INCOMPLETE`, `BLOCKED`, `NOT_RUN`, and timeout are not PASS. The fixed
source archive and tarball closure are supply-chain inputs, not native or
installed evidence.

## 3. PR review and merge

1. Push only coherent checkpoints to `0.5.8-preview` and read back Source CI.
2. Open one PR from `0.5.8-preview` to `main` after source/package gates pass.
3. Review the complete diff against `main`, including dependency source,
   generated lockfile, release workflows, plugin injection graphs, runtime
   flattening, 0.5.7 bug replay, and public claim boundaries.
4. Merge without bypassing required checks. The merge commit becomes the only
   authorized release candidate.

## 4. Three native targets

Dispatch `.github/workflows/native-release-candidate.yml` on the exact final
`main` SHA. The jobs must use matching native runners and produce:

- `Penglai_0.5.8_macos_aarch64.dmg` on Apple Silicon;
- `Penglai_0.5.8_macos_x64.dmg` on Intel macOS;
- `Penglai_0.5.8_windows_x64_setup.exe` on Windows x64.

For every target, verify the installer bytes, architecture, Electron fuses,
embedded Node and DSH identity, 251-package source provenance, package-local
dependency conflicts, process ownership, modes/ACLs, fresh onboarding,
required plugins, optional defaults, restart/recovery, 0.5.7 upgrade,
keep-data/full-delete uninstall, and no leftover process. Tests must use the
application copied back from the installer, not a staging tree.

## 5. Owner-live and differential bug replay

Replay every real 0.5.7 defect on installed alpha.1. Record whether the old fix
is retained, adapted, or removed because upstream now owns the capability.
Office/Memory real operations, Feishu media/voice, Weixin diagnostics, native
ASR/TTS, IM accounts, and long-running stress remain explicit
`LIVE_NOT_RUN`/`LIVE_BLOCKED` when credentials, models, or Owner interaction are
not available. Missing supplemental live evidence is visible; it is never
fabricated and does not rewrite independently evaluated automated/native gates.

## 6. Assemble and publish immutable bytes

1. Download the three native workflow artifacts and verify that all bind the
   exact final `main` SHA and public-export tree.
2. Assemble exactly the ten assets declared by `release-contract.json`: three
   installers, signed update manifest and signature, release manifest, SBOM,
   third-party notices, checksums, and public-export manifest.
3. Create and inspect a draft `v0.5.8` Release. Publish once; never replace an
   uploaded installer with rebuilt bytes.
4. Run `pnpm readback:release v0.5.8` and verify the tag/source, exact asset set,
   sizes, SHA-256 values, updater signature, installer identity, target mapping,
   and public-export binding from downloaded public bytes.

## 7. Public narrative and website

Only after public readback PASS:

1. Write observed source SHA, workflow IDs, sizes, hashes, links, support matrix,
   source-built DSH provenance, and honest trust limitations into release notes,
   publication documents, and the root README, English first and Chinese second.
2. Update the Chinese root website and complete English `/en/` site from the
   same observed facts. Preserve the existing Penglai ink-wash direction.
3. Dispatch the website workflow with `v0.5.8`; it must repeat public readback
   before deploying `website/` to `gh-pages`.
4. Read back both live languages and all three installer links over public HTTP.
   Search for stale 0.5.7/rc.2 claims and claims stronger than their evidence.
5. Update repository description, homepage, and topics only when needed, then
   read those values back from GitHub.

