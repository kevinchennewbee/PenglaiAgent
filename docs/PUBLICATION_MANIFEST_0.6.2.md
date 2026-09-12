# PUBLICATION_MANIFEST 0.6.2

Status: `PUBLIC_READBACK_PASS`

The original public readback downloaded all ten immutable assets after
publication and verified their exact sizes, SHA-256 digests, update signature,
and installer signatures. This document records those observed public bytes.
Committed source templates remain `phase=UNFROZEN` and `sourceSha=NONE`; they
are not substituted for generated release identity.

| Field | Value |
| --- | --- |
| Product | `0.6.2` |
| DSH | official unmodified npm `0.1.5-rc.2`; tag `dsh-v0.1.5-rc.2`; commit `fb2c4b9e698e30edb738bca4cf0618587db7d203` |
| Upstream cohort | 279 packages: 265 DSH, nine vendor, five native |
| Build source SHA | `83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6` |
| Peeled tag source | `83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6` (`refs/tags/v0.6.2`) |
| Release | [`v0.6.2`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.2), immutable |
| Release id | `387670584` |
| Published at | `2026-09-12T18:56:53Z` |
| Public readback | `PASS`; asset-set seal `700d4b1da945674115d11355d7ea4070f68678026b7073e7f3fb5f0a4f775e0b`; update signature and all installer signatures verified |
| Public source export | tree `2272bd45d55ce99dd8df6f048029fb083fb6fc3d8877131d1773c772e61ef264` |
| Source CI run | [34709659692](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709659692) on the build SHA |
| CodeQL run | [34709659600](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709659600) on the build SHA; zero open alerts at release |
| Native targets | [34709915417](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34709915417): darwin-aarch64, win32-x86_64, linux-loong64; exact aggregate PASS; Intel Mac excluded |
| Publish and readback | [34712617415](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34712617415) |
| Website deploy and readback | [34714111473](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/34714111473): sealed website deployed; every public file matched at Cloudflare Pages and GitHub Pages |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode; UOS Electron 31.7.7 / Chromium 126 and Node 22.16.0 unmaintained, without Mac/Windows security parity |
| Native UOS | `OWNER_POST_RELEASE` |
| Signed updater | Apple Silicon and Windows x64 |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.2_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/Penglai_0.6.2_macos_aarch64.dmg) | 284,537,443 | `7a9e6d851c954e74d8af8ad8d4054838ad212dd575a82ad783cabd09bfdd9348` |
| [`Penglai_0.6.2_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/Penglai_0.6.2_windows_x64_setup.exe) | 371,269,392 | `3e97111bfcefa3c1ab72e70aad6b160acb76f6bef70391f8be4818d80edb8cda` |
| [`Penglai_0.6.2_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/Penglai_0.6.2_uos_loong64.deb) | 293,093,278 | `d16d6b9569095b4d599e9da5afd5c325ebbb661ac7de21ce993fd281bf2998f7` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/update-manifest-v1.json) | 1,621 | `dc7d17006df08432b1ed1be0ebdbbf1785a90de5cdb88a6f8a9bb1bf433f0bd2` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/update-manifest-v1.json.sig) | 64 | `0a1bbaf9873903244e94ebb97a21816eb26f0ea7ff1783b20ede06423f7c6cbe` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/release-manifest.json) | 756 | `4b07dcb6ced893ca529bfecf66bff80e9dad09985b21eb7b9d9704be0a6e31ef` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/SBOM.cdx.json) | 1,097,189 | `874f6f8b62fd7735aa767a9b3940aa7a02a42de4c0313077e6777eaa153c2940` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/THIRD_PARTY_NOTICES.txt) | 161,525 | `f3436e29ee4037b7f80ee88e106cafa92af6a22ee0b14302087874104c8d89bf` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/SHA256SUMS) | 832 | `d0644d5dbffd1d3d9d1c651f1dcaaa477c3fe9d23e43802c8e95584a36648735` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.2/public-export-manifest.json) | 327,083 | `2d46d773208d1d659710bf3c256abd06351f4b56cacc6283263158c6b1c51f77` |

## Scoped completed validation

- The stable GitHub Release is `draft=false`, `prerelease=false`, and
  `immutable=true`; its tag and release manifest both bind the build SHA.
- The complete 279-package official npm cohort and packaged runtime closure
  passed integrity, license, dependency, secret, and public-export gates.
- Apple Silicon and Windows x64 passed fresh install, restart, invalid-folder
  rejection, credential-failure recovery, official first reply, installed
  plugin checks, the installed 0.6.1 to 0.6.2 upgrade, preservation, rollback,
  and default uninstall on the final packages.
- The UOS package passed exact identity, ABI, dependency closure, runtime,
  first-party plugin, license, and architecture checks.

Explicitly not PASS:

- Native UOS install, startup, UI, file picker, sleep/resume, model
  conversation, Office, and Memory: `OWNER_POST_RELEASE`.
- Two-hour installed soak: `OWNER_EXCLUDED`.
- Optional private-account IM and iMessage live delivery: `NOT_RUN`.
- Default Defender-enabled Windows: not verified. Native Windows checks used
  the hosted runner's existing configuration.
- macOS notarization and Windows Authenticode: not present.
- Packaged PDF page-image preview: deferred. The generic sidebar is not a
  DOCX renderer.

## 中文

以上十项附件均由原始公网回读从不可变发布下载核对，文件大小、SHA-256、更新签名
和安装器签名全部通过。三个安装包来自同一源码
`83ce4aa3c153b63d9f84c6a5d650a3727e8cfec6`。Intel Mac、Linux amd64 和
Windows ARM 不是 0.6.2 目标。

Apple 芯片与 Windows x64 已完成全新安装、重启、错误目录拒绝、凭据失败恢复、
首条官方回复、已安装插件、0.6.1 到 0.6.2 真实升级、数据保留、回滚与默认卸载。
UOS 包身份、ABI、依赖闭包、运行时、第一方插件、许可和架构验证通过；真机安装、
启动、界面、文件选择器、休眠恢复、模型会话、办公与记忆仍为
`OWNER_POST_RELEASE`。macOS 未公证，Windows 无 Authenticode，默认开启 Defender
的 Windows 尚未验证。两小时安装版测试为 `OWNER_EXCLUDED`。
