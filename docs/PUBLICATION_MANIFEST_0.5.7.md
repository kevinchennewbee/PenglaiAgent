# PUBLICATION_MANIFEST 0.5.7

Status: `PUBLIC_READBACK_PASS`

The immutable public Release was assembled from the clean export of the exact
source SHA below. GitHub-hosted bytes, SHA-256 values, update-manifest signature,
and all three installer signatures were downloaded and verified after publication.
The committed `release-info.json` remains a non-self-referential template with
`phase=UNFROZEN` and `sourceSha=NONE`; generated build and public manifests bind
the observed release identity instead.

| Field | Value |
| --- | --- |
| productVersion | `0.5.7` |
| DSH | `0.1.1-rc.2` |
| trustTier | `community-verified` |
| source SHA | `ce01d4dea59af72422071e357760a040f19b8e3d` |
| public export tree | `8e0d6f27d54bef459e26c812453a968d19ab23c0c86b28dc2b8f1b5c947b3d67` |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | [`v0.5.7`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.7), immutable |
| native run | [33067739020](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33067739020), three targets PASS |
| public readback | [33071811058](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33071811058), PASS |
| publication channel | `stable-v0.5.7` |
| SBOM | 1,212 components |
| Messaging | eight `@penglai/im` connection entries; WhatsApp runtime not bundled |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | [`Penglai_0.5.7_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_macos_aarch64.dmg) | 474,383,101 | `bfbaec4b9f4b627abd41e793abae6b68246d0f00d8e9c5ca003d079e1e3667c8` |
| Intel Mac | [`Penglai_0.5.7_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_macos_x64.dmg) | 401,056,681 | `ab696fc92a2b1af538eed6008c8389ddc945d9dce39d85b16053cf60d8e2655e` |
| Windows x64 | [`Penglai_0.5.7_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.7/Penglai_0.5.7_windows_x64_setup.exe) | 355,918,104 | `cb4687e621d951d6d8ba4cf8428f4723f35c9827fa70ac542d4d3d928d5d882a` |

The exact Release set is those three installers plus
`update-manifest-v1.json`, `update-manifest-v1.json.sig`,
`release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`,
`SHA256SUMS`, and `public-export-manifest.json`.
