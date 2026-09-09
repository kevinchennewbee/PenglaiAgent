#!/bin/bash
# Official sharp-libvips 1.3.3 font/text + uhdr static deps (posix.sh order).
# Highway is skipped: optional SIMD (posix WITHOUT_HIGHWAY on riscv/s390x/armv6).
# JPEG-XL / Magick / PDF remain official-off. librsvg is a later Rust step.
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"
PREFIX="$WORK/work/vips-prefix"
DEPS="$WORK/work/vips-deps"
SRC="$WORK/inputs/src"
CROSS="$WORK/work/cross"
MESON="$WORK/cache/venv/bin/meson"
export PATH="$WORK/work:$WORK/cache/venv/bin:$PREFIX/bin:/usr/bin:/opt/homebrew/bin:$PATH"
export CC="$WORK/work/oldworld-cc"
export CXX="$WORK/work/oldworld-c++"
export AR="$WORK/work/oldworld-ar"
export RANLIB=/usr/bin/true
unset TARGET
export CHOST=loongarch64-linux-gnu
export PKG_CONFIG="$WORK/work/oldworld-pkg-config"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH=""
export PKG_CONFIG_SYSROOT_DIR=""
export TARGET_SYSROOT="$PREFIX"
export CFLAGS="-fPIC -Os"
export CXXFLAGS="-fPIC -Os"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
MESONFLAGS="--cross-file=$CROSS/meson.ini"

extract() {
  local tgz="$1" dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xf "$tgz" -C "$dest" --strip-components=1
}

meson_lib() {
  local name="$1"; shift
  local srcdir="$DEPS/$name"
  local bld="$srcdir/_build"
  rm -rf "$bld"
  "$MESON" setup "$bld" "$srcdir" --prefix="$PREFIX" --default-library=static \
    --buildtype=release $MESONFLAGS "$@"
  python3 "$WORK/scripts/sanitize-meson-config.py" "$bld"
  "$MESON" compile -C "$bld" -j4
  if ! "$MESON" install -C "$bld" --tags devel; then
    echo "WARN: meson install --tags devel failed for $name; trying untagged"
    "$MESON" install -C "$bld"
  fi
}

echo "=== freetype 2.14.3 (harfbuzz disabled, first pass) ==="
if [[ ! -f "$PREFIX/lib/libfreetype.a" ]]; then
  extract "$SRC/freetype-2.14.3.tar.gz" "$DEPS/freetype"
  meson_lib freetype -Dzlib=enabled -Dpng=enabled -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled
fi
ls -l "$PREFIX/lib/libfreetype.a"
"$PKG_CONFIG" --modversion freetype2

echo "=== fontconfig 2.18.3 ==="
if [[ ! -f "$PREFIX/lib/libfontconfig.a" ]]; then
  extract "$SRC/fontconfig-2.18.3.tar.gz" "$DEPS/fontconfig"
  # Official posix.sh: skip gettext ITS install; silence FcInit warning.
  python3 - <<'PY'
from pathlib import Path
p = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/fontconfig/meson.build")
t = p.read_text()
t2 = t.replace("subdir('its')\n", "")
if t2 == t:
    raise SystemExit("fontconfig meson.build: subdir('its') not found")
p.write_text(t2)
src = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/fontconfig/src/fcobjs.c")
s = src.read_text()
s2 = "\n".join(line for line in s.splitlines(True) if "using without calling FcInit" not in line)
src.write_text(s2)
PY
  meson_lib fontconfig -Dcache-build=disabled -Ddoc=disabled -Dnls=disabled -Dtests=disabled -Dtools=disabled -Dxml-backend=expat
fi
ls -l "$PREFIX/lib/libfontconfig.a"
"$PKG_CONFIG" --modversion fontconfig

echo "=== harfbuzz 14.3.1 ==="
if [[ ! -f "$PREFIX/lib/libharfbuzz.a" ]]; then
  extract "$SRC/harfbuzz-14.3.1.tar.gz" "$DEPS/harfbuzz"
  meson_lib harfbuzz \
    -Dgobject=disabled -Dicu=disabled -Dtests=disabled -Dintrospection=disabled \
    -Ddocs=disabled -Dbenchmark=disabled -Dutilities=disabled \
    -Draster=disabled -Dvector=disabled -Dsubset=disabled -Dgpu=disabled -Dgpu_demo=disabled \
    -Dcairo=disabled -Dcoretext=disabled -Dchafa=disabled
fi
ls -l "$PREFIX/lib/libharfbuzz.a"
"$PKG_CONFIG" --modversion harfbuzz

echo "=== freetype 2.14.3 (rebuild with harfbuzz) ==="
extract "$SRC/freetype-2.14.3.tar.gz" "$DEPS/freetype"
meson_lib freetype -Dzlib=enabled -Dpng=enabled -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=enabled
"$PKG_CONFIG" --modversion freetype2

echo "=== pixman 0.46.4 ==="
if [[ ! -f "$PREFIX/lib/libpixman-1.a" ]]; then
  extract "$SRC/pixman-0.46.4.tar.gz" "$DEPS/pixman"
  # loongson-mmi is MIPS Loongson MMI, not LoongArch LSX. Same class as
  # highway: optional arch optimization; scalar path is the product behavior.
  meson_lib pixman -Dlibpng=disabled -Dgtk=disabled -Dopenmp=disabled -Dtests=disabled \
    -Dloongson-mmi=disabled -Dmmx=disabled -Dsse2=disabled -Dssse3=disabled \
    -Dvmx=disabled -Darm-simd=disabled -Dneon=disabled -Da64-neon=disabled \
    -Dmips-dspr2=disabled -Drvv=disabled
