# PUBLICATION_MANIFEST 0.5.12

Status: `PUBLIC_READBACK_PASS`

All ten immutable assets were downloaded after publication. Their exact sizes, SHA-256 digests, update signature and installer signatures passed verification. The table records observed public bytes; source templates remain `UNFROZEN` and are not substituted for generated release identities.

| Field | Value |
| --- | --- |
| Product | `0.5.12` |
| DSH | official unmodified npm `0.1.3-alpha.2`; tag `dsh-v0.1.3-alpha.2`; commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9` |
| Upstream cohort | 263 packages with registry archive, signature and fixed-source manifest verification |
| Build source SHA | `54a0ef30afa4e3d653e400a637d4aa8eb4abbb75` |
| Public export tree | `6ee3670247e0a75c9b78f80da0449934fa88d50d959b2640fbe6bb57f1559c62` |
| Release | [`v0.5.12`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.5.12), immutable |
| Three native targets | [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34293608792) |
| Complete publication and public readback | [PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34305249020) |
| Signed catalog | live [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006) verified after native publication: [catalog mode PASS](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34306423051) (`verify:live-plugin-catalog`, disabled install, offline recovery). Native run `34293608792` skipped this job because `mode: native`. No new catalog sequence was published; 000006 remains the immutable live catalog. |
| Update sequence | `8` |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.5.12_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/Penglai_0.5.12_macos_aarch64.dmg) | 284,207,080 | `1f6d7f9ceab13c62a6e31d52a0517c4972a52378e5ce102bf2983f3c32fd8034` |
| [`Penglai_0.5.12_macos_x64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/Penglai_0.5.12_macos_x64.dmg) | 293,808,479 | `f82a5d44bccb7d15def176602f8320d1464eae802897e41c5ec39c8d471d61c3` |
| [`Penglai_0.5.12_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/Penglai_0.5.12_windows_x64_setup.exe) | 371,054,561 | `5d926a884ca2b93c43f8ee8d8e8897df636585d449f1810d25ab4bffae3159da` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/SBOM.cdx.json) | 1,212,321 | `a5865f974c889ace54d6d043c4d4c8417f67e785d75ebd254acb68a31914cc3b` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/SHA256SUMS) | 833 | `d2ee615709f5883219f68cd9d45326975484891a7488e1dbc37461a7b65d1754` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/THIRD_PARTY_NOTICES.txt) | 186,668 | `5ee7590fdb7a546ad17284caf362ea998abf6d92eb765971287d398ce2196c0c` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/public-export-manifest.json) | 293,031 | `3c43880ce2fb35dc38ce628d46fdac9e07d80363c3194bdd55534dc46f878b3f` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/release-manifest.json) | 758 | `6fba9db1b549538cb2ffffb93c441e3cb7af5810f8b6576ed94968a57c1cca44` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/update-manifest-v1.json) | 2,023 | `cb7b8464485f3682bf4b44e51780a47a010d26ce94fb291feb0ac1db330825de` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.5.12/update-manifest-v1.json.sig) | 64 | `f94452244ec05f22e7f144448e47fc2b26f90658131585c0384cfdd2915dc720` |

Native lifecycle verification covers 0.5.8, 0.5.9, 0.5.10 and 0.5.11 upgrades on each target, with default uninstall preserving user data. Installed resource UI tests and native executable checks retain their separate evidence classes. Packaged PDF page-image preview and bundled Poppler are deferred by Owner / out of scope, not PASS. GitHub-hosted Windows runners observed Defender realtime monitoring already off with broad `C:\` / `D:\` exclusions before Penglai; Penglai did not mutate Defender. That is not default-OS Defender-on proof. Private account delivery and real provider responses are not inferred from credential-free tests. Published `v0.5.10` and `v0.5.11` tags and assets were not rewritten.

## 中文

以上十项附件均已从不可变公开发布下载回读，文件大小、摘要、更新签名及安装器签名通过验证。三端来自同一源码 `54a0ef30afa4e3d653e400a637d4aa8eb4abbb75`，均验证 0.5.8、0.5.9、0.5.10、0.5.11 升级路径与默认卸载数据保留。新增 PDF 页预览与捆绑 Poppler 由 Owner 推迟，不是 PASS。托管 Windows 上的 Defender 默认开启未取证。无凭据测试不代表真实模型回复或私人账号消息送达；系统公证与发布者信誉限制见上表。已发布的 0.5.10 与 0.5.11 标签与附件未被改写。
