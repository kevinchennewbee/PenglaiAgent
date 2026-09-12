# Penglai 0.6.2 upstream decisions

Checked on 2026-09-12. These pins are immutable inputs for this release; later
upstream versions need a separate review.

| Dependency | Verified input | Decision |
| --- | --- | --- |
| DeepSeek Harness | npm `0.1.5-rc.2`; tag `dsh-v0.1.5-rc.2`; commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`; tree `bd7dd6d90010a35d3d6ff9f12c1f6207d5b6fe38`; 279-package installed graph | Adopt the complete registry cohort with exact integrity. Do not mix rc.1, alpha, source-path, Git, or locally repacked packages into the active graph. |
| rc.1 to rc.2 delta | Upstream feedback and deliverables presentation changes; no new Penglai core | Adopt official bytes. Keep feedback local-only and bind the official feedback client to the locale service. |
| DSH IM references | Penglai's reviewed first-party rewrite remains the product runtime | Keep `@penglai/im`. Do not install another IM host, WhatsApp, a second Office, or a second management API. |
| Node and Electron | Node `22.23.2`, Electron `43.6.0` on Mac/Windows | Keep current pins. |
| UOS runtime | Loongson Node `22.16.0`, Loongson Electron `31.7.7` / Chromium 126 | Keep the old-world LoongArch runtime needed for UOS 20. Electron 31 is no longer maintained, so this is not security parity with Mac/Windows. |
| Mnemon | `0.2.8`, including architecture-built LoongArch engine | Keep Memory required and enabled by default. |
| `adm-zip` | npm `0.6.1`; integrity `sha512-Xwrja8nx9e5o2N1my4DsKCeKpdrnACyr1wtbPxBDgGzKzKyE9kRtBFA8mWldI+RVlD7CBZNWY/wQ2+ydwOR6kQ==` | Override the ONNX toolchain's indirect dependency to the first release containing destination-symlink protection; keep install scripts disabled and verify the exploit shape directly. |

At the time of review, npm tags were `latest=0.1.5-rc.1`,
`next=0.1.5-rc.2`, and `alpha=0.1.5-alpha.2`. The release pins rc.2 by exact
version and integrity rather than following a mutable tag.
