# PenglaiAgent 0.5.2 publication contract

0.5.2 is a three-target hotfix release of official DSH `0.1.1-rc.1`. Publication is authorized only after the merged clean `main` SHA produces native-verified Apple Silicon, Intel Mac, and Windows x64 installers and the exact release set is signed, published immutable, and read back from GitHub.

The required installers are:

- `Penglai_0.5.2_macos_aarch64.dmg`
- `Penglai_0.5.2_macos_x64.dmg`
- `Penglai_0.5.2_windows_x64_setup.exe`

Hard release evidence includes the source suites, clean public export, native installer architecture and identity, installed welcome/process smoke, first-party plugin compatibility, detached installer signatures, signed update manifest, exact asset hashes, and immutable remote read-back. A cross-build cannot replace an Intel or Windows native runner.

Before the Release is marked current, an installed public 0.5.1 client must discover 0.5.2 through PUDP/1, verify and download the matching asset, require user/system confirmation, complete the overlay install, preserve the `Penglai/0.5` data generation and external Workspace, and launch as 0.5.2. The temporary provider key used for the Apple Silicon live onboarding gate must never enter source, evidence, CI, or GitHub.

macOS remains ad-hoc and not notarized. Windows remains without Authenticode. The public README and website may claim PASS only for native jobs and installed paths that actually completed.
