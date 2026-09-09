# PUBLICATION_MANIFEST 0.6.0

Status: `PUBLIC_READBACK_PASS`

All eleven immutable assets were downloaded after publication. Their exact sizes, SHA-256 digests, update signature and installer signatures passed verification. The table records observed public bytes; source templates remain `UNFROZEN` and are not substituted for generated release identities.

| Field | Value |
| --- | --- |
| Product | `0.6.0` |
| DSH | official unmodified npm `0.1.5-alpha.1`; tag `dsh-v0.1.5-alpha.1`; commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a` |
| Upstream cohort | 272 packages with registry archive, signature and fixed-source manifest verification |
| Build source SHA | `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316` |
| Public export tree | `c385fd9d32d776dd14c2707d5ed0276cf1e8d38f90e7511403f7c39c83b97ea4` |
| Release | [`v0.6.0`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.0), immutable |
| Four installer targets | native run [34376799819](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376799819): darwin-aarch64, darwin-x86_64, win32-x86_64, linux-loong64 packaging SUCCESS; GitHub aggregate job FAILED on UOS collector path (not PASS, not waived) |
| Source CI | [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376782684) on the freeze SHA |
| CodeQL | [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34376781577) on the freeze SHA |
| Signed catalog | live [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006) verified after freeze: [catalog mode PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34415171352) (`verify:live-plugin-catalog`, disabled install, offline recovery, `dshExact` `0.1.5-alpha.1`). No new catalog sequence was published; 000006 remains the immutable live catalog. |
| Update sequence | `9` |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode; UOS Electron 31.7.7 / Chromium 126 not maintained, no Mac/Windows security parity |
| Native UOS | `OWNER_POST_RELEASE` |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.0_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_aarch64.dmg) | 284,362,933 | `98d1c0a133d50200c03626d39e225a52ff08d1f1a09fdb1595ab706b70f183cb` |
| [`Penglai_0.6.0_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_macos_x64.dmg) | 293,996,120 | `4c74a4ce9353ccf23aa74471d279237c4b5b9822d118aa2a90e44e16caf16498` |
| [`Penglai_0.6.0_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_windows_x64_setup.exe) | 369,849,038 | `6316f623fe877686662b7b3a5641945bc946e2b1dd31bf3d9527c6a17f7c35e9` |
| [`Penglai_0.6.0_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/Penglai_0.6.0_uos_loong64.deb) | 292,702,128 | `a541e9fa9b06626750b4a87859cc76ff3df51b5a0eb8960de08e8eba20cad430` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/SBOM.cdx.json) | 1,225,591 | `a611ff09c447f1baf27cf9d7c3033c43ee1039fcebf961b5a94a8fa882b8f29c` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/SHA256SUMS) | 926 | `774c16af532cf853188ee0146260578874ce70153ba8e4cbe6efba9d0cfb5581` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/THIRD_PARTY_NOTICES.txt) | 188,338 | `45b4aa3fc12ee55b0579a7937e5cd392e41a5243f6f1da8714a1daf10bde2d69` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/public-export-manifest.json) | 311,512 | `18824ddb84ccbd7cb9d5091fa825c3c1caf56558009ca750232244917a437bef` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/release-manifest.json) | 923 | `34eabe0544b862c911a9ddb51261401e7239b94c4d07e6b1a673247699fc7734` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/update-manifest-v1.json) | 2,014 | `1461b6934da1b2d012b07e823409e4fa3d6358cd1a5ac31dad6eea65281423f8` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.0/update-manifest-v1.json.sig) | 64 | `88a8fa77ead8fc335da3219448ea48585251d43ac868f38cbb6300d94ca70f99` |

Public asset-set seal: `f2a5b3245b6810bc54f2f0c7990daaef66cf2ea2bdc87332c351e324b56daaef`. Native lifecycle verification covers the published 0.5.12 upgrade on matching Mac/Windows hosts, with default uninstall preserving user data. Installed resource UI tests and native executable checks retain their separate evidence classes. Independent PM representative GUI on the exact Apple Silicon bytes passed. Native UOS function remains Owner post-publication. GitHub-hosted Windows runners are not default-OS Defender-on proof. Private account delivery and real provider responses are not inferred from credential-free tests. Published `v0.5.10`, `v0.5.11`, and `v0.5.12` tags and assets were not rewritten.

## 中文

以上十一项附件均已从不可变公开发布下载回读，文件大小、摘要、更新签名及安装器签名通过验证。四端安装包来自同一源码 `7dd68b4ab08bbe4edf4dfac7f82abb6b164cb316`。Mac/Windows 验证从 0.5.12 升级与默认卸载保留用户数据。GitHub 四端汇总作业因 UOS 收集路径失败，不能标 PASS。UOS 真机安装/启动/功能仍为 Owner 发布后测试。macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。无凭据测试不代表真实模型回复或私人账号消息送达。已发布的 0.5.10、0.5.11 与 0.5.12 标签与附件未被改写。
