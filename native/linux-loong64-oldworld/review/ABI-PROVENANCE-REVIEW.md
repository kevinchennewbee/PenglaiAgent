# ABI / provenance review — Penglai 0.6.0 UOS20 old-world native addon inputs

Independent Grok 4.6 inspection of **buildscripts vs produced bytes**. MANIFEST/README/PROGRESS were not treated as proof. Native execution remains **UNRUN**; ELF architecture checks are not a functional PASS.

Inspector used: `/private/tmp/penglai-uos20-addons-060/scripts/elf_inspect.py --json` plus `nm -D`/`nm -D -S`, DT_VERNEED parse, sysroot `libc.so.6` / `libpthread.so.0` symbol tables, meson `config.h` / `build.ninja`, and SHA-256 of the files named below.

## Summary

Shipped LoongArch ELF **headers** match the UOS20 old-world ABI gate: `e_machine=258`, `e_flags=0` (no `EF_LARCH_OBJABI_V1`), no `ld-linux-loongarch-lp64d.so.1` as PT_INTERP or DT_NEEDED, and DT_VERNEED GLIBC nodes are `<= 2.28`. `deliverables/SHA256SUMS` matches the bytes. koffi is still `4e19ac67…`. `sharp.node` still DT_NEEDED `libvips-cpp.so.42.20.6`. New `libvips-cpp` **does** contain defined `rsvg_handle_new` / `vips_svgload`, `pango_layout_new` / `vips_text`, `uhdr_*` / `vips_uhdrload`. librsvg was **2.62.91** (tarball, meson, `.pc`, `rsvg-version.h`). Highway is meson-disabled optional SIMD, not a codec drop. JPEG-XL / Magick / PDF are meson-NO with ~800-byte empty `.o` stubs. require-builtin is optional peer + try/catch + public `import(name)`; machine status `optionalinternalsunavailable`; no invented native decoder. Official rust `libstd-*.so` is GLIBC_2.36 + new-world loader DT_NEEDED and is **not** in `deliverables/`.

The rebuilt `libvips-cpp.so.42.20.6` is **not loadable as packaged**. It is `DF_BIND_NOW` / `DF_1_NOW` and still has **strong** undefined `aom_codec_*` and `SharpYuv*` (prefix `.a` files exist; meson never passed them) plus rust `stat64`/`fstat64`/`lstat64`/`fstatat64`/`atexit` that **old-world `libc.so.6` does not export**. `oldworld-cc.py` drops meson’s `-Wl,--no-undefined`, so the link did not fail closed. MANIFEST still lists `heif-avif-aom` as enabled. Native execution UNRUN; this is ELF load-time evidence, not a runtime log.

## Bytes vs SHA256SUMS

All seven `SHA256SUMS` entries verify. Actual hashes:

| Path | SHA-256 | size |
| --- | --- | --- |
| `koffi-3.1.6/package/linux_loong64/koffi.node` | `4e19ac67411eb7ff1afde00150f90f22f802e649f90ac86572ae36814edd8a90` | 965528 |
| `sharp-0.35.4/install-layout/src/build/Release/sharp-linux-loong64-0.35.4.node` | `7967795e0f7d5274cb7d8480e2fb73b85ce3d0bfc0981e4eab8272463b27a2c2` | 376424 |
| `sharp-0.35.4/lib/libvips-cpp.so.42.20.6` | `cc36023c7ac0f61040f55a76b36883137af09f339a89b962e10e89504f0356ff` | 18907952 |
| `sharp-0.35.4/lib/libvips-cpp.so.42.20.6.471de39f` | `471de39f5a56dad5870f1ff5010eabbd4f88da94778e1b2f7ad7e990cdebf9fc` | 11836688 |
| `reused-flock-pty/glibc/system.node` | `b065bcb1945dffa04a075578dff55a50604c3901716912714b81c24757167868` | 7640 |
| `reused-flock-pty/node-pty/pty.node` | `5b5b7386569040bdc5af2c3f5213757e032636b0b80b50a3675eb2e347f73cb0` | 47992 |
| `sharp-0.35.4/provenance/libowprobe.so` | `ee1e140c629fc06f1a331808bb9a67c0ae4c44e5f40e1222be713d440a1bc499` | 234472 |

Work-tree `work/vips-prefix/lib/libvips-cpp.so.42.20.6` and install-layout `libvips-cpp.so.42.20.6` are the same `cc36023c…` bytes as the packaged new DSO.

## ELF ABI gate (headers / versions)

`elf_inspect.py --json` reports `oldworld_arch_ok=true`, `e_machine=258`, `e_flags=0x0`, `pt_interp=null`, `contains_newworld_loader_string=false`, empty `glibc_newer_than_2.28` for every **shipped** ELF listed above.

