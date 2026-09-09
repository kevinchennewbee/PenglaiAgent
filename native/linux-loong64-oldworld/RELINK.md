# libvips-cpp relink (after independent review)

Independent review of `cc36023c…` found strong UND `aom_codec_*` / `SharpYuv*`
(meson omitted Requires.private) and rust `stat64`/`atexit` (Loongson libc
exports `__xstat64` / `__cxa_atexit`; `libc_nonshared.a` has old-world SOP
relocs Zig lld rejects: "unsupported object file ABI version").

Relinked with `libaom.a`, `libsharpyuv.a`, `libxml2.a`, `libpcre2-8.a`, and
PIC shims `sourcepatch/glibc-stat64-atexit-shims.c`.

Result then: `782e707c7168cd0b2995a6f757210156f2559938c86f8c0e00a38d0ee25c41ce`
(22160528 bytes). Independent review of those bytes found `_STAT_VER=3`
(Loongson is 0) and host rustup paths. That receipt does **not** cover later
hashes.

## `2e9438ad…` (SONAME + `-z defs` + STAT_VER=0)

Zig 0.16 `build-lib` rejects `-Wl,--no-undefined`; `-fno-allow-shlib-undefined`
still emits strong UND. The wrapper now passes **`-z defs`** and links
`ld.so.1` so TLS `__tls_get_addr` is defined at link. Emit-bin is the
intended SONAME filename. Shim `_STAT_VER_LOONGSON_GLIBC228 = 0`. Host-path
equal-length rewrite remains a stop-gap; librsvg RUSTFLAGS remaps
RUSTUP_HOME and WORK.

Current packaged DSO:
`2e9438ad2c854acc6c9d50ea9d84d0b9083b1d06b2ec425c1993e11dd10cedd6`
(22106680). DT_SONAME `libvips-cpp.so.42.20.6`. Independent review:
`deliverables/review/ABI-PROVENANCE-REVIEW-2e9438ad.md`. Native UNRUN.
