# UOS 20 old-world required natives (0.6.0)

Architecture builds, not official npm loong64 optionals. Native
install/startup/function remain `OWNER_POST_RELEASE`. Independent review of
libvips-cpp `2e9438ad…`:
`native/linux-loong64-oldworld/review/ABI-PROVENANCE-REVIEW-2e9438ad.md`.

| Artifact | SHA-256 | Overlay |
| --- | --- | --- |
| koffi 3.1.6 | `4e19ac67…` | `@koromix/koffi-linux-loong64` (replaces new-world npm) |
| sharp.node 0.35.4 | `7967795e…` | `sharp/src/build/Release/sharp-linux-loong64-0.35.4.node` |
| libvips-cpp 8.18.6 | `2e9438ad…` | same directory; DT_SONAME `libvips-cpp.so.42.20.6`; `$ORIGIN` |
| flock | `b065bcb1…` | `node-addon-system-linux-loong64/bin/glibc/system.node` |
| pty.node | `5b5b7386…` | `node-pty/prebuilds/linux-loong64/pty.node` |
| Mnemon 0.2.8 | `a8bc5fc4…` | `resources/mnemon/mnemon` (static ELF; architecture build) |

`node-addon-require-builtin` native is unpublished. Product web
`patchReload: startup`. JPEG implementation is **libjpeg-turbo 3.0.4**, not
mozjpeg. Highway SIMD off. JPEG-XL / PDF / Magick official-off.

Mnemon 0.2.8 has no official linux-loong64 GitHub archive. Penglai builds
the same tagged source for old-world LoongArch
(`docs/0.6.0/MNEMON_LOONG64.md`). Memory stays required default-on.
MOSS ONNX native is not available on this target
(`docs/0.6.0/MOSS_LOONG64.md`); the card is not enableable. ASR uses
WASM sherpa.

Rebuild inputs: `native/linux-loong64-oldworld/SOURCES.json` and
`buildscripts/`. Packaging uses `artifacts/` by digest so CI does not rebuild
librsvg.
