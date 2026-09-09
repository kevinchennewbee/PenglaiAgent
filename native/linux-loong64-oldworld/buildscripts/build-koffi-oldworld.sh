#!/bin/bash
# Architecture-build official koffi 3.1.6 for UOS 20 old-world loong64.
# Does not reuse npm @koromix/koffi-linux-loong64 (DT_NEEDED new-world loader + GLIBC_2.36).
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"

SRC_TGZ="$WORK/inputs/npm/koffi-3.1.6.tgz"
KDIR="$WORK/work/koffi-3.1.6"
rm -rf "$KDIR"
mkdir -p "$KDIR"
tar -xzf "$SRC_TGZ" -C "$KDIR"
PKG="$KDIR/package"
test -f "$PKG/src/koffi/src/ffi.cc"

TRAMP="$WORK/work/koffi-trampolines"
mkdir -p "$TRAMP"
node "$PKG/src/koffi/src/trampolines.cjs" "$TRAMP" 8192
test -f "$TRAMP/gnu.inc"

OUTDIR="$WORK/work/koffi-out"
mkdir -p "$OUTDIR"

COMMON=(
  -dynamic
  -fPIC
  -OReleaseSmall
  -target "$ZIG_TARGET"
  --libc "$WORK/work/libc.txt"
  --gc-sections
  -ffunction-sections
  -isystem "$SYSROOT/usr/include/c++/8.3.0"
  -isystem "$GCCLIB/include"
  -isystem "$GCCLIB/include-fixed"
  -isystem "$SYSROOT/usr/include"
  -I "$PKG"
  -I "$PKG/src/koffi"
  -I "$PKG/vendor/node-addon-api"
  -I "$PKG/vendor/node-api-headers/include"
  -I "$ELECTRON_NODE_INC"
  -I "$TRAMP"
  -D_FILE_OFFSET_BITS=64
  -DFELIX_TARGET=koffi
  -DNAPI_VERSION=8
  -DNODE_ADDON_API_DISABLE_CPP_EXCEPTIONS
  -DNODE_ADDON_API_REQUIRE_BASIC_FINALIZERS
  -DCORE_NO_STATX
  -DVERSION=3.1.6
  -cflags -std=c++20 -fno-exceptions -fno-rtti -fno-strict-aliasing -fwrapv -fvisibility=hidden -fno-semantic-interposition -fdata-sections --
)

echo "zig build-lib koffi 3.1.6 loongarch64-linux-gnu.2.28"
"$ZIG" build-lib "${COMMON[@]}" \
  --name koffi \
  -fsoname=koffi.node \
  -femit-bin="$OUTDIR/koffi.node" \
  "$PKG/src/koffi/src/call.cc" \
  "$PKG/src/koffi/src/ffi.cc" \
  "$PKG/src/koffi/src/parser.cc" \
  "$PKG/src/koffi/src/type.cc" \
  "$PKG/src/koffi/src/util.cc" \
  "$PKG/src/koffi/src/uv.cc" \
  "$PKG/src/koffi/src/win32.cc" \
  "$PKG/lib/native/base/base.cc" \
  "$PKG/src/koffi/src/abi/riscv64.cc" \
  "$PKG/src/koffi/src/abi/loong64_asm.S" \
  "$LINKROOT/lib64/libc.so.6" \
  "$LINKROOT/usr/lib64/libstdc++.so.6" \
  "$LINKROOT/usr/lib64/libm.so.6" \
  "$LINKROOT/usr/lib64/libgcc_s.so.1" \
  "$LINKROOT/usr/lib64/libdl.so.2" \
  "$LINKROOT/usr/lib64/libpthread.so.0"

python3 "$WORK/scripts/elf_inspect.py" --json "$OUTDIR/koffi.node" | tee "$OUTDIR/koffi.node.elf.json"
python3 "$WORK/scripts/elf_inspect.py" --require-ok "$OUTDIR/koffi.node"
echo "koffi.node built: $OUTDIR/koffi.node"
