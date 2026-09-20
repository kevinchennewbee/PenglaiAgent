# PUBLICATION_MANIFEST 0.6.5

Status: `PUBLIC_READBACK_PASS`

The public readback downloaded all ten immutable assets after publication and
verified their exact sizes, SHA-256 digests, update signature, and installer
signatures. This document records those observed public bytes. Committed source
templates remain `phase=UNFROZEN` and `sourceSha=NONE`; they are not substituted
for generated release identity.

| Field | Value |
| --- | --- |
| Product | `0.6.5` |
| DSH | official unmodified npm `0.1.6-alpha.2`; tag `dsh-v0.1.6-alpha.2`; commit `ddefc45fbc7f8e46dd73185e68295696d1297887` |
| Upstream cohort | 307 packages: 293 DSH, nine vendor, five native |
| Build source SHA | `eb90f494d6ccd8f3fe7f29ffc5007b8ada94be4a` |
| Peeled tag source | `eb90f494d6ccd8f3fe7f29ffc5007b8ada94be4a` (`refs/tags/v0.6.5`) |
| Release | [`v0.6.5`](https://github.com/kevinchennewbee/PenglaiAgent/releases/tag/v0.6.5), immutable |
| Release id | `392337556` |
| Published at | `2026-09-20T07:00:58Z` |
| Public readback | `PASS`; asset-set seal `10a69d3bf24a73be3ccd0ea2bdf01db3e8c8ac907afa7d79898039409940d7a8`; update signature and all installer signatures verified |
| Public source export | tree `5b094f709fac9d0d8fb3ebd7a9cb84b8169fed4464c09e4854a074120b678eca` |
| Source CI run | [35490512465](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490512465) on the build SHA |
| CodeQL run | [35490512032](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490512032) on the build SHA; zero open alerts at release |
| Native targets | [35490538515](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35490538515): darwin-aarch64, win32-x86_64, linux-loong64; exact aggregate PASS; Intel Mac excluded |
| Publish and readback | [35495632957](https://github.com/kevinchennewbee/PenglaiAgent/actions/runs/35495632957) |
| Website deploy and readback | see `docs/PUBLICATION_0.6.5.md` |
| Trust | community-verified; macOS ad-hoc, not notarized; Windows no Authenticode; UOS Electron 31.7.7 / Chromium 126 and Node 22.16.0 unmaintained, without Mac/Windows security parity |
| Native UOS | `OWNER_POST_RELEASE` |
| Signed updater | Apple Silicon and Windows x64 |

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| [`Penglai_0.6.5_macos_aarch64.dmg`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/Penglai_0.6.5_macos_aarch64.dmg) | 272,131,815 | `3364bb22a2c23e38f67b42f383c79371621446b090fbd32409c65cd615d99ff6` |
| [`Penglai_0.6.5_windows_x64_setup.exe`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/Penglai_0.6.5_windows_x64_setup.exe) | 358,252,414 | `cfc3abbd88ee71e45b07d0214c8d3e93664fab79f5399eff81b25a09a7a44cce` |
| [`Penglai_0.6.5_uos_loong64.deb`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/Penglai_0.6.5_uos_loong64.deb) | 280,871,496 | `a619e6361ba511c625aa125738727ab010f53ecba8af311dab94daecddcbfbe3` |
| [`update-manifest-v1.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/update-manifest-v1.json) | 1,659 | `043ed51c1304dcc30ea71b34141d8de980e84ff6574fdb8dfd33450be0e458ec` |
| [`update-manifest-v1.json.sig`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/update-manifest-v1.json.sig) | 64 | `0f11820c9b75190c1908242b22bc7c75d45594cf7495698b89438258f44d677e` |
| [`release-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/release-manifest.json) | 756 | `774a22daf02dde7d9cd943603b2e63990eda65cc91efaf9b52c6d4b272712859` |
| [`SBOM.cdx.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/SBOM.cdx.json) | 1,070,861 | `b2d45aacef1afd9ebb8f9c0fbb96a77c8209bbbf57f0585fe49092f3b88647e0` |
| [`THIRD_PARTY_NOTICES.txt`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/THIRD_PARTY_NOTICES.txt) | 146,795 | `94736751cc6bd9da23c6411a2abf881a610888012e8626b8fe2f9354a07d103e` |
| [`SHA256SUMS`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/SHA256SUMS) | 832 | `ca0806d2dc6de5d685304722981eda515c78703ddd8180868815cf63833af4b3` |
| [`public-export-manifest.json`](https://github.com/kevinchennewbee/PenglaiAgent/releases/download/v0.6.5/public-export-manifest.json) | 334,678 | `61fe119ae932f31263516c75c65aabaf94d99250b364475adedb92fb9931abc1` |

## Scoped completed validation

| Gate | Result |
| --- | --- |
| `verify:release` on the build SHA | `PASS`; 22 gates, no missing gate, no failed gate |
| `verify:evidence` (hard gate) | `PASS`; 80 hard ids, 80 pass, 0 notRun, 0 duplicate, 0 stale |
| `verify:drift` | `PASS`; five probes, none blocked |
| `prepare:public-export` clean room | `PASS`; 1474 files, lock-only install and typecheck passed |
| Draft byte readback | `PASS`; ten assets, updater signature and installer signatures verified |
| Immutable public readback | `PASS`; same ten assets, same asset-set seal, `immutable=true` |

## Not claimed

- `0.6.3 → 0.6.5` installed-upgrade journey: `OWNER_EXCLUDED`.
- Two-hour installed soak: `OWNER_EXCLUDED`.
- UOS native install, startup, UI, file picker, sleep/resume, and functional
  acceptance: `OWNER_POST_RELEASE`.
- macOS notarization and Windows Authenticode: `NOT_RUN` for this release.
- Optional private-account IM/iMessage live delivery: outside publication
  acceptance.