DT_VERNEED (parsed from PT_DYNAMIC, not the whole-file string scan):

- koffi: `libc.so.6` GLIBC_2.27; `libpthread.so.0` GLIBC_2.0, GLIBC_2.2. Loongson `libpthread-2.28.so` **does** export those historical pthread version nodes. Not a mismatch.
- sharp.node: `libc.so.6` GLIBC_2.27 only; DT_NEEDED includes `libvips-cpp.so.42.20.6`; DT_RUNPATH `$ORIGIN`.
- new libvips-cpp: `libc.so.6` GLIBC_2.27, GLIBC_2.28; pthread historical nodes through GLIBC_2.18 (present on sysroot pthread); no GLIBC_2.29+.
- libowprobe: `libc.so.6` GLIBC_2.27, GLIBC_2.28.

Sysroot `libc.so.6` itself: e_machine 258, PT_INTERP `/lib64/ld.so.1`, exported GLIBC_2.27 / 2.28 only.

Official **rejected** npm koffi (`provenance/official-npm-rejected/.../koffi.node`) and official rust `libstd-de3684f0c0aa0364.so` both DT_NEEDED `ld-linux-loongarch-lp64d.so.1` and VERNEED GLIBC_2.36. Neither is a shipping artifact.

## Codec / feature proof on new libvips-cpp (nm, not README)

Defined `T` in `cc36023c…`: `rsvg_handle_new`, `vips_svgload`, `vips_text`, `pango_layout_new`, `pango_cairo_create_layout`, `vips_uhdrload`/`vips_uhdrsave`, `uhdr_encode`/`uhdr_decode`, plus jpeg/png/webp/gif/tiff/heif wrappers.

`work/vips-deps/vips-text/_build/config.h`: `HAVE_RSVG`, `HAVE_PANGOCAIRO`, `HAVE_UHDR`, `HAVE_HEIF`, `HAVE_JPEG`, `HAVE_PNG`, `HAVE_LIBWEBP`, `HAVE_NSGIF`, `HAVE_CGIF`, `HAVE_EXIF`, `HAVE_LCMS2`. No `HAVE_LIBJXL` / `HAVE_HWY` / Magick / PDF.

Foreign object sizes: `svgload.c.o` 29816, `uhdrload.c.o` 27896, `jxlload.c.o`/`pdfiumload.c.o`/`popplerload.c.o` 816 (empty `#ifdef` stubs). `vips_jxlload` / `vips_pdfload` remaining `T` symbols are 0x58-byte `vips_call_split` wrappers in `foreign.c`, same as jpeg/svg public C entrypoints — **not** a silent JXL/PDF enable.

Work meson-setup: `librsvg-2.0 found: YES 2.62.91`, pangocairo YES, libuhdr YES 2.0.2, `Dependency libhwy skipped: feature highway disabled`. Official `posix.sh` already sets `WITHOUT_HIGHWAY` on riscv64/s390x/armv6; `-Djpeg-xl=disabled -Dmagick=disabled -Dpdfium=disabled -Dpoppler=disabled` match official-off.

`work/vips-prefix/lib/librsvg-2.a`: GNU ar, 3490 ELF64 objects, all `e_machine=258`, none with `EF_LARCH_OBJABI_V1`, no `ld-linux-loongarch-lp64d.so.1`, no versioned GLIBC strings (relocatable). `.pc` Version `2.62.91`.

## require-builtin

Evidence copies under `deliverables/node-addon-require-builtin-0.1.5/evidence/callchain/` match CALLCHAIN.md:

- `cordis-plugin-loader-package.json` peer `node-addon-require-builtin` with `peerDependenciesMeta.optional=true`.
- `cordis-plugin-loader-internal.ts` 108–118: `--expose-internals` then `try { require('node-addon-require-builtin').requireBuiltin(id) } catch {}`.
- `cordis-plugin-loader-tree.ts` 154–160: public `import(name)` when `loader.internal` is missing.
- `dsh-base-cordis.patch.yml` HMR `disabled: true`.
- JS package `createEntryApi` at load; loader `noUsableBindingError` text is `No usable native binding found for ${optionalPackageName(...)}`. No loong64 optional on npm; no native decoder in the JS package.

MANIFEST `machineStatus` is `optionalinternalsunavailable`. That is consistent with the call chain. Not a frozen-boot blocker from this evidence.

## Issues

### Issue 1 -- Severity: bug

