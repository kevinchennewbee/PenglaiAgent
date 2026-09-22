# Penglai 0.6.5 publication copy

Status: `PUBLIC_READBACK_PASS`. Penglai 0.6.5 was published on 2026-09-20 from
source `eb90f494d6ccd8f3fe7f29ffc5007b8ada94be4a`; the exact public sizes and
SHA-256 values are recorded in
[`docs/PUBLICATION_MANIFEST_0.6.5.md`](../PUBLICATION_MANIFEST_0.6.5.md).

Penglai 0.6.5 keeps the official DeepSeek Harness cohort that 0.6.3 shipped —
`0.1.6-alpha.2` — and repairs what had frozen around it: the WeChat channel, the
assisted update check, and the layer that verifies both. The core stays simple:
DSH owns the conversation; Penglai makes it installable and brings Memory,
messaging, local voice, and careful lifecycle controls around it.

The published release has three installers: Apple Silicon, Windows x64, and
UnionTech UOS 20 LoongArch. The UOS `.deb` is one complete package with its
runtime, DSH, every in-scope first-party plugin, Memory, and Mnemon.
LibreOffice, Office/PDF, Budget, and Companion are not included. UOS native use
still waits for the Owner's post-release machine test; package and ABI checks
are not presented as that result.

The source SHA, asset sizes, SHA-256 values, and public URLs come from the
immutable readback recorded in the publication manifest, never from a previous
release or a local build.
