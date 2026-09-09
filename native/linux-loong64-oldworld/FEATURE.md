# sharp-libvips 1.3.3 vs this old-world libvips-cpp

Reference: `work/sharp-libvips/build/posix.sh` meson flags + `versions.properties`.
Official **disables** jpeg-xl, magick, pdfium, poppler, openjpeg, cfitsio, fftw, orc,
openslide, matio, nifti, raw, spng, quantizr. PDF preview is out of product scope
and is **not** an official sharp-libvips default.

DSH `@deepseek-ai/dsh-attachment-local` admits only png/jpeg/webp/gif (`CONSUMERS.md`).
That list is not the product contract for the sharp native.

Meson summary excerpt: `vips-meson-summary.txt`.

| Feature | Official 1.3.3 linux | This old-world build | Notes |
| --- | --- | --- | --- |
| JPEG | mozjpeg | libjpeg-turbo 3.0.4 (libjpeg API) | encoder implementation, same API |
| PNG 1.6.58 | yes | yes | |
| WebP 1.6.0 | yes | yes | |
| GIF load nsgif | yes | yes | |
| GIF save cgif 0.5.3 | yes | yes | |
| TIFF 4.7.2 | yes | yes | |
| EXIF 0.6.26 | yes | yes | |
| LCMS2 2.19.1 | yes | yes | |
| archive 3.8.9 dzsave | yes | yes | |
| imagequant 2.4.1 | yes | yes | |
| HEIF/AVIF libheif+aom (libde265 OFF) | AVIF yes, HEIC no | same | |
| SVG librsvg 2.62.91 | yes | **yes** (`vips_svgload`, `rsvg_handle_new`) | no version downgrade |
| pangocairo/fontconfig text | yes | **yes** (`vips_text`, pango_layout_*) | glib 2.89.4 official |
| highway | yes on x64; OFF riscv/s390x/armv6 | OFF | optional SIMD; `HIGHWAY.md` |
| uhdr 2.0.2 | yes | **yes** (`vips_uhdrload`) | |
| jpeg-xl / magick / PDF | OFF | OFF | official-off |

libvips-cpp ELF: e_machine 258, e_flags 0x0, GLIBC ≤ 2.28, sha256 `2e9438ad…`
(DT_SONAME `libvips-cpp.so.42.20.6`, linker `-z defs`, shim `_STAT_VER=0`;
see `RELINK.md` and `review/ABI-PROVENANCE-REVIEW-2e9438ad.md`). Prior
`782e707c…` / `f6ce0989…` / `471de39f…` kept as sidecars. Native UNRUN.

libheif: gcc 8.3 libstdc++ has no C++20 `map::contains`; work-tree replace
`.contains(` → `.count(` (semantics preserved). Official posix also sets
`WITH_LIBDE265=0` so HEIC/HEVC is not an official default.

Rust: official `loongarch64-unknown-linux-gnu` libstd.so is GLIBC_2.36.
Isolated `-Zbuild-std` + oldworld-cc probe `libowprobe.so` is old-world
(`ee1e140c…`). librsvg 2.62.91 linked that way. Native UNRUN.