- File: `/private/tmp/penglai-uos20-addons-060/deliverables/sharp-0.35.4/lib/libvips-cpp.so.42.20.6` (DT_FLAGS / `.dynsym`); `/private/tmp/penglai-uos20-addons-060/scripts/oldworld-cc.py:277`; `/private/tmp/penglai-uos20-addons-060/work/vips-deps/vips-text/_build/build.ninja` (`build cplusplus/libvips-cpp.so.42.20.6`); `/private/tmp/penglai-uos20-addons-060/work/vips-prefix/lib/pkgconfig/libheif.pc:10`
- Description: Packaged `libvips-cpp.so.42.20.6` (`cc36023c…`) has `DT_FLAGS=DF_BIND_NOW` (0x8) and `DT_FLAGS_1=DF_1_NOW` (0x1). `nm -D` still lists strong UND `aom_codec_av1_{cx,dx}`, `aom_codec_{decode,encode,…}`, `aom_img_{alloc,free}`, and `SharpYuv{Init,Convert,ComputeConversionMatrix,GetConversionMatrix}`. Prefix contains `libaom.a` and `libsharpyuv.a` with those `T` symbols; `libheif.pc` `Requires.private: aom libsharpyuv` and `libwebp.pc` `Requires.private: libsharpyuv`. Meson’s `cpp_LINKER` implicit inputs include `libheif.a` / `libwebp.a` / `librsvg-2.a` but **not** `libaom.a` / `libsharpyuv.a`. `heif_*` (294) and `WebP*` (118) are defined, so AVIF/WebP loaders are present and will call into missing aom/sharpyuv. Meson LINK_ARGS include `-Wl,--no-undefined`, but `oldworld-cc.py` `link_shared()` only forwards `-Wl,` rpath fragments and never passes `--no-undefined` to Zig, so the link succeeded. BIND_NOW means the dynamic linker must resolve every UND at `dlopen` of `sharp.node`’s DT_NEEDED. Node does not export `aom_*` / `SharpYuv*`. MANIFEST `enabledMatchingOfficial133` includes `heif-avif-aom`. The preserved `471de39f…` DSO has the same aom/SharpYuv UND and BIND_NOW; the SVG rebuild did not introduce this, and did not fix it.
- Suggestion: Link `libaom.a` and `libsharpyuv.a` into `libvips-cpp` (honor `Requires.private` / official posix “link every prefix `.a`” behavior). Make `oldworld-cc` honor `-Wl,--no-undefined` (or `zig build-lib` equivalent) so this class of hole fails the build. Re-run `nm -D` and require zero UND besides libc/libstdc++/libgcc/ld TLS.
- Status: open

### Issue 2 -- Severity: bug

- File: `/private/tmp/penglai-uos20-addons-060/deliverables/sharp-0.35.4/lib/libvips-cpp.so.42.20.6` (`.dynsym` UND `stat64`/`fstat64`/`lstat64`/`fstatat64`/`atexit`); `/private/tmp/penglai-uos20-addons-060/scripts/build-librsvg-oldworld.sh:86`; `/private/tmp/penglai-uos20-addons-060/work/linkroot/lib64/libc.so.6`
- Description: After statically linking librsvg 2.62.91 (`-Zbuild-std` + `oldworld-cc`), the new DSO imports unversioned `stat64`, `fstat64`, `lstat64`, `fstatat64`, and `atexit`. Loongson glibc 2.28 `libc.so.6` exports `__xstat64` / `__fxstat64` / `__lxstat64` / `__fxstatat64` / `__cxa_atexit` @ GLIBC_2.27, **not** those names. `atexit` / `stat` live in `libc_nonshared.a` (linked into executables, not into this DSO). Combined with Issue 1’s BIND_NOW, these UND must resolve at load. The new DSO also UND `fstatat64` (absent from `471de39f…`), consistent with rust std file I/O now in the SVG path. `libowprobe.so` has the same BIND_NOW plus UND `stat64`/`fstat64`; `elf_inspect.py` still reports `oldworld_arch_ok` because it never checks UND against the sysroot. Native UNRUN; ELF says rust-using DSOs are not closed against this libc.
- Suggestion: Provide glibc-compatible `stat`/`stat64`/`atexit` shims at `oldworld-cc` link (from `libc_nonshared.a` or wrappers to `__xstat64`/`__cxa_atexit`), or compile rust std against the Loongson headers so it emits `__xstat64@GLIBC_2.27`. Extend `elf_inspect.py` to fail on strong UND not satisfied by DT_NEEDED + sysroot + `ld.so.1` (`__tls_get_addr` is the legitimate loader symbol).
- Status: open

### Issue 3 -- Severity: suggestion

