# PUBLICATION_MANIFEST 0.6.3

Status: `PUBLIC_READBACK_PASS`

The publication workflow downloaded all ten immutable assets after publication
and verified exact sizes, SHA-256 digests, the update-manifest Ed25519
signature, and the Mac/Windows installer signatures. This document records the
observed public bytes. The committed release template intentionally remains
`phase=UNFROZEN` / `sourceSha=NONE`; generated release identity is authoritative.

| Field | Value |
| --- | --- |
| Product | `0.6.3` |
| DSH | official npm/source cohort `0.1.6-alpha.2`; tag `dsh-v0.1.6-alpha.2`; commit `ddefc45fbc7f8e46dd73185e68295696d1297887` |
| Upstream cohort | 307 source-cohort packages with registry integrity |
| Build source SHA | `1c103212ad25b7d2a0061c2c4bfa595cd413c138` |
| Peeled tag source | `1c103212ad25b7d2a0061c2c4bfa595cd413c138` (`refs/tags/v0.6.3`) |
| Release | [`v0.6.3`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.3), immutable |
| Release id | `391932791` |
| Published at | `2026-09-19T07:24:59Z` |
| Public readback | `PASS`; asset-set seal `d693ae2c534267799c562cadbac0f93f2e4caaeb1d6dffa2fd599a91ae1da4e7`; update signature and Mac/Windows installer signatures verified |
| Public source export | tree `1514e7559976c20f3b9a9d1c7f2fa6e3dd889b66830aa5bd562dafdfeacb798e` |
| Source CI run | [35420131237](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35420131237) on the build SHA |
| CodeQL run | [35420130845](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35420130845), `Analyze (javascript-typescript)` success |
| Native targets | [35420146587](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35420146587): darwin-aarch64, win32-x86_64, linux-loong64; exact aggregate PASS |
| Publish and immutable readback | [35429171949](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35429171949) |
| Website deploy and readback | [35430335780](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35430335780) PASS; site source `2dbadb7a76ba12ad0791b97378d87922ca3a570e`; Cloudflare Pages 34/34 files PASS; GitHub Pages 34/34 files PASS |
| Trust | community-verified; macOS ad-hoc and not notarized; Windows no Authenticode |
| Native UOS | package/ABI/runtime/closure PASS; real-machine acceptance `OWNER_POST_RELEASE` |
| Signed updater | Apple Silicon and Windows x64 |
| Installed upgrade | `0.6.2 → 0.6.3` is `OWNER_EXCLUDED`; not claimed PASS |
| Timed soak | two-hour installed soak is `OWNER_EXCLUDED` |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.3_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_macos_aarch64.dmg) | 271,997,944 | `58b6df9704148403b229c06ee0f0a5d7a3ae328b8ac61a56d8d2d13e1c7a0129` |
| [`Penglai_0.6.3_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_windows_x64_setup.exe) | 358,353,527 | `6fe9d3b59c644cfca15a374c03959ae117dce24de2382014f177257bdeaa9edd` |
| [`Penglai_0.6.3_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/Penglai_0.6.3_uos_loong64.deb) | 280,873,186 | `2dfc77f88cc436bdcf6abf3ce22c6098c6ee5f9dbbf2b097f7c8ce457faaf4dd` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/update-manifest-v1.json) | 1,621 | `cc8e82b4bc5214d902f53440c35dee7e4fcf1c2b81914d33a653596e70af6083` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/update-manifest-v1.json.sig) | 64 | `9c37d92e9c0aa38edabd8ada94b602c509a5ad2c3aa2b5e59bd9873c661c139e` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/release-manifest.json) | 756 | `5580c8e03a2bb944fe962996abb55ecd9381111e2a8be6559b996411dfca9809` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/SBOM.cdx.json) | 1,070,861 | `8adb2c6d92d88567413864faff3fbe331b925da3208b48e4960efeb9d4f75558` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/THIRD_PARTY_NOTICES.txt) | 146,795 | `72f61bb1d9ce516486895789c8cf0d5b61ef206129f26820460df4c4dd8714b6` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/SHA256SUMS) | 832 | `bdb9b6d80270cff532ee59fd99e7d6f4c8e81d19b45d60e96a619468f4d7cbcc` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.3/public-export-manifest.json) | 331,985 | `acdfe17c364c11ad58e148eabfcd3b2f67a78969ddf441e1a1fae884ce9fbfab` |

## Scoped completed validation

- Stable Release is `draft=false`, `prerelease=false`, and `immutable=true`;
  tag, release manifest, native evidence and Source CI all bind the build SHA.
- The 307-package DSH cohort and packaged runtime closure passed integrity,
  dependency, secret, advisory, supply-chain and public-export gates.
- Apple Silicon passed exact DMG validation, full installed onboarding,
  welcome/process smoke, first-party plugin compatibility, fresh install,
  restart, and default uninstall.
- Windows x64 passed exact NSIS validation, closure/artifact/fuses/signing,
  profile matrix, Simplified Chinese installer UI, full installed onboarding,
  first-party plugin compatibility, fresh install, restart, and default uninstall.
- UOS LoongArch passed exact `.deb` package identity, ABI, runtime,
  architecture and closure checks.

Explicitly not PASS:

- `0.6.2 → 0.6.3` installed upgrade: `OWNER_EXCLUDED`.
- Two-hour installed soak: `OWNER_EXCLUDED`.
- Native UOS machine acceptance: `OWNER_POST_RELEASE`.
- Optional private-account IM/iMessage live delivery: outside publication acceptance.
- macOS notarization and Windows Authenticode: not present.

## 中文

0.6.3 的十个附件已经由正式发布后的公网回读重新下载核对，文件大小、SHA-256、
更新签名和 Mac/Windows 安装器签名全部通过。三个安装包来自同一源码
`1c103212ad25b7d2a0061c2c4bfa595cd413c138`。

Apple 芯片与 Windows x64 已完成全新安装、重启、完整安装态引导、第一方插件兼容和
默认卸载。UOS `.deb` 的包身份、ABI、运行时、架构与闭包验证通过；真机体验仍为
`OWNER_POST_RELEASE`。`0.6.2 → 0.6.3` 真实安装版升级和两小时 soak 都是
`OWNER_EXCLUDED`，本发布不宣称这两项 PASS。
