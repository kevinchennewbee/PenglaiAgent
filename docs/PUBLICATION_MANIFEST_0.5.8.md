# PUBLICATION_MANIFEST 0.5.8

Status: `PUBLIC_READBACK_PASS`

The immutable public Release was assembled from the clean export of the exact
source SHA below. GitHub-hosted bytes, SHA-256 values, the update-manifest
signature, and all three installer digests were downloaded and verified after
publication. The committed `release-info.json` remains a non-self-referential
template with `phase=UNFROZEN` and `sourceSha=NONE`; generated build and public
manifests bind the observed release identity instead.

| Field | Value |
| --- | --- |
| productVersion | `0.5.8` |
| DSH | official source tag `dsh-v0.1.2-alpha.1`, commit `cd5ef8148158c3a752a658978873241fdf8e2bbc` |
| DSH closure | 251 reproducible local tarballs; no unofficial npm publication |
| trustTier | `community-verified` |
| source SHA | `80c8ee81de7a683a1d366bdba0f354826df0a914` |
| public export tree | `5dfa28c4e43cfa6039479e7341cf1bdc2f8ced4ce8744dcc00fd4e12c102c69a` |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | [`v0.5.8`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.8), immutable |
| native run | [33310265795](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33310265795), three targets PASS |
| public readback | [33313380755](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/33313380755), PASS |
| publication channel | `stable-v0.5.8` |
| SBOM | 778 components |
| installed welcome | title `蓬莱 Penglai`; upstream internal notice false; duplicate credentials onboarding false |
| plugins | all bundled first-party plugins complete the installed lifecycle on all three targets |
| Messaging | eight `@penglai/im` entries; WhatsApp absent from the 0.5.8 product surface |

| Target | Exact installer | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| Apple Silicon | [`Penglai_0.5.8_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_macos_aarch64.dmg) | 470,071,594 | `cc08a1820f92be4fe5a851a4cfd33f02ab48035c8e98f72feacb2fd074a9b992` |
| Intel Mac | [`Penglai_0.5.8_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_macos_x64.dmg) | 412,716,622 | `14d0c4edf572c134d9d71e6dea69a4bcf53b46cf31ed267fe8472c2f1a4c1b00` |
| Windows x64 | [`Penglai_0.5.8_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.8/Penglai_0.5.8_windows_x64_setup.exe) | 359,890,576 | `0a238bec35ea5117619a5112566ba6985f2194873eb60ef7110d1ca21bc1bec5` |

The exact immutable Release set is those three installers plus:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `SBOM.cdx.json` | 632,150 | `61eb7aaaa6927c21cc41f09f0c9658047a121c7ab24b1714bcb8a69dfc982de2` |
| `SHA256SUMS` | 830 | `2b0bf22efa1ca121016ff99fffa667467c7ea57adf4ccbec8ac1c48ede2a7563` |
| `THIRD_PARTY_NOTICES.txt` | 173,120 | `2b3a8f47e6f1dc9fabcd50e9c3a4896bdfdd6e96710a80762febbd85d0991602` |
| `public-export-manifest.json` | 267,584 | `329dfb630d2f6472d4c2c93bc752af1ada1b3973166268a9353f1622f6fec726` |
| `release-manifest.json` | 754 | `7fecc0837f75679777cca3fd9b85a627382ac78286b772877d6362f5e2dfa6a3` |
| `update-manifest-v1.json` | 2,014 | `3012b929dc53ff1a9a3531a91c2bd0ad8efe2242d02d9d090eb6fa4ebaaf417e` |
| `update-manifest-v1.json.sig` | 64 | `0c2c60b57e6b3dd856ba25e1a01c0905a833dcc15182690ae482c1065272ca08` |

Owner-account connector journeys and a two-hour installed soak are supplemental
`LIVE_NOT_RUN` evidence and are not claimed as PASS. The public GitHub Release is
the authoritative 0.5.8 download surface; no 0.5.8 Beijing mirror is claimed.
