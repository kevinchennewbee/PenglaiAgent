# Penglai 0.6.2 publication copy

Status: published. The immutable GitHub Release and exact public bytes are
recorded in `docs/PUBLICATION_MANIFEST_0.6.2.md`.

Penglai 0.6.2 updates the complete official DeepSeek Harness cohort to
`0.1.5-rc.2` and restores real installed upgrades from 0.6.1 on Apple Silicon
and Windows x64. The core stays simple: DSH owns the conversation; Penglai
makes it installable and brings Office, Memory, messaging, local voice, and
careful lifecycle controls around it.

The release has three installers: Apple Silicon, Windows x64, and UnionTech
UOS 20 LoongArch. The UOS `.deb` is one complete package with its runtime,
DSH, every first-party plugin, Office, Memory, and Mnemon. UOS native use still
waits for the Owner's post-release machine test; package and ABI checks are not
presented as that result.

The exact source SHA, asset sizes, SHA-256 values, and public URLs come from
immutable readback after publication, never from a previous release or local
build. See `docs/PUBLICATION_MANIFEST_0.6.2.md`.
