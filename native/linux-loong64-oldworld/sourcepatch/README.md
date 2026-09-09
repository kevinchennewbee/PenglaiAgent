# Work-tree patches (not applied to `/private/tmp/penglai-0.6.0`)

- libvips skip host tools + static `libvips` into `libvips-cpp` (sharp-libvips pattern).
- meson `HAVE__ALIGNED_MALLOC` false positive → posix_memalign.
- libarchive config.h: undef `HAVE_ARC4RANDOM_BUF`, `HAVE__FSEEKI64`, `HAVE_ISSETUGID`, `HAVE_CLOSEFROM` (compile-only has_function vs glibc 2.28).
- libheif 1.23.2: `.contains(` → `.count(` for gcc 8.3 libstdc++ (C++20 `map::contains` missing). Semantics preserved.
- `oldworld-cc.py`: when argv contains `-E`, drop `-c` so Meson gperf preprocess (`fcobjshash.gperf.h`) is not compiled as C.
- `sanitize-meson-config.py`: meson compile-only `has_function` vs glibc 2.28 — undef `HAVE_GETPROGNAME`/`HAVE_GETEXECNAME` (fontconfig), `HAVE_FREE_SIZED`/`HAVE_FREE_ALIGNED_SIZED`/`G_HAVE_FREE_SIZED` (glib 2.89).
- Official posix `glib-without-gregex.patch` on glib 2.89.4 (pango 1.58 needs glib >= 2.88; 2.82.5 remains in the already-packaged libvips-cpp 471de39f).
- Highway not built: optional SIMD; posix already skips it on riscv/s390x/armv6. Scalar libvips is the same API.
- Official rustc `loongarch64-unknown-linux-gnu` **prebuilt libstd.so** is GLIBC_2.36 + `ld-linux-loongarch-lp64d.so.1` (do not ship). `-Zbuild-std` + `oldworld-cc` probe `libowprobe.so` is e_machine 258, e_flags 0x0, GLIBC 2.27/2.28, `oldworld_arch_ok`.
- librsvg 2.62.91: no version downgrade; isolated `-Zbuild-std` + oldworld-cc; `librsvg-2.a` e_machine 258 e_flags 0x0.
- `glibc-stat64-atexit-shims.c`: PIC wrappers `stat64`→`__xstat64(0,…)`, `atexit`→`__cxa_atexit(fn,0,0)`. Loongson `bits/stat.h` sets `_STAT_VER`/`_STAT_VER_LINUX` to **0** (kernel shape), not i386 `3`. `libc_nonshared.a` is old-world SOP that Zig lld rejects.
