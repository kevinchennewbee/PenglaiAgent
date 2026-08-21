# PUBLICATION_MANIFEST 0.5.1 (draft)

Status: **draft / UNFROZEN**. Exact hashes are filled only after the merged `main` source and all three native installers are frozen.

## Identity

| Field | Value |
| --- | --- |
| productVersion | `0.5.1` |
| candidateKind | `public-publication-candidate` |
| trustTier | `community-verified` |
| generationId | `penglai-dsh-v0.5` |
| phase | `UNFROZEN` |
| targets | `darwin-aarch64`, `darwin-x86_64`, `win32-x86_64` |
| macOS signature | ad-hoc, not notarized, no Developer ID |
| Windows signature | no Authenticode; SmartScreen warning expected |

## Pins

| Component | Pin |
| --- | --- |
| DSH | `0.1.1-rc.1` |
| Electron | `43.4.0` |
| Node | `22.22.2` |
| pnpm | `10.14.0` |

## Exact user installers

| Target | Installer | SHA-256 | Native installed evidence |
| --- | --- | --- | --- |
| Apple Silicon | `Penglai_0.5.1_macos_aarch64.dmg` | _(UNFROZEN)_ | NOT_RUN |
| Intel Mac | `Penglai_0.5.1_macos_x64.dmg` | _(UNFROZEN)_ | NOT_RUN |
| Windows x64 | `Penglai_0.5.1_windows_x64_setup.exe` | _(UNFROZEN)_ | NOT_RUN |

Companion assets:

- `update-manifest-v1.json`
- `update-manifest-v1.json.sig`
- `release-manifest.json`
- `SBOM.cdx.json`
- `THIRD_PARTY_NOTICES.txt`
- `SHA256SUMS`
- `public-export-manifest.json`

## Binding

| Field | Value |
| --- | --- |
| privateCandidateSourceSha | written at freeze |
| publicExportTreeSha256 | written by `prepare:public-export` |
| publicRepo | `kevinchennewbee/PenglaiAgent` |
| publicTag | `v0.5.1` |
| futurePublicCommitSha | written after push |
| updaterChannel | `NOT_PUBLISHED_0_5_1` |
| immutableRelease | must read back `true` before publication |

## Plugin registry dependency

The signed catalog release [`plugin-catalog-v1.000001`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000001) is immutable and verifies with the public key embedded in this exact client. Live production refresh, catalog and archive verification, disabled install, and offline last-good recovery PASS.

## Upgrade boundary

0.5.0 to 0.5.1 is a manual same-platform overlay on Apple Silicon and preserves `Penglai/0.5`. Intel and Windows are fresh installs. From 0.5.1 onward, later same-platform releases use signed immutable PUDP/1 manifests after the update drill passes.
