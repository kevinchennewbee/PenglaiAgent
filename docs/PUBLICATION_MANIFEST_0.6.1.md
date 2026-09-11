# PUBLICATION_MANIFEST 0.6.1

Status: `PUBLIC_READBACK_PASS`

Original public readback observed all ten immutable assets after publication.
Exact sizes, SHA-256 digests, update signature and installer signatures passed
that readback. This table records those observed public bytes. Source templates
remain `UNFROZEN` and are not substituted for generated release identities.
This documentation commit does not download the installers again.

| Field | Value |
| --- | --- |
| Product | `0.6.1` |
| DSH | official unmodified npm `0.1.5-rc.1`; tag `dsh-v0.1.5-rc.1`; commit `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` |
| Upstream cohort | 279 packages |
| Build source SHA | `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b` |
| Peeled tag source | `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b` (`refs/tags/v0.6.1` lightweight commit object) |
| Release | [`v0.6.1`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.1), immutable |
| Release id | `386731273` |
| Published at | `2026-09-11T01:56:13Z` |
| Public readback | `PASS` at `2026-09-11T01:59:04Z`; asset-set seal `9260e5cf3e318822391cee02de5aca5a4440810e9f6de71aa983fe58075171be`; workflow artifact `penglai-0.6.1-public-readback` (`10181394734`, SHA-256 `038ba60d61810c428e637294d13b452d3477d2ca4c67c190b0c76fbd2ae030ab`) |
| Three installer targets | native run [34548435454](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34548435454): darwin-aarch64, win32-x86_64, linux-loong64. Intel Mac excluded. |
| Source CI run | [34548407591](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34548407591) on the freeze SHA |
| CodeQL run | [34548407240](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34548407240) on the freeze SHA |
| Publish run | [34552514921](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34552514921) |
| Signed catalog | live [`plugin-catalog-v1.000006`](https://github.com/kevinchennewbee/PenglaiPluginRegistry/releases/tag/plugin-catalog-v1.000006); catalog run [34548437872](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34548437872). No new catalog sequence was published; 000006 remains the immutable live catalog. |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode; UOS Electron 31.7.7 / Chromium 126 and Node 22.16.0 not maintained, no Mac/Windows security parity |
| Native UOS | `OWNER_POST_RELEASE` |
| Signed updater | Apple Silicon and Windows x64 |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.1_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_macos_aarch64.dmg) | 284,369,412 | `91393e2e760871694e836c2582b903f6fee509e9fa11391724567e472f9946e9` |
| [`Penglai_0.6.1_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_windows_x64_setup.exe) | 371,266,017 | `d4fb670edea847024abcb2a1ac760cc2f7c5814d0c60f77f80ec647c59f51791` |
| [`Penglai_0.6.1_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/Penglai_0.6.1_uos_loong64.deb) | 293,074,470 | `cd38c06e37151f226e7f9eb2519dba0800fc9ed7f4449d2b7edd5a282efb5934` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/update-manifest-v1.json) | 1,621 | `dc50d8b632d759148ae276334f465dd70f51e2a712e724f809b292948700aed6` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/update-manifest-v1.json.sig) | 64 | `be2248f730b71ddbf14aec8e69a3ff9c1183c01789cc7f56cb29b2f0628cf2df` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/release-manifest.json) | 756 | `eb4f0b0cfa83ca7fd2befae0e6b12c878d96385e13ddefed785c0693cd308de8` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/SBOM.cdx.json) | 1,096,426 | `d5427948422a72d0febd41ea9ab1d0534ea43e1338b2ffc508782d6441b85bbc` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/THIRD_PARTY_NOTICES.txt) | 161,338 | `5866df9c4d59e17cf83b54aa9436daeca63c38870bd44b8dbbbb5ceaea811ebc` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/SHA256SUMS) | 832 | `c2171d5aa5117c6a18c29c372a22ca7cf85c50348af10902e354a494b0c4ed80` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.1/public-export-manifest.json) | 323,738 | `3c40615cfc24724cc80026e2ecd656cb3e61fdf26860072b1ab6a7782b9d2ebc` |

Public asset-set seal: `9260e5cf3e318822391cee02de5aca5a4440810e9f6de71aa983fe58075171be`.
Original public hashes matched the uploaded stage for all ten assets.

## Scoped completed validation

Completed on the published `v0.6.1` bytes / freeze SHA, as recorded by the
original public readback and owner-verified native evidence:

- Immutable GitHub Release `v0.6.1` (`draft=false`, `prerelease=false`,
  `immutable=true`), target_commitish `7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`.
- Ten public assets, installer signatures, and the signed updater.
- Final-package installer identity, deep code signature, fresh isolated boot,
  invalid-key rejection, and real-provider retry: PASS.
- File, image, Office action-confirmed write, Memory A-B isolation plus
  restart, and English Dark GUI: completed on the preceding 0.6.1 package
  whose 331 relevant product files are unchanged at `7ad7c29` (only two tests
  differed).

Explicitly not PASS, and not turned into a mandatory repeat gate:

- Physical UOS install, startup, and function: `OWNER_POST_RELEASE`.
- Old-version installed upgrade and two-hour soak: `OWNER_EXCLUDED`.
- Optional account IM: not run.
- New Workspace live conversation on the final package: `NOT_RUN`
  (supplemental; live account repeats stay supplemental).
- Default Defender-enabled Windows: not verified. Native Windows checks used
  the hosted runner's existing configuration.
- Packaged PDF page-image preview remains deferred. Generic sidebar is not a
  DOCX renderer. adm-zip ONNX install-script extraction path is disabled.

Do not publish private profile paths, PIDs, credential-helper paths, keys, log
contents, or screen details. Published `v0.5.10`, `v0.5.11`, `v0.5.12`, and
`v0.6.0` tags and assets were not rewritten.

## 中文

以上十项附件均已由原始公开回读从不可变公开发布核对，文件大小、摘要、更新签名
及安装器签名通过验证。三个安装包来自同一源码
`7ad7c29ecda5d9e867fdde0fe3fefd5c42d3ab1b`。Intel Mac 不是 0.6.1 目标。
Mac/Windows 验证全新安装与默认卸载保留用户数据。UOS 真机安装/启动/功能仍为
Owner 发布后测试。macOS 为 ad-hoc 签名、未公证；Windows 无 Authenticode。
Windows 原生检查使用托管运行器现有安全配置，尚未验证默认开启 Defender 的系统。
无凭据测试不代表真实账号消息送达。已发布的 0.5.10、0.5.11、0.5.12 与 0.6.0
标签与附件未被改写。
