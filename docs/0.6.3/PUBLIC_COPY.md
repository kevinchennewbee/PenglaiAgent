# Penglai 0.6.3 publication copy

Status: publication draft only. Penglai 0.6.3 is not released; no native or
public-byte facts in this draft may be presented as observed.

Penglai 0.6.3 updates the complete official DeepSeek Harness cohort to
`0.1.6-alpha.2` and restores real installed upgrades from 0.6.2 on Apple Silicon
and Windows x64. The core stays simple: DSH owns the conversation; Penglai
makes it installable and brings Memory, messaging, local voice, and
careful lifecycle controls around it.

The planned release has three installers: Apple Silicon, Windows x64, and UnionTech
UOS 20 LoongArch. The UOS `.deb` is one complete package with its runtime,
DSH, every in-scope first-party plugin, Memory, and Mnemon. LibreOffice,
Office/PDF, Budget, and Companion are not included. UOS native use still
waits for the Owner's post-release machine test; package and ABI checks are not
presented as that result.

The exact source SHA, asset sizes, SHA-256 values, and public URLs will come from
immutable readback after publication, never from a previous release or local
build. They are intentionally absent in this development phase.
