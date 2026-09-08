# Poppler pdftoppm provenance

Penglai Office page preview ships a target-specific `pdftoppm` helper and its
dynamic-library closure. The helper is a separate executable (mere aggregation),
not linked into Electron or DSH.

- Upstream: https://poppler.freedesktop.org/
- Version: 26.09.0
- License: GPL-2.0-only OR GPL-3.0-only (`COPYING` + `COPYING3` next to the binary)
- Source tarball: `8059eadb6805340768f138c465b57f8164c92b4a0773c37ef031ea6c0d987b2e`
- poppler-data 0.4.12: `c835b640a40ce357e1b83666aabd95edffa24ddddd49b8daff63adb851cdab74`
- conda-forge feedstock commit: `13d784d77510e73d6066a75a79cd8e6040a6a261`
- Targets: conda-forge osx-arm64, osx-64, and win-64 poppler 26.09.0
- Homebrew bottles and poppler-windows zip archives are not pins
- `.conda` pkg tarballs are decoded with Node's `zstdDecompressSync` (no Homebrew zstd)

macOS published layout flattens `pdftoppm` and load-time dylibs next to each other.
Bundled dylibs keep conda-forge `@rpath` install names. Penglai strips
`LC_CODE_SIGNATURE` in-process (Xcode 16.4 and 26.6 `codesign --remove-signature`
are not byte-identical), then rewrites Mach-O load commands in place: shrink
`@loader_path/../lib` rpath to `@loader_path`, and map libc++/libz/libcurl/libsqlite3
to `/usr/lib` using existing command padding or header slack before the first
section. It does not call `install_name_tool` or `codesign`, grow `__LINKEDIT`,
or lengthen a load-command string past that slack. It then patches the compiled-in
`POPPLER_DATADIR` slot to `share/poppler` slash-padded to the original 269-byte
memcpy length (no interior NUL). Spawn must use `cwd = dirname(pdftoppm)` and
`FONTCONFIG_PATH = <poppler>/fonts`.

Windows published layout is a PE-walked DLL closure next to `pdftoppm.exe`, with
poppler-data at `share/poppler` inside the helper dir (copy source). conda-forge
`windows-data.patch` extra-strips one directory, so the running helper looks for
`<payload>/share/poppler`. package-windows must copy that tree to the payload
sibling and must copy Electron's `VCRUNTIME140*.dll` / `MSVCP140.dll` next to
the helper. Darwin published Mach-Os are left unsigned so tree hashes are
reproducible; package-mac/notarization re-signs.

Packaged runtime looks next to `Penglai` / `Penglai.exe` at `poppler/pdftoppm[.exe]`.
It never uses system PATH. Published tree hashes are recorded after extract in each
target `manifest.json`.
