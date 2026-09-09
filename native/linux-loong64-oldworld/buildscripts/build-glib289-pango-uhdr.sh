#!/bin/bash
# Official sharp-libvips glib 2.89.4 (pango 1.58 requires >= 2.88), then
# rebuild cairo-gobject, pango, and uhdr. Does not rebuild koffi or packaged
# libvips-cpp 471de39f.
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

copy_static_devel() {
  local bld="$1"
  mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include"
  find "$bld" -name '*.a' -not -path '*/subprojects/*' | while read -r a; do
    cp -f "$a" "$PREFIX/lib/" || true
  done
  find "$bld" -name '*.pc' | while read -r pc; do
    cp -f "$pc" "$PREFIX/lib/pkgconfig/" || true
  done
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
    echo "WARN: meson install --tags devel failed for $name; trying untagged / copy"
    "$MESON" install -C "$bld" || copy_static_devel "$bld"
  fi
}

echo "=== glib 2.89.4 (official sharp-libvips; pango 1.58 needs >= 2.88) ==="
if [[ "${GLIB_SKIP:-}" == "1" ]]; then
  echo "GLIB_SKIP=1; using prefix $($PKG_CONFIG --modversion glib-2.0)"
elif [[ ! -f "$DEPS/glib289/_build/build.ninja" ]]; then
  extract "$SRC/glib-2.89.4.tar.xz" "$DEPS/glib289"
  (cd "$DEPS/glib289" && patch -p1 < "$SRC/glib-without-gregex.patch")
  rm -rf "$DEPS/glib289/_build"
  "$MESON" setup "$DEPS/glib289/_build" "$DEPS/glib289" --prefix="$PREFIX" --default-library=static \
    --buildtype=release --datadir="$PREFIX/share" $MESONFLAGS \
    --force-fallback-for=gvdb,pcre2 \
    -Dintrospection=disabled -Dnls=disabled -Dlibmount=disabled -Dsysprof=disabled \
    -Dlibelf=disabled -Dtests=false -Dglib_assert=false -Dglib_checks=false \
    -Dglib_debug=disabled -Dxattr=false -Dselinux=disabled -Dlibmount=disabled \
    -Ddocumentation=false -Dman-pages=disabled -Ddtrace=disabled -Dsystemtap=disabled
fi
if [[ "${GLIB_SKIP:-}" != "1" ]]; then
python3 "$WORK/scripts/sanitize-meson-config.py" "$DEPS/glib289/_build"
# Host tools (gtester, gobject-query) fail to link: Zig lld + glibc 2.28
# has no fstat64/atexit in the way those Darwin-hosted links expect.
# Compile static libs only — same strategy as glib 2.82.5 in this tree.
ninja -C "$DEPS/glib289/_build" -j4 \
  glib/libglib-2.0.a gobject/libgobject-2.0.a gmodule/libgmodule-2.0.a \
  gio/libgio-2.0.a gthread/libgthread-2.0.a
# Skip meson install: it rebuilds host tools (gtester) that fail to link.
# Overlay static libs + generated pc/headers.
mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include/glib-2.0" "$PREFIX/lib/glib-2.0/include" "$PREFIX/bin"
cp -f "$DEPS/glib289/_build/glib/libglib-2.0.a" \
  "$DEPS/glib289/_build/gobject/libgobject-2.0.a" \
  "$DEPS/glib289/_build/gmodule/libgmodule-2.0.a" \
  "$DEPS/glib289/_build/gio/libgio-2.0.a" \
  "$DEPS/glib289/_build/gthread/libgthread-2.0.a" \
  "$PREFIX/lib/"
