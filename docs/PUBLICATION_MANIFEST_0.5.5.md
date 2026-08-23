# PUBLICATION_MANIFEST 0.5.5

Status: `IMMUTABLE`

| Field | Value |
| --- | --- |
| productVersion | `0.5.5` |
| DSH | `0.1.1-rc.2` |
| trustTier | `community-verified` |
| source SHA | `2136ff691afa8bdbefa3079236426a72a3851237` |
| public export tree | `a55c3d7a3010b4734c58ae8f59690685bea8369f462a2f62d434a7cca24d2d16` (638 files) |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | [`v0.5.5`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.5), Release `375290439`, immutable |
| native run | [`32656584336`](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32656584336), all three targets PASS |
| publication channel | `stable-v0.5.5` |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | `Penglai_0.5.5_macos_aarch64.dmg` | 461033213 | `51a145ec4f6b74a7fca1eba851bd58496517c340233816c0c02171c3745ad136` |
| Intel Mac | `Penglai_0.5.5_macos_x64.dmg` | 390157471 | `7d5245543c6ee12b90fdcdaa8aae81a3d9fc92f9b4b376732dac9244a74552dd` |
| Windows x64 | `Penglai_0.5.5_windows_x64_setup.exe` | 355983707 | `2539bb423d7a4f53f012a08f7938644cf26e8717f777f0ef9a5893b120a44e03` |

The exact Release set is those three installers plus `update-manifest-v1.json`, `update-manifest-v1.json.sig`, `release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`, `SHA256SUMS`, and `public-export-manifest.json`.

The three matching native jobs passed clean export, exact installer identity,
Electron fuse checks, installed welcome/process smoke, and installed first-party
plugin compatibility. The Windows job additionally passed its native
Simplified Chinese NSIS screenshot gate. Update manifest sequence `4` binds the
three GitHub asset IDs, sizes, hashes, detached installer signatures, source
identity, public-export tree, and release-manifest digest.

After publication, `readback:release v0.5.5` downloaded all ten public assets
and returned `PASS` for the immutable flag, exact asset set, tag-to-source
identity, SHA256SUMS, update-manifest signature, and all three installer
signatures. No value in this manifest is a predicted candidate value.
