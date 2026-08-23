# PenglaiAgent 0.5.5 publication contract

0.5.5 pins official DSH `0.1.1-rc.2` and three native targets. Owner authorized publication on 2026-08-23 after the source, installed, native, privacy, and readback gates pass. Identity, source tests, and profile/plugin contracts name these exact installers:

- `Penglai_0.5.5_macos_aarch64.dmg`
- `Penglai_0.5.5_macos_x64.dmg`
- `Penglai_0.5.5_windows_x64_setup.exe`

The source branch must enter `main` through review and required checks. Build all three installers from the same merged source SHA on matching native runners, collect those exact bytes without rebuilding, generate and sign the remaining seven metadata assets, publish an immutable bilingual `v0.5.5` Release, then perform remote byte-for-byte readback. A failed required gate stops publication.
