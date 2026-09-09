#!/bin/bash
# Architecture-build official sharp 0.35.4 (N-API 9) against old-world libvips 8.18.6.
# Links DT_NEEDED libvips-cpp.so.42.20.6 (codecs + glib statically inside that DSO).
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"

PREFIX="$WORK/work/vips-prefix"
SHARP_SRC="$WORK/work/tmp-extract/sharp-pkg/package/src"
NAPI="$WORK/work/node-addon-api/package"
NODEINC="$WORK/inputs/node-22.16.0-headers/include/node"
OUT="$WORK/work/sharp-out"
mkdir -p "$OUT"
export PATH="$WORK/work:$PATH"
export PKG_CONFIG="$WORK/work/oldworld-pkg-config"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH=""

CXX="$WORK/work/oldworld-c++"
CFLAGS=(
  -c -fPIC -std=c++17 -fexceptions -frtti
  -Wall -Os
  -DNAPI_VERSION=9
  -DNODE_ADDON_API_DISABLE_DEPRECATED
  -DNODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS
  -DG_DISABLE_ASSERT -DG_DISABLE_CAST_CHECKS -DG_DISABLE_CHECKS
  -D_GLIBCXX_USE_CXX11_ABI=1
  -D_FILE_OFFSET_BITS=64
  -I "$NAPI"
  -I "$NODEINC"
  -I "$PREFIX/include"
  -I "$PREFIX/include/glib-2.0"
  -I "$PREFIX/lib/glib-2.0/include"
)

OBJS=()
for src in common.cc metadata.cc stats.cc operations.cc pipeline.cc utilities.cc sharp.cc; do
  obj="$OUT/${src%.cc}.o"
  echo "CC $src"
  "$CXX" "${CFLAGS[@]}" -o "$obj" "$SHARP_SRC/$src"
  OBJS+=("$obj")
done

echo "LINK sharp.node"
"$CXX" -shared -fPIC \
  -o "$OUT/sharp.node" \
  -Wl,-rpath,\$ORIGIN \
  "${OBJS[@]}" \
  -L "$PREFIX/lib" \
  -lvips-cpp \
  -lstdc++ -lm -lpthread -ldl

python3 "$WORK/scripts/elf_inspect.py" --json "$OUT/sharp.node" | tee "$OUT/sharp.node.elf.json"
python3 "$WORK/scripts/elf_inspect.py" --require-ok "$OUT/sharp.node"
echo "sharp.node built: $OUT/sharp.node"
