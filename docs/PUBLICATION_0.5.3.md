# PenglaiAgent 0.5.3 publication contract

0.5.3 is a three-target update-closeout hotfix on official DSH `0.1.1-rc.1`. Publication is authorized only after one clean merged `main` SHA produces native-verified Apple Silicon, Intel Mac, and Windows x64 installers and the exact release set is signed, published immutable, and read back from GitHub.

The required installers are:

- `Penglai_0.5.3_macos_aarch64.dmg`
- `Penglai_0.5.3_macos_x64.dmg`
- `Penglai_0.5.3_windows_x64_setup.exe`

Hard evidence includes the complete source suites, clean public export, native installer architecture and identity, installed welcome/process smoke, the four-phase seven-plugin compatibility gate, detached installer signatures, signed update manifest, exact asset hashes, and immutable remote read-back. A cross-build cannot replace an Intel or Windows native runner.

The update-specific gates are:

1. post-verification commits when IM and all other optional Penglai plugins remain disabled but the required DSH credentials and Penglai Center inventory is healthy;
2. any failed runtime-integrity, profile, required-plugin, or DSH-health fact still fails closed;
3. installing 0.5.3 over a profile left in 0.5.2 `RECOVERY_REQUIRED / POST_VERIFY_FAILED` reconciles the superseded journal without fabricating a signed 0.5.3 ledger;
4. after publication, an untouched public 0.5.1 client discovers the highest stable 0.5.3 Release, downloads and verifies the matching asset, requires explicit confirmation, preserves data and Workspace, launches 0.5.3, and writes a `COMMITTED` ledger.

Post-publication outcome for item 4: **transport, verification, handoff, preserved launch and `COMMITTED / 0.5.3` passed; the fresh-profile UI claim did not**. The public 0.5.1 updater downloaded the exact signed Apple Silicon asset and opened the verified DMG. After the system-level copy, 0.5.3 launched the official DSH UI with the preserved Workspace and committed the journal. The already-published 0.5.1 completion gate nevertheless expects `$DSH_HOME/workspace.json` while DSH rc.1 writes `storages/workspace.json`, so a fresh profile remains at wizard step 7 and cannot reach the visible Settings update page. The 0.5.3 Release remains valid for fresh installs and manual same-platform overlays, and completed 0.5.1 profiles retain their signed updater path; documentation must not claim that the old binary gained a recovery button.

The temporary provider key used for Apple Silicon onboarding acceptance must never enter source, screenshots, evidence, CI, GitHub, or the final local profile. macOS remains ad-hoc and not notarized. Windows remains without Authenticode. README and website claims must name these limits and must not promote source-only evidence into installed or native proof.
