# PUBLICATION_MANIFEST 0.5.6

Status: `PUBLIC_READBACK_PASS`

| Field | Value |
| --- | --- |
| productVersion | `0.5.6` |
| DSH | `0.1.1-rc.2` |
| trustTier | `community-verified` |
| source SHA | `75bbd591c61b757dfe015e54e40ad21ccf9ab94b` |
| public export tree | `2a5b725aaaab1af7b651dbbe5b2d5558bb3c9ab15bde53c24d077896e37cdd79` (735 files) |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | [`v0.5.6`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.6), immutable and Latest |
| native run | [`32795706687`](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32795706687), all three matching native jobs PASS |
| publication channel | `stable-v0.5.6` |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | `Penglai_0.5.6_macos_aarch64.dmg` | 467566184 | `2a9097c791a183fb705d24e9f359a5a6dc2b09d98507a8bc785e763a05abffb3` |
| Intel Mac | `Penglai_0.5.6_macos_x64.dmg` | 396796619 | `b37f1eab02244c2c06b0d6dc220f899ed866463143f3315a99f8d408b2bffea3` |
| Windows x64 | `Penglai_0.5.6_windows_x64_setup.exe` | 355959044 | `b56b163b38f63337f760fd0d2fade3fd36f9a2cb72e00a2932154a693c74c989` |

The exact Release set is those three installers plus
`update-manifest-v1.json`, `update-manifest-v1.json.sig`,
`release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`,
`SHA256SUMS`, and `public-export-manifest.json`.

The three installer rows are the exact bytes accepted from rebuilt native run
`32795706687`; all three passed clean export, installer/source identity,
Electron fuses, installed welcome, and first-party plugin lifecycle checks.
Windows also passed the native Simplified Chinese installer UI gate. The same
exact bytes were downloaded from the immutable public Release and matched.
Update manifest sequence `5` binds the observed GitHub
asset IDs, sizes, hashes, installer signatures, source identity, public-export
tree, and release-manifest digest.

`pnpm readback:release v0.5.6` passed for the exact ten-asset set,
tag-to-source identity, public-export identity, GitHub sizes/digests,
`SHA256SUMS`, the signed update manifest, and each installer signature.