fi
ls -l "$PREFIX/lib/libpixman-1.a"
"$PKG_CONFIG" --modversion pixman-1

echo "=== cairo 1.18.4 ==="
if [[ ! -f "$PREFIX/lib/libcairo.a" ]]; then
  extract "$SRC/cairo-1.18.4.tar.xz" "$DEPS/cairo"
  meson_lib cairo \
    -Dquartz=disabled -Dfreetype=enabled -Dfontconfig=enabled -Dtee=disabled \
    -Dxcb=disabled -Dxlib=disabled -Dzlib=disabled -Dtests=disabled \
    -Dspectre=disabled -Dsymbol-lookup=disabled -Dlzo=disabled -Dpng=enabled \
    -Dglib=enabled -Ddwrite=disabled
fi
ls -l "$PREFIX/lib/libcairo.a"
"$PKG_CONFIG" --modversion cairo
"$PKG_CONFIG" --modversion cairo-ft || true
"$PKG_CONFIG" --modversion cairo-fc || true

echo "=== fribidi 1.0.16 ==="
if [[ ! -f "$PREFIX/lib/libfribidi.a" ]]; then
  extract "$SRC/fribidi-1.0.16.tar.xz" "$DEPS/fribidi"
  meson_lib fribidi -Ddocs=false -Dbin=false -Dtests=false
fi
ls -l "$PREFIX/lib/libfribidi.a"
"$PKG_CONFIG" --modversion fribidi

echo "=== pango 1.58.2 ==="
if [[ ! -f "$PREFIX/lib/libpango-1.0.a" ]]; then
  extract "$SRC/pango-1.58.2.tar.xz" "$DEPS/pango"
  python3 - <<'PY'
from pathlib import Path
p = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/pango/meson.build")
t = p.read_text()
# Official posix.sh: sed "/subdir('utils')/{N;d;}" — drop utils + following line.
import re
t2, n = re.subn(r"subdir\('utils'\)\n[^\n]*\n", "", t, count=1)
if n != 1:
    # fallback: just comment utils
    if "subdir('utils')" not in t:
        raise SystemExit("pango meson.build: subdir('utils') not found")
    t2 = t.replace("subdir('utils')", "# subdir('utils')  # skipped: host tools")
p.write_text(t2)
PY
  meson_lib pango \
    -Ddocumentation=false -Dbuild-testsuite=false -Dbuild-examples=false \
    -Dintrospection=disabled -Dfontconfig=enabled -Dxft=disabled -Dlibthai=disabled \
    -Dsysprof=disabled
fi
ls -l "$PREFIX/lib/libpango-1.0.a"
ls -l "$PREFIX/lib/libpangocairo-1.0.a"
ls -l "$PREFIX/lib/libpangoft2-1.0.a"
"$PKG_CONFIG" --modversion pango
"$PKG_CONFIG" --modversion pangocairo
"$PKG_CONFIG" --modversion pangoft2

echo "=== libultrahdr 2.0.2 ==="
if [[ ! -f "$PREFIX/lib/libuhdr.a" && ! -f "$PREFIX/lib/libultrahdr.a" ]]; then
  extract "$SRC/libultrahdr-2.0.2.tar.gz" "$DEPS/uhdr"
  (cd "$DEPS/uhdr" && patch -p1 < "$SRC/libultrahdr-pr383.patch")
  python3 - <<'PY'
from pathlib import Path
p = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/uhdr/CMakeLists.txt")
t = p.read_text()
t2 = t.replace("CMAKE_CROSSCOMPILING AND UHDR_ENABLE_INSTALL", "FALSE")
if t2 == t:
    print("WARN: UHDR_ENABLE_INSTALL cross guard string not found; continuing")
p.write_text(t2)
PY
  cmake -S "$DEPS/uhdr" -B "$DEPS/uhdr/build" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$CROSS/Toolchain.cmake" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_PREFIX_PATH="$PREFIX" \
    -DBUILD_SHARED_LIBS=FALSE -DUHDR_BUILD_EXAMPLES=FALSE \
    -DUHDR_ENABLE_HEIF=FALSE -DUHDR_MAX_DIMENSION=65500 \
    -DUHDR_ENABLE_INTRINSICS=FALSE
  cmake --build "$DEPS/uhdr/build" -j4
  cmake --install "$DEPS/uhdr/build"
fi
ls -l "$PREFIX/lib"/libuhdr* "$PREFIX/lib"/libultrahdr* 2>/dev/null || true
"$PKG_CONFIG" --list-all | rg -i 'pango|cairo|freetype|fontconfig|harfbuzz|fribidi|pixman|uhdr|ultrahdr' || true
echo "text-uhdr deps done"
ls "$PREFIX/lib"/libfreetype* "$PREFIX/lib"/libfontconfig* "$PREFIX/lib"/libharfbuzz* \
  "$PREFIX/lib"/libpixman* "$PREFIX/lib"/libcairo* "$PREFIX/lib"/libfribidi* \
  "$PREFIX/lib"/libpango* "$PREFIX/lib"/libuhdr* "$PREFIX/lib"/libultrahdr* 2>/dev/null || true
