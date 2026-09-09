#!/bin/bash
# Relink libvips-cpp with header-correct stat64 shims and extra private libs.
# Preserves prior packaged hashes as sidecars. Native UNRUN.
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"
PREFIX="$WORK/work/vips-prefix"
BUILD="$WORK/work/vips-deps/vips-text/_build"
OUTDIR="$WORK/deliverables/sharp-0.35.4/lib"
INST="$WORK/deliverables/sharp-0.35.4/install-layout/src/build/Release"
export PATH="$WORK/work:$PATH"
export CC="$WORK/work/oldworld-cc"
export CXX="$WORK/work/oldworld-c++"

KEEP="$OUTDIR/libvips-cpp.so.42.20.6"
if [[ -f "$KEEP" ]]; then
  cur=$(shasum -a 256 "$KEEP" | awk '{print $1}')
  side="$KEEP.${cur:0:8}"
  if [[ ! -f "$side" ]]; then
    cp -p "$KEEP" "$side"
    echo "preserved $cur as $side"
  fi
fi

"$CC" -c -fPIC -o "$WORK/work/glibc-shims.o" \
  "$WORK/deliverables/sourcepatch/glibc-stat64-atexit-shims.c"

OBJ=(
  "$BUILD/cplusplus/libvips-cpp.so.42.20.6.p/VImage.cpp.o"
  "$BUILD/cplusplus/libvips-cpp.so.42.20.6.p/VInterpolate.cpp.o"
  "$BUILD/cplusplus/libvips-cpp.so.42.20.6.p/VRegion.cpp.o"
  "$BUILD/cplusplus/libvips-cpp.so.42.20.6.p/VConnection.cpp.o"
  "$BUILD/cplusplus/libvips-cpp.so.42.20.6.p/VError.cpp.o"
  "$WORK/work/glibc-shims.o"
)
LIBS=(
  "$BUILD/libvips/libvips.a"
  "$PREFIX/lib/librsvg-2.a"
  "$PREFIX/lib/libheif.a"
  "$PREFIX/lib/libaom.a"
  "$PREFIX/lib/libuhdr.a"
  "$PREFIX/lib/libwebp.a"
  "$PREFIX/lib/libwebpmux.a"
  "$PREFIX/lib/libwebpdemux.a"
  "$PREFIX/lib/libsharpyuv.a"
  "$PREFIX/lib/libpangocairo-1.0.a"
  "$PREFIX/lib/libpangoft2-1.0.a"
  "$PREFIX/lib/libpango-1.0.a"
  "$PREFIX/lib/libharfbuzz.a"
  "$PREFIX/lib/libfribidi.a"
  "$PREFIX/lib/libcairo.a"
  "$PREFIX/lib/libpixman-1.a"
  "$PREFIX/lib/libfontconfig.a"
  "$PREFIX/lib/libfreetype.a"
  "$PREFIX/lib/libxml2.a"
  "$PREFIX/lib/libpcre2-8.a"
  "$PREFIX/lib/libgio-2.0.a"
  "$PREFIX/lib/libgobject-2.0.a"
  "$PREFIX/lib/libgmodule-2.0.a"
  "$PREFIX/lib/libglib-2.0.a"
  "$PREFIX/lib/libffi.a"
  "$PREFIX/lib/libexif.a"
  "$PREFIX/lib/libjpeg.a"
  "$PREFIX/lib/libpng16.a"
  "$PREFIX/lib/libtiff.a"
  "$PREFIX/lib/liblcms2.a"
  "$PREFIX/lib/libarchive.a"
  "$PREFIX/lib/libimagequant.a"
  "$PREFIX/lib/libcgif.a"
  "$PREFIX/lib/libexpat.a"
  "$PREFIX/lib/libz.a"
)
for f in "${OBJ[@]}" "${LIBS[@]}"; do
  test -f "$f" || { echo "missing $f"; exit 1; }
done

# Emit under the intended SONAME filename. Zig -fsoname wins when parsed, but
# the previous `.new` emit-bin became DT_SONAME because -Wl,* was swallowed.
relink_dir="$WORK/work/relink-out"
rm -rf "$relink_dir"
mkdir -p "$relink_dir"
tmp="$relink_dir/libvips-cpp.so.42.20.6"
"$CXX" -shared -fPIC -o "$tmp" \
  -Wl,--no-undefined \
  -Wl,-soname,libvips-cpp.so.42.20.6 \
  "${OBJ[@]}" "${LIBS[@]}" \
  -lm -ldl -lpthread -lresolv
test -s "$tmp"

python3 - <<'PY'
from pathlib import Path
p = Path("/private/tmp/penglai-uos20-addons-060/work/relink-out/libvips-cpp.so.42.20.6")
data = bytearray(p.read_bytes())
old = b"/private/tmp/penglai-uos20-addons-060"
new = b"/usr/src/penglai-0.6.0-uos20-owb--"
new = new + b"-" * (len(old) - len(new))
if len(old) != len(new):
    raise SystemExit(f"prefix length {len(old)} != {len(new)}")
n = data.replace(old, new)
if n == data:
    raise SystemExit("host prefix not found in DSO; remap did not apply")
a = b"nightly-aarch64-apple-darwin"
b = b"nightly-loong64-linux-gnu---"
if len(a) != len(b):
    raise SystemExit(f"triple length {len(a)} != {len(b)}")
n2 = n.replace(a, b)
p.write_bytes(n2)
print("rewrote host prefixes", data.count(old), "triple", n.count(a))
PY

python3 "$WORK/scripts/elf_inspect.py" --require-ok \
  --sysroot "$WORK/work/linkroot" \
  --expect-soname libvips-cpp.so.42.20.6 \
  --forbid-host-paths \
  "$tmp"
install -m 0755 "$tmp" "$KEEP"
install -m 0755 "$tmp" "$INST/libvips-cpp.so.42.20.6"
shasum -a 256 "$KEEP"
python3 - <<'PY'
from pathlib import Path
p=Path("/private/tmp/penglai-uos20-addons-060/deliverables/sharp-0.35.4/lib/libvips-cpp.so.42.20.6")
d=p.read_bytes()
bad=[b"/private/tmp/", b"/Users/", b"apple-darwin", b"/opt/homebrew", b"/Volumes/"]
for b in bad:
    if b in d:
        raise SystemExit(f"host path remains: {b!r}")
print("no listed host-path needles")
PY
echo "relink ok"
