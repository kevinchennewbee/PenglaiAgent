# PenglaiAgent 0.5.6 publication contract

Status: `CANDIDATE` until immutable public readback succeeds.

Owner authorized source changes, real testing, push, PR, merge, three-target
native builds, tag, GitHub Release, README, website, and bilingual public copy
for 0.5.6. Authorization does not permit publication with a failed required gate
or disclosure of credentials, private keys, local paths, QR data, chat bodies,
account identities, profiles, logs, or private media.

The exact native installers are:

- `Penglai_0.5.6_macos_aarch64.dmg`
- `Penglai_0.5.6_macos_x64.dmg`
- `Penglai_0.5.6_windows_x64_setup.exe`

All three must come from one reviewed, clean source SHA on matching native
runners. The Release contains those three bytes plus the seven metadata assets
declared by `release-contract.json`, and no others. The signed update manifest
uses sequence `5`, binds GitHub asset IDs, installer sizes/hashes/signatures,
the release-manifest digest, and the deterministic public-export tree.

Publication is complete only when GitHub reports an immutable stable `v0.5.6`
Release and `pnpm readback:release v0.5.6` downloads and verifies all ten public
assets. README, website, and publication evidence may say “released” only after
that result exists.
