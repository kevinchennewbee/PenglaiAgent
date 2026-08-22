# PUBLICATION_MANIFEST 0.5.3

Status: `PUBLISHED_IMMUTABLE`

| Field | Value |
| --- | --- |
| productVersion | `0.5.3` |
| DSH | `0.1.1-rc.1` |
| trustTier | `community-verified` |
| source SHA | `afc75b2b553c6ae803d16e46e37a40a80738a0b9` |
| publicExportTreeSha256 | `d9a786673bd248b793fb4c7cfbbe867725dd2716cc1c968aad26bab234942622` |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | `v0.5.3` |
| publication channel | `stable-v0.5.3` |

| Target | Exact installer | Native result | SHA-256 |
| --- | --- | --- | --- |
| Apple Silicon | `Penglai_0.5.3_macos_aarch64.dmg` | PASS | `2111a99a896a003b47a1dda25e1c4ec4adcab64d562975b0a1a0f7e7079d26e0` |
| Intel Mac | `Penglai_0.5.3_macos_x64.dmg` | PASS | `ad7375201738be080d65c89a14ebaa3a85fd88fe2f72bf3cb9d69cd89cddab35` |
| Windows x64 | `Penglai_0.5.3_windows_x64_setup.exe` | PASS | `7c45199983026ed8aad94c4ee6e662591cbf536e407253335393c44a88352244` |

The immutable Release must contain exactly those three installers plus `update-manifest-v1.json`, `update-manifest-v1.json.sig`, `release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`, `SHA256SUMS`, and `public-export-manifest.json`.

The update manifest must declare version `0.5.3`, release tag `v0.5.3`, all three exact target assets, and minimum source version `0.5.1`. It must bind each asset's GitHub asset ID, size, SHA-256, detached signature, source identity, public-export tree, and release-manifest digest.

The exact ten-asset Release was published at `2026-08-22T08:29:45Z` and then made immutable. Tag `v0.5.3`, GitHub Release `374853843`, and native run [`32560185691`](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/32560185691) all bind the source identity above. All three native jobs passed clean export, exact installer identity, Electron fuses, installed welcome/process smoke, and the four-phase first-party plugin compatibility gate.

Remote GitHub asset metadata reports the same SHA-256 values as the locally verified upload bytes. `update-manifest-v1.json` sequence 3 binds the exact GitHub asset ids, minimum source version `0.5.1`, source SHA, public-export tree, asset sizes, and detached Ed25519 signatures. Apple Silicon is `443178529` bytes, Intel Mac is `368144533` bytes, and Windows x64 is `332301887` bytes.

The public 0.5.1 updater downloaded the exact Apple Silicon bytes, reached `READY_FOR_USER`, required native confirmation, and opened the verified DMG. After the system-level copy, the published 0.5.3 application launched official DSH with the preserved Workspace and reported `COMMITTED / 0.5.3`. A separate 0.5.1 fresh-profile wizard defect can keep the visible Settings entry unreachable; the publication notes document that source-version limitation and the manual same-platform overlay.

The community updater signature proves Penglai Release integrity only. macOS remains ad-hoc signed and not notarized; Windows remains without Authenticode. CodeQL retains an explicit open baseline, so this publication does not claim a zero-alert scan.
