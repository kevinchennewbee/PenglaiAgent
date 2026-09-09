# UOS 20 linux-loong64 flock addon (architecture build)

Official `@deepseek-ai/node-addon-system@0.1.2` has no
`node-addon-system-linux-loong64` npm package. JSONL locking loads
`@deepseek-ai/node-addon-system-${platform}-${arch}/bin/glibc/system.node`.
Zig’s bundled `loongarch64-linux-gnu.2.36` output is **new-world**
(`ld-linux-loongarch-lp64d.so.1`, `GLIBC_2.36`) and is **not** the
UOS 20 addon.

## Legal build (actual bytes, 2026-09-09)

Source: DSH `native/system` `flock.c` from npm
`@deepseek-ai/node-addon-system@0.1.2` (BSD-3-Clause). N-API v8.

Sysroot: Loongson gcc 8.3 old-world toolchain
`loongson-gnu-toolchain-8.3-x86_64-loongarch64-linux-gnu-rc1.6.tar.xz`
from `https://ftp.loongnix.cn/toolchain/gcc/release/loongarch/gcc8/`
SHA-256 `fb39d178b6760f49852e8452c092bfc176a98c3166ce13b7d700e3da9e99e237`
(36028144). libc is `libc-2.28.so`, interpreter `/lib64/ld.so.1`,
`for GNU/Linux 4.15.0`. The x86_64-hosted compiler is not executed on
this Mac; only the loong64 sysroot is used.

Headers: Electron 31.7.7 `node_headers` (Node 20.18.0).

Compiler: Zig 0.16.0 `build-lib -dynamic` target
`loongarch64-linux-gnu.2.28` with a rewritten `libc.so` GROUP that uses
relative `libc.so.6` / `ld.so.1` instead of absolute `/lib64` paths.

Result ELF (shared object, no PT_INTERP):

- machine LoongArch (`e_machine` 258)
- `DT_NEEDED`: `libc.so.6` only
- GNU symbol versions: `GLIBC_2.27` (subset of 2.28)
- no `ld-linux-loongarch-lp64d.so.1`
- size 7640
- SHA-256 `b065bcb1945dffa04a075578dff55a50604c3901716912714b81c24757167868`

This is an architecture build of official DSH flock, not a second core.
Native load on UOS 20 remains `OWNER_POST_RELEASE`.

## node-pty `pty.node` (same sysroot)

`node-pty` `src/unix/pty.cc` compiled with gcc 8.3 libstdc++ headers
and linked against `libc.so.6`, `libstdc++.so.6`, `libutil.so.1`.
ELF shared object, no PT_INTERP, `GLIBC_2.27`, no new-world loader,
SHA-256 `5b5b7386569040bdc5af2c3f5213757e032636b0b80b50a3675eb2e347f73cb0`
(47992). Linux packager requires `pty.node` only (spawn-helper is
darwin). Do not ship Zig’s default spawn-helper: it received
`ld-linux-loongarch-lp64d.so.1`.

## Required natives now in-tree

See `docs/0.6.0/UOS20_ADDONS.md` and `native/linux-loong64-oldworld/`.
Official npm koffi-linux-loong64 remains new-world and is **not** shipped.
`node-addon-require-builtin` native stays unpublished. Native UOS
install/startup/function remain `OWNER_POST_RELEASE`.
