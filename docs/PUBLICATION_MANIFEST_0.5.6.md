# PUBLICATION_MANIFEST 0.5.6

Status: `CANDIDATE`

| Field | Value |
| --- | --- |
| productVersion | `0.5.6` |
| DSH | `0.1.1-rc.2` |
| trustTier | `community-verified` |
| source SHA | recorded after exact candidate freeze |
| public export tree | recorded after clean-room export |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | `v0.5.6`, pending immutable readback |
| native run | recorded after all three matching native jobs pass |
| publication channel | `stable-v0.5.6` |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | `Penglai_0.5.6_macos_aarch64.dmg` | recorded from accepted bytes | recorded from accepted bytes |
| Intel Mac | `Penglai_0.5.6_macos_x64.dmg` | recorded from accepted bytes | recorded from accepted bytes |
| Windows x64 | `Penglai_0.5.6_windows_x64_setup.exe` | recorded from accepted bytes | recorded from accepted bytes |

The exact Release set is those three installers plus
`update-manifest-v1.json`, `update-manifest-v1.json.sig`,
`release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`,
`SHA256SUMS`, and `public-export-manifest.json`.

Candidate placeholders are intentionally not predicted. They are replaced only
with values observed from the exact native workflow and immutable public bytes.