- File: `/private/tmp/penglai-uos20-addons-060/scripts/elf_inspect.py:32`; `/private/tmp/penglai-uos20-addons-060/scripts/elf_inspect.py:209`
- Description: `NEW_INTERP` is the full path `/lib64/ld-linux-loongarch-lp64d.so.1`. Official rejected koffi and official `libstd-*.so` DT_NEEDED the **soname** `ld-linux-loongarch-lp64d.so.1` without that prefix; `contains_newworld_loader_string` is false and the loader problem is reported only via GLIBC_2.36. Shipped addons do not have that DT_NEEDED (verified). The inspector would not flag a hypothetical GLIBC_2.28 binary that still DT_NEEDED the new-world loader soname.
- Suggestion: Treat `ld-linux-loongarch-lp64d.so.1` in DT_NEEDED or anywhere in the image as a problem, not only the `/lib64/` path.
- Status: open

### Issue 4 -- Severity: suggestion

- File: `/private/tmp/penglai-uos20-addons-060/deliverables/sharp-0.35.4/provenance/NOTE.md:9`
- Description: NOTE.md still lists packaged `libvips-cpp.so.42.20.6` as `471de39f…` (11.3 MiB). Bytes, SHA256SUMS, MANIFEST, FEATURE.md, and `libvips-cpp.so.elf.json` all say `cc36023c…` (18.9 MiB) with the prior hash kept only as the `.471de39f` sidecar.
- Suggestion: Point NOTE.md at `cc36023c…` and name the sidecar as preserved prior.
- Status: open

### Issue 5 -- Severity: suggestion

- File: `/private/tmp/penglai-uos20-addons-060/deliverables/sharp-0.35.4/provenance/vips-meson-summary.txt:40`
- Description: Packaged meson summary is truncated after `deprecated : false` (1800 bytes, 41 lines). Work-tree `meson-setup.txt` continues with `highway : disabled`, `jpeg-xl : disabled`, `rsvg : enabled`, etc. Feature YES/NO table at the top is present and matches `config.h`; the truncated user-options tail is incomplete provenance.
- Suggestion: Copy the full meson summary (through `Found ninja`).
- Status: open

### Issue 6 -- Severity: suggestion

- File: `/private/tmp/penglai-uos20-addons-060/scripts/build-librsvg-oldworld.sh:36`; `/private/tmp/penglai-uos20-addons-060/scripts/build-librsvg-oldworld.sh:91`
- Description: `RUSTFLAGS` remaps only `$CARGO_HOME/registry/=`. New `libvips-cpp` contains ~80 host paths under `/private/tmp/penglai-uos20-addons-060/cache/rustup/toolchains/nightly-aarch64-apple-darwin/lib/rustlib/src/rust/library/...`. Not an ABI break. Fontconfig compiled-in XML still has `<dir>/usr/share/fonts</dir>` (usable on UOS20); prefix `etc/fonts` includes are `ignore_missing`.
- Suggestion: Also `--remap-path-prefix=$RUSTUP_HOME=` (and the work prefix if debug info must not leak).
- Status: open

### Issue 7 -- Severity: nit

- File: `/private/tmp/penglai-uos20-addons-060/scripts/oldworld-cc.py:134`
- Description: `zig_base()` is unused and contains ` "build-obj" if True else "build-lib" `. Dead code; does not affect shipped bytes.
- Suggestion: Delete `zig_base()` or wire it to the real compile/link paths.
- Status: open

## Checks that held (no issue)

- koffi hash frozen at `4e19ac67…`; not rebuilt this pass.
- SHA256SUMS byte-identical to the seven listed files.
- sharp.node DT_NEEDED `libvips-cpp.so.42.20.6`.
- No shipped ELF contains `ld-linux-loongarch-lp64d.so.1`.
- `oldworld-cc.py:350-353`: `-E`/`-dM` strips `-c` (meson gperf).
- `sanitize-meson-config.py:12-34`: undefs glibc-2.28-absent / false-positive `HAVE_*`.
- librsvg **not** version-downgraded: 2.62.91 tarball + meson `version: '2.62.91'` + installed `.pc` / `rsvg-version.h`.
- Highway: optional SIMD; official posix already `WITHOUT_HIGHWAY` on riscv/s390x/armv6; `convi_hwy.cpp.o` is an 816-byte empty `#ifdef HAVE_HWY` object.
- Official rust prebuilt `libstd-de3684f0c0aa0364.so` is GLIBC_2.36 + new-world loader DT_NEEDED; not packaged. Probe cdylib `libowprobe.so` is e_machine 258 / e_flags 0 / GLIBC_2.27–2.28 (load UND still Issue 2).
- require-builtin: optional peer, empty catch, public import; no loong64 native invented.

Native execution remains UNRUN.
