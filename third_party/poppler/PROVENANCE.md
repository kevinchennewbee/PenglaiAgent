# Poppler pdftoppm provenance

Penglai Office page preview ships a target-specific `pdftoppm` helper and its
dynamic-library closure. The helper is a separate executable (mere aggregation),
not linked into Electron or DSH.

- Upstream: https://poppler.freedesktop.org/
- Version: 26.09.0
- License: GPL-2.0-only OR GPL-3.0-only (`COPYING` + `COPYING3` next to the binary)
- Source tarball SHA-256: `8059eadb6805340768f138c465b57f8164c92b4a0773c37ef031ea6c0d987b2e`
- poppler-data 0.4.12 SHA-256: `c835b640a40ce357e1b83666aabd95edffa24ddddd49b8daff63adb851cdab74`
- conda-forge feedstock commit: `13d784d77510e73d6066a75a79cd8e6040a6a261`
- Pins: conda-forge osx-arm64, osx-64, and win-64 `poppler-26.09.0` (see `packages/release-identity/src/poppler-assets.js`)
- Homebrew bottles and the poppler-windows zip are not pins

Packaged runtime looks next to `Penglai` / `Penglai.exe` at `poppler/pdftoppm[.exe]`.
It never uses system PATH. Fetch writes per-target `manifest.json` after extract.
A host `pdftoppm` next to this tree is not three-target native evidence.
