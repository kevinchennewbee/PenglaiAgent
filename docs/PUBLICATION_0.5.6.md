# PenglaiAgent 0.5.6 publication contract

Status: `PUBLIC_READBACK_PASS`.

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

The exact candidate source is
`75bbd591c61b757dfe015e54e40ad21ccf9ab94b`, with public-export tree
`2a5b725aaaab1af7b651dbbe5b2d5558bb3c9ab15bde53c24d077896e37cdd79`
(735 files). Native run
[`32795706687`](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32795706687)
passed on Apple Silicon, Intel Mac, and Windows x64. The immutable stable
[`v0.5.6`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.6)
Release is public, and `pnpm readback:release v0.5.6` passed for all ten public
assets, tag-to-source identity, updater metadata, and detached signatures.