cp -f "$DEPS/glib289/_build/meson-private/"*.pc "$PREFIX/lib/pkgconfig/"
# public headers
cp -R "$DEPS/glib289/glib" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/glib.h" "$PREFIX/include/glib-2.0/" 2>/dev/null || true
cp -R "$DEPS/glib289/gobject" "$PREFIX/include/glib-2.0/"
cp -R "$DEPS/glib289/gio" "$PREFIX/include/glib-2.0/"
cp -R "$DEPS/glib289/gmodule" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/glib/glibconfig.h" "$PREFIX/lib/glib-2.0/include/glibconfig.h"
cp -f "$DEPS/glib289/_build/glib/glibconfig.h" "$PREFIX/include/glib-2.0/glibconfig.h"
# generated visibility + enum headers (macros like GLIB_AVAILABLE_IN_2_86)
cp -f "$DEPS/glib289/_build/glib/glib-visibility.h" "$PREFIX/include/glib-2.0/glib/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gobject/gobject-visibility.h" "$PREFIX/include/glib-2.0/gobject/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gio/gio-visibility.h" "$PREFIX/include/glib-2.0/gio/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gmodule/gmodule-visibility.h" "$PREFIX/include/glib-2.0/gmodule/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gobject/glib-enumtypes.h" "$PREFIX/include/glib-2.0/gobject/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gio/gioenumtypes.h" "$PREFIX/include/glib-2.0/gio/" "$PREFIX/include/glib-2.0/"
cp -f "$DEPS/glib289/_build/gobject/glib-mkenums" "$PREFIX/bin/glib-mkenums"
cp -f "$DEPS/glib289/_build/gobject/glib-genmarshal" "$PREFIX/bin/glib-genmarshal"
chmod +x "$PREFIX/bin/glib-mkenums" "$PREFIX/bin/glib-genmarshal"
# glib-mkenums for pango/cairo
if [[ -f "$DEPS/glib289/_build/gobject/glib-mkenums" ]]; then
  mkdir -p "$PREFIX/bin"
  cp "$DEPS/glib289/_build/gobject/glib-mkenums" "$PREFIX/bin/glib-mkenums"
  chmod +x "$PREFIX/bin/glib-mkenums"
fi
# Point meson cross file at the new glib-mkenums
python3 - <<'PY'
from pathlib import Path
p = Path("/private/tmp/penglai-uos20-addons-060/work/cross/meson.ini")
t = p.read_text()
new = "/private/tmp/penglai-uos20-addons-060/work/vips-prefix/bin/glib-mkenums"
old_line = None
for line in t.splitlines():
    if line.startswith("glib-mkenums"):
        old_line = line
t2 = t
if old_line:
    t2 = t.replace(old_line, f"glib-mkenums = '{new}'")
elif "glib-mkenums" not in t:
    t2 = t.replace("[binaries]\n", "[binaries]\nglib-mkenums = '%s'\n" % new)
p.write_text(t2)
print(p.read_text())
PY
"$PKG_CONFIG" --modversion glib-2.0
"$PKG_CONFIG" --modversion gobject-2.0
ls -l "$PREFIX/lib/libglib-2.0.a" "$PREFIX/lib/libgobject-2.0.a"
fi

echo "=== cairo 1.18.4 rebuild against glib 2.89 ==="
if [[ -f "$PREFIX/lib/libcairo.a" && -f "$PREFIX/lib/pkgconfig/cairo-gobject.pc" ]]; then
  echo "cairo already in prefix $($PKG_CONFIG --modversion cairo)"
else
extract "$SRC/cairo-1.18.4.tar.xz" "$DEPS/cairo"
meson_lib cairo \
  -Dquartz=disabled -Dfreetype=enabled -Dfontconfig=enabled -Dtee=disabled \
  -Dxcb=disabled -Dxlib=disabled -Dzlib=disabled -Dtests=disabled \
  -Dspectre=disabled -Dsymbol-lookup=disabled -Dlzo=disabled -Dpng=enabled \
  -Dglib=enabled -Ddwrite=disabled
fi
"$PKG_CONFIG" --modversion cairo
"$PKG_CONFIG" --modversion cairo-gobject
"$PKG_CONFIG" --modversion cairo-png
"$PKG_CONFIG" --modversion cairo-ft

echo "=== pango 1.58.2 ==="
extract "$SRC/pango-1.58.2.tar.xz" "$DEPS/pango"
python3 - <<'PY'
from pathlib import Path
import re
p = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/pango/meson.build")
t = p.read_text()
t2, n = re.subn(r"subdir\('utils'\)\n[^\n]*\n", "", t, count=1)
if n != 1:
    if "subdir('utils')" not in t:
        raise SystemExit("pango meson.build: subdir('utils') not found")
    t2 = t.replace("subdir('utils')", "# subdir('utils')")
p.write_text(t2)
PY
meson_lib pango \
  -Ddocumentation=false -Dbuild-testsuite=false -Dbuild-examples=false \
  -Dintrospection=disabled -Dfontconfig=enabled -Dxft=disabled -Dlibthai=disabled \
  -Dsysprof=disabled
ls -l "$PREFIX/lib/libpango-1.0.a" "$PREFIX/lib/libpangocairo-1.0.a" "$PREFIX/lib/libpangoft2-1.0.a"
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
echo "glib289-pango-uhdr done"
"$PKG_CONFIG" --list-all | sort
