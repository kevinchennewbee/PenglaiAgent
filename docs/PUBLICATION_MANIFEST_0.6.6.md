# PUBLICATION_MANIFEST 0.6.6

Status: `PUBLIC_READBACK_PASS`

The public readback downloaded all ten immutable assets after publication and verified their exact sizes, SHA-256 digests, update signature, and installer signatures. This document records those observed public bytes. The source `release-contract.json` remains a development template with `phase=UNFROZEN`; it is not substituted for generated release identity.

| Field | Value |
| --- | --- |
| Product | `0.6.6` |
| DSH | official npm `0.1.7-alpha.2`; tag `dsh-v0.1.7-alpha.2`; commit `00102833dfaee1da9f48a3a8eae9d34005a75218` |
| Upstream cohort | 323 packages: 309 DSH, nine vendor, five native |
| Build source SHA | `519a24be3702257bc7b0e0230d19fe3affd0a31b` |
| Peeled tag source | `519a24be3702257bc7b0e0230d19fe3affd0a31b` (`refs/tags/v0.6.6`) |
| Release | [`v0.6.6`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.6), immutable |
| Release id | `394313621` |
| Published at | `2026-09-23T05:16:08Z` |
| Public readback | `PASS`; asset-set seal `ecdc9a2d6bdd7f273672bee1c5e191fdb6d542859f0184b2797a37f00bbb8378`; update signature and installer signatures verified |
| Public source export | tree `6e1fe711a486e8316494a48a7fc02afed69d47c04bcbf318d8323ea28ccb4701`; 1,483 files; clean-room install and typecheck passed |
| Source CI | [35817658763](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35817658763) on the build SHA |
| Native targets | [35817677240](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35817677240): darwin-aarch64, win32-x86_64, linux-loong64; exact aggregate PASS; Intel Mac excluded |
| Publish and public readback | [35821611965](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35821611965) |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode; UOS Electron 31.7.7 / Chromium 126 and Node 22.16.0 without Mac/Windows security parity |
| Native UOS | `OWNER_POST_RELEASE` |
| Signed updater | Apple Silicon and Windows x64 |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.6_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/Penglai_0.6.6_macos_aarch64.dmg) | 283,439,892 | `67bc660b3d5befd5bee202a7c4025bbac2e6340761b666737e5be43e696da12c` |
| [`Penglai_0.6.6_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/Penglai_0.6.6_uos_loong64.deb) | 282,171,212 | `0c83c89a579112bb644b8ae472fda0ab5ce3eb05829cb158f09c526c70c9c406` |
| [`Penglai_0.6.6_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/Penglai_0.6.6_windows_x64_setup.exe) | 365,164,936 | `8a2a801e1b1bb11a0ab4681a6165908dbef37d47f321ee443a7ffebc922042f8` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/public-export-manifest.json) | 336,587 | `7ea221b4fbf0b865479b1e78f0fad292fce9d491a917521c7f5abef08a26807f` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/release-manifest.json) | 756 | `88b5fa9874a44baa90403f7c1c12add28118150d252eb90505ebdda6b135164e` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/SBOM.cdx.json) | 1,115,029 | `4ce165ae52547d37e6c8c5cf930edaa1c2e422c71df4b14fa4e82869ce6fad73` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/SHA256SUMS) | 832 | `4d32642e1fc952d17bbb19babb54bf9c2087b684d04927ba6c34d33609d3b2f6` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/THIRD_PARTY_NOTICES.txt) | 151,890 | `da988f45f1c16386aacf65297d9d87a3ab5e191a5a10aff4d9f3583c28d47e59` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/update-manifest-v1.json) | 1,659 | `be00ac7378389f303ee5a16d180034f2aca182b6fe91d54f133e6f0ba79cc0c9` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.6/update-manifest-v1.json.sig) | 64 | `cfddf171cba21f855dd8e12978dff26b461c68caf6123bb18eba5760da284c26` |

## Scoped validation

| Gate | Result |
| --- | --- |
| `verify:release` on the build SHA | `PASS`; 23 gates, no failed gate |
| `verify:evidence` hard ids | `PASS`; 80 pass, 0 fail, 0 notRun, 0 duplicate, 0 stale |
| `prepare:public-export` clean room | `PASS`; 1,483 files, lock-only install and typecheck passed |
| `verify:drift` after updating the current-release security entry | `PASS`; five probes passed, zero drift or blocked (publication-document candidate, after public readback) |
| Draft readback | `PASS`; ten assets, update signature and installer signatures verified |
| Immutable public readback | `PASS`; same ten assets, `immutable=true` |

## Not claimed

- Two-hour installed soak: `OWNER_EXCLUDED`.
- UOS native install, startup, UI, file picker, sleep/resume, and function: `OWNER_POST_RELEASE`.
- macOS notarization and Windows Authenticode: `NOT_RUN` for this release.
- Optional private-account IM/iMessage live delivery: outside publication acceptance.

## 中文

0.6.6 的三个原生安装包与十项不可变公开附件均来自上述同一源码提交。Mac 和 Windows 的全新安装、重启、默认卸载，以及从 0.6.3、0.6.5 安装版升级并保留用户数据已通过。UOS 仅声称包、ABI、架构与闭包验证通过；真机功能仍待 Owner 发布后验收。完整十项附件从公网下载后逐字节验证通过。
