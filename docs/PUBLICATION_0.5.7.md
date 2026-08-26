# PenglaiAgent 0.5.7 publication contract

Status: `CANDIDATE`.

Owner authorized 0.5.7 development, real testing, a Draft PR to `main`, Codex
review, merge, three-target native rebuilds, tag, GitHub Release, README,
website, and bilingual public copy **only after required gates pass**.
Authorization does not permit publication with a failed required gate or
disclosure of credentials, private keys, local paths, QR data, chat bodies,
account identities, profiles, logs, or private media.

Grok Build stops at a Draft PR. It does not merge, create `v0.5.7`, publish a
Release, or deploy production `gh-pages`.

The exact native installers are:

- `Penglai_0.5.7_macos_aarch64.dmg`
- `Penglai_0.5.7_macos_x64.dmg`
- `Penglai_0.5.7_windows_x64_setup.exe`

All three must come from one reviewed, clean source SHA on matching native
runners. The Release contains those three bytes plus the seven metadata assets
declared by `release-contract.json`, and no others.

Official DSH remains `0.1.1-rc.2`. DSH-IM v3.0.1 is a selective rewrite pin,
not an installed second runtime. Nine messaging platforms have connection
entries; live support claims follow `docs/0.5.7/LIVE_IM_MATRIX.md`.
