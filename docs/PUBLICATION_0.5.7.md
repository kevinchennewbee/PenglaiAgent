# PenglaiAgent 0.5.7 publication contract

Status: `PUBLIC_READBACK_PASS`.

The immutable `v0.5.7` Release was published from source
`ce01d4dea59af72422071e357760a040f19b8e3d` after review, three-target native
rebuilds, and required gates. Public readback verified the exact GitHub bytes,
SHA-256 values, signed update manifest, and three installer signatures.

Grok Build stops at a Draft PR. It does not merge, create `v0.5.7`, publish a
Release, or deploy production `gh-pages`.

The exact native installers are:

- `Penglai_0.5.7_macos_aarch64.dmg`
- `Penglai_0.5.7_macos_x64.dmg`
- `Penglai_0.5.7_windows_x64_setup.exe`

All three must come from one reviewed, clean source SHA on matching native
runners. The Release contains those three bytes plus the seven metadata assets
declared by `release-contract.json`, and no others.

Official DSH remains `0.1.1-rc.2`. DSH-IM v3.0.5 is a selective rewrite pin,
not an installed second runtime. Eight platforms have connection entries under
`@penglai/im`; the WhatsApp community runtime is not bundled in 0.5.7.
