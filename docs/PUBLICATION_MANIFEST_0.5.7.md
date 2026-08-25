# PUBLICATION_MANIFEST 0.5.7

Status: `CANDIDATE`

Committed identity is a template. `release-info.json` keeps `phase=UNFROZEN`
and `sourceSha=NONE` so the source tree does not invent a self-referential
commit. Candidate evidence is generated at build time and bound to the real
Git SHA. Observed public SHA, size, and digest are written here only after
`pnpm readback:release v0.5.7` passes.

| Field | Value |
| --- | --- |
| productVersion | `0.5.7` |
| DSH | `0.1.1-rc.2` |
| trustTier | `community-verified` |
| source SHA | `NONE` until freeze; public docs wait for readback |
| public export tree | pending clean-room export |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | `v0.5.7` (not created in Grok Build) |
| native run | `NOT_RUN` |
| publication channel | `stable-v0.5.7` |
| live IM | see `docs/0.5.7/LIVE_IM_MATRIX.md` |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | `Penglai_0.5.7_macos_aarch64.dmg` | pending | pending public readback |
| Intel Mac | `Penglai_0.5.7_macos_x64.dmg` | pending | pending public readback |
| Windows x64 | `Penglai_0.5.7_windows_x64_setup.exe` | pending | pending public readback |

The exact Release set is those three installers plus
`update-manifest-v1.json`, `update-manifest-v1.json.sig`,
`release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`,
`SHA256SUMS`, and `public-export-manifest.json`.
