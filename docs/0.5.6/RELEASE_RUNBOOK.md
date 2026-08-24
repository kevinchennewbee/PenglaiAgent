# Penglai 0.5.6 release runbook

This is the executable release order for public repository
`kevinchennewbee/PenglaiAgent`. Every product, native, installed, live, and
public claim must name its evidence class. A source test or successful package
command is not installed, native, live-account, or public evidence.

## 1. Freeze the source candidate

1. Verify `origin`, branch, HEAD, `origin/main`, tags, open pull requests, and a
   clean worktree. The repository must not be confused with DeepSeek Harness,
   historical `penglai-v2`, or a `GenericAgent` checkout.
2. Confirm every package, profile seed, installer, workflow, `release-info.json`,
   and `release-contract.json` says `0.5.6`. Official DSH `0.1.1-rc.2` remains
   the only agent core.
3. Review every change since `origin/main`, including generated/vendor inputs,
   permissions, licenses, updater identity, plugin links, and public-export
   policy. Remove private paths, credentials, QR data, chat bodies, account IDs,
   local profiles, and test media.
4. Keep Office and Memory required and active on a fresh profile. Keep Mobile
   Messaging, ASR, TTS, and Companion bundled but disabled by default.
5. Commit before collecting candidate evidence. Any later source change creates
   a new candidate SHA and invalidates previous package evidence.

## 2. Run source, security, and reproducibility gates

Install with the pinned toolchain and run the scripts declared in `package.json`:

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
pnpm verify:versions
pnpm verify:identity
pnpm verify:contracts
pnpm verify:dependencies
pnpm audit:dependencies
pnpm audit:licenses
pnpm audit:secrets
pnpm audit:supply-chain
pnpm build
pnpm pack:plugins
pnpm verify:profile
pnpm verify:closure
pnpm verify:memory-real
pnpm verify:office-real
pnpm prepare:public-export -- --clean-room
pnpm verify:clean-clone
```

The public-export result must be clean-room, bound to the exact source SHA, and
contain the current 0.5.6 public documents. A secret scanner PASS does not
override a manually observed secret or private path.

## 3. Test the Apple Silicon installed product and live model

1. Build the Apple Silicon DMG from the clean candidate and install it into an
   isolated application and user-data directory.
2. Verify fresh start, Back/retry, invalid Workspace rejection, credential
   failure recovery, restart/resume, first official Session Turn, Office and
   Memory defaults, optional plugin defaults, update UI, and both uninstall
   paths.
3. Supply a temporary DeepSeek credential only through the test's no-echo
   input. Never place it in chat, argv, shell history, repository files,
   evidence, screenshots, or logs.
4. Send a nonce Turn through official DSH and verify a real response. Verify
   automatic Workspace memory creation and recall on a later Turn without an
   explicit “remember” command. Verify personal memory remains an explicit
   Owner action.
5. Click TTS preview and conversation Read, verify play/stop/end/error state,
   and confirm it reads the original response rather than translating it.
6. Remove the isolated app/profile and verify no owned Penglai/DSH process,
   credential, media, or temporary test directory remains. Revoke the temporary
   provider key after the test.

Unavailable real IM accounts or physical audio devices are recorded as
`LIVE_NOT_RUN`, never replaced by mocks.

## 4. Open the PR and build three native targets

Push the candidate branch, open one PR to `main`, and require repository CI.
Dispatch `.github/workflows/native-release-candidate.yml` with `mode=native`
for the exact candidate SHA. The workflow must produce:

- `Penglai_0.5.6_macos_aarch64.dmg` on Apple Silicon;
- `Penglai_0.5.6_macos_x64.dmg` on Intel macOS;
- `Penglai_0.5.6_windows_x64_setup.exe` on Windows x64.

Each matching native runner performs clean export, build, source regression,
runtime closure, packaged fuse checks, installed welcome/process smoke, and
installed first-party plugin lifecycle. Windows additionally compiles the NSIS
source as UTF-8 and captures the Simplified Chinese component page. Rosetta,
emulation, or a cross-built payload is supplementary evidence only.

Do not dispatch `mode=catalog` merely because the desktop candidate is green.
The existing immutable catalog remains authoritative unless a separately
reviewed catalog release is actually required.

## 5. Preserve the exact source identity

After CI and all three native jobs pass, merge without changing candidate
bytes. The tag, `main` at publication time, and every native job must resolve to
the same source SHA. If branch protection would create a merge commit, use a
reviewed fast-forward path or rebuild all native targets from the resulting
commit.

Download the three workflow artifacts without rebuilding. Verify their embedded
source SHA, target, architecture, public-export tree, size, and SHA-256.

## 6. Create and assemble the draft Release

Create a draft `v0.5.6` Release at the exact source SHA and upload only the
three installers. The draft must contain no other assets before metadata
assembly.

Run `pnpm assemble:release` with a temporary staging directory containing only
those three bytes. The command reads the draft asset IDs, refuses size/digest or
source mismatches, consumes the clean-room public export, SBOM and notices,
requires the offline updater key to match the embedded public identity, signs
all three installers and the update manifest, and produces the exact ten-asset
set declared by `release-contract.json`.

Upload the remaining seven assets:

- `update-manifest-v1.json`
- `update-manifest-v1.json.sig`
- `release-manifest.json`
- `SBOM.cdx.json`
- `THIRD_PARTY_NOTICES.txt`
- `SHA256SUMS`
- `public-export-manifest.json`

Inspect the draft through the GitHub API, then publish it as the latest stable
Release. macOS remains ad-hoc signed and not notarized; Windows remains without
Authenticode. Penglai signatures protect update bytes, not OS publisher identity.

## 7. Public readback and narrative

Run `pnpm readback:release v0.5.6`. PASS requires an immutable, non-draft,
non-prerelease Release; the exact ten assets; public byte sizes and SHA-256;
tag-to-source identity; public-export identity; the update-manifest signature;
and all three installer signatures.

Only after readback passes:

1. replace candidate placeholders in the publication manifest with observed
   source, run, asset, byte, and digest values;
2. update README and the `gh-pages` site in English first and Chinese second;
3. test the public download links and the production website on desktop and a
   narrow/mobile viewport;
4. re-run update discovery from supported older 0.5 versions and verify 0.5.6
   itself reports no later release;
5. verify open CodeQL, dependency, and secret-scanning alerts; and
6. remove obsolete remote candidate branches only after the public readback and
   site deployment succeed.
