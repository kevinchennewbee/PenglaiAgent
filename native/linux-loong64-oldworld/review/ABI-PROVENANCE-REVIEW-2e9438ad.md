# Independent review — libvips-cpp `2e9438ad…`

Inspector: product-repo Grok 4.6. Historic
`deliverables/review/ABI-PROVENANCE-REVIEW.md` covers **`cc36023c…` only**.
`ABI-PROVENANCE-REVIEW-782e707c.md` covers **`782e707c…` only** (STAT_VER=3
and host paths). `f6ce0989…` was a STAT_VER=0 + prefix-sanitize relink that
still shipped **DT_SONAME `libvips-cpp.so.42.20.6.new`** because `oldworld-cc`
swallowed `-Wl,*` into `-W*` cflags, and Zig `build-lib` rejects
`-Wl,--no-undefined` (`-fno-allow-shlib-undefined` still emits strong UND).
This file covers the **exact** packaged bytes

`2e9438ad2c854acc6c9d50ea9d84d0b9083b1d06b2ec425c1993e11dd10cedd6`
(22106680). Worker RELINK.md / MANIFEST / elf_inspect `--require-ok` are not
treated as proof. Native execution remains **UNRUN**.

## Bytes

Sidecars preserved, not overwritten:

| Path | SHA-256 | size |
| --- | --- | --- |
| `lib/libvips-cpp.so.42.20.6` (current) | `2e9438ad2c854acc6c9d50ea9d84d0b9083b1d06b2ec425c1993e11dd10cedd6` | 22106680 |
| `lib/libvips-cpp.so.42.20.6.f6ce0989` | `f6ce0989616b2b357a3c7a30880f1acf019c529adb044a78da94ed2bae448a65` | 22106664 |
| `lib/libvips-cpp.so.42.20.6.782e707c` | `782e707c7168cd0b2995a6f757210156f2559938c86f8c0e00a38d0ee25c41ce` | 22160528 |
| `lib/libvips-cpp.so.42.20.6.471de39f` | `471de39f5a56dad5870f1ff5010eabbd4f88da94778e1b2f7ad7e990cdebf9fc` | 11836688 |

Unchanged required natives: koffi `4e19ac67…`, sharp.node `7967795e…`
(DT_NEEDED `libvips-cpp.so.42.20.6`, DT_RUNPATH `$ORIGIN`), flock
`b065bcb1…`, pty `5b5b7386…`. Official npm koffi-linux-loong64
(`49e5aba6…`) is **not** these bytes.

## Linker class guard (not a whitelist)

Zig 0.16 `build-lib` command line for this hash includes `-fsoname=libvips-cpp.so.42.20.6`
and **`-z defs`**. A probe object with a strong `missing_symbol` fails that
same wrapper (`ld.lld: undefined symbol`). `-Wl,--no-undefined` is mapped to
`-z defs` because Zig rejects the GNU spelling. TLS objects also need
`ld.so.1` on the link line or `-z defs` fails on `__tls_get_addr`.

## ELF / UND vs actual sysroot

- `e_machine=258`, `e_flags=0`, no PT_INTERP, no
  `ld-linux-loongarch-lp64d.so.1` anywhere in the image.
- **DT_SONAME `libvips-cpp.so.42.20.6`** (the `.new` loophole is closed).
- DT_NEEDED: `libc.so.6`, **`ld.so.1`** (old-world loader), `libm.so.6`,
  `libdl.so.2`, `libpthread.so.0`, `libresolv.so.2`, `libgcc_s.so.1`,
  `libstdc++.so.6`.
- BIND_NOW / DF_1_NOW.
- DT_VERNEED GLIBC nodes `<= 2.28` (pthread historical 2.0–2.18 present on
  Loongson `libpthread-2.28.so`).
- Strong UND vs **exports of those DT_NEEDED files plus `ld.so.1`**:
  **zero unresolved**. Weak leftover: `gettid`, `__lsan_*` (NULL at load;
  rust uses syscall for gettid). Not a BIND_NOW failure.

Defined `T`: `stat64`/`fstat64`/`lstat64`/`fstatat64`/`atexit`,
`aom_codec_decode`, `SharpYuvInit`, `vips_svgload`, `vips_text`,
`vips_uhdrload`, `rsvg_handle_new`.

## Shim ABI (instructions, not source)

Loongson `bits/stat.h`: `_STAT_VER_KERNEL` / `_STAT_VER_LINUX` / `_STAT_VER`
= **0**. Rust `libc` 0.2.189 `loongarch64` gnu `stat`/`stat64` is the same
kernel shape (`st_dev, st_ino, st_mode, st_nlink, st_uid, st_gid, st_rdev,
pad, st_size, st_blksize, pad2, st_blocks, atime/nsec…`).

Linked `stat64` (20 bytes) starts `or a2,a1,zero; or a1,a0,zero; or a0,zero,zero`
then tail-calls `__xstat64` — **ver=0**. `fstatat64` shifts a3→a4 … a0→a1 then
`or a0,zero,zero`. `atexit` is `or a1,zero,zero; or a2,zero,zero` (arg=0,
dso=0) then `__cxa_atexit`; extra NULL is ignored on LP64; dso=0 runs at
process exit (sharp is process-lifetime).

## Privacy

Equal-length rewrite of `/private/tmp/penglai-uos20-addons-060` and
`nightly-aarch64-apple-darwin` is a stop-gap. Current bytes contain **none**
of `/private/tmp/`, `/Users/`, `apple-darwin`, `/opt/homebrew`, `/Volumes/`.
`build-librsvg-oldworld.sh` now remaps `CARGO_HOME/registry`, `RUSTUP_HOME`,
and `WORK` so a clean rebuild does not emit those strings.

## JPEG implementation

libjpeg-turbo 3.0.4 (libjpeg API), not mozjpeg. Same public JPEG API as
official 1.3.3; encoder implementation differs. JPEG-XL / PDF / Magick
remain official-off. Highway optional SIMD off.

## Remaining (not load holes on this hash)

- Meson user-options tail is now the full `meson-setup.txt` (221 lines);
  truncated 40-line copy kept as `vips-meson-summary.txt.truncated`.
- `elf_inspect.py --sysroot` classifies strong UND against DT_NEEDED +
  `ld.so.1`. Applying it to `.node` files without the Node host and without
  `$ORIGIN` siblings reports `napi_*` / `vips_*` as unresolved; that is the
  Node process and `libvips-cpp.so.42.20.6` at `$ORIGIN`, not a whitelist
  pass. Use `--sysroot` on the DSO; pin `.node` by digest + DT_NEEDED.
- Native UOS load/startup/function remains **OWNER_POST_RELEASE UNRUN**.

## Verdict

Architecture/ABI/provenance on **`2e9438ad…`** is acceptable to integrate as
the UOS libvips-cpp payload. This is **not** a functional native PASS.
The 782e/f6ce receipts do **not** cover this hash.
