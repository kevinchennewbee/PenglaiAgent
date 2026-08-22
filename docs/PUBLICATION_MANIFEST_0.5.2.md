# PUBLICATION_MANIFEST 0.5.2

Status: `PUBLISHED_WITH_POST_VERIFY_DEFECT`

The immutable v0.5.2 bytes are preserved. A real public 0.5.1 assisted-update drill installed and launched 0.5.2 but ended in `RECOVERY_REQUIRED / POST_VERIFY_FAILED` because the optional IM plugin was incorrectly required by post-verification. See `RELEASE_NOTES_0.5.2.md` and the 0.5.3 replacement contract.

| Field | Value |
| --- | --- |
| productVersion | `0.5.2` |
| DSH | `0.1.1-rc.1` |
| trustTier | `community-verified` |
| source SHA | `UNFROZEN` |
| publicExportTreeSha256 | `UNFROZEN` |
| repository | `kevinchennewbee/PenglaiAgent` |
| tag / Release | `v0.5.2` |
| publication channel | `stable-v0.5.2` |

| Target | Exact installer | Native result | SHA-256 |
| --- | --- | --- | --- |
| Apple Silicon | `Penglai_0.5.2_macos_aarch64.dmg` | NOT_RUN | UNFROZEN |
| Intel Mac | `Penglai_0.5.2_macos_x64.dmg` | NOT_RUN | UNFROZEN |
| Windows x64 | `Penglai_0.5.2_windows_x64_setup.exe` | NOT_RUN | UNFROZEN |

The immutable Release must contain exactly those three installers plus `update-manifest-v1.json`, `update-manifest-v1.json.sig`, `release-manifest.json`, `SBOM.cdx.json`, `THIRD_PARTY_NOTICES.txt`, `SHA256SUMS`, and `public-export-manifest.json`.

The update manifest must declare version `0.5.2`, release tag `v0.5.2`, all three exact target assets, and minimum source version `0.5.1`. It must bind each asset's GitHub asset ID, size, SHA-256, detached signature, source identity, public-export tree, and release-manifest digest.

This file may move from `UNFROZEN` only after the exact merged-main bytes and native evidence are known. It must not predict hashes or PASS results.
