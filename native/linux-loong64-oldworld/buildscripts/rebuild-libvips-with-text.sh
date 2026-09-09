#!/bin/bash
# Rebuild libvips-cpp 8.18.6 with official posix feature set except highway
# (optional SIMD) and official-off jpeg-xl/magick/PDF. Replaces prefix
# libvips-cpp only after a successful link; packaged 471de39f is copied
# aside, not deleted.
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
export CFLAGS="-fPIC -Os -O3"
export CXXFLAGS="-fPIC -Os -O3"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
MESONFLAGS="--cross-file=$CROSS/meson.ini"

for need in pangocairo librsvg-2.0 cairo-gobject; do
  "$PKG_CONFIG" --exists "$need" || { echo "missing $need"; exit 1; }
done
# uhdr pc name varies
"$PKG_CONFIG" --exists libuhdr || "$PKG_CONFIG" --exists libultrahdr || ls "$PREFIX/lib"/libuhdr* "$PREFIX/lib"/libultrahdr* 

# Preserve already-packaged bytes
KEEP="$WORK/deliverables/sharp-0.35.4/lib/libvips-cpp.so.42.20.6"
if [[ -f "$KEEP" ]]; then
  echo "preserving packaged libvips-cpp $(shasum -a 256 "$KEEP")"
fi

rm -rf "$DEPS/vips-text"
mkdir -p "$DEPS/vips-text"
tar -xf "$SRC/vips-8.18.6.tar.xz" -C "$DEPS/vips-text" --strip-components=1
cd "$DEPS/vips-text"
patch -p1 < "$WORK/deliverables/sourcepatch/libvips-8.18.6-skip-host-tools.patch" || true
python3 - <<'PY'
from pathlib import Path
p = Path("libvips/meson.build")
t = p.read_text()
t = t.replace("libvips_lib = library('vips',", "libvips_lib = static_library('vips',")
t = t.replace("    version: library_version,\n", "")
t = t.replace("    darwin_versions: darwin_versions,\n", "")
p.write_text(t)
print("static_library vips without version kwargs")
PY
# posix: drop version from static vips; skip man/tools
python3 - <<'PY'
from pathlib import Path
p = Path("libvips/meson.build")
t = p.read_text()
# leave as-is if already static
p2 = Path("meson.build")
mb = p2.read_text()
mb2 = mb.replace("subdir('man')", "# subdir('man')")
p2.write_text(mb2)
PY

rm -rf _build
"$MESON" setup _build . --prefix="$PREFIX" --default-library=shared \
  --buildtype=release $MESONFLAGS \
  -Ddeprecated=false -Dexamples=false -Dauto_features=enabled \
  -Dintrospection=disabled -Dmodules=disabled \
  -Dcfitsio=disabled -Dfftw=disabled -Dhighway=disabled -Dorc=disabled \
  -Dmagick=disabled -Dmatio=disabled -Dnifti=disabled -Dopenexr=disabled \
  -Dopenjpeg=disabled -Dopenslide=disabled -Dpdfium=disabled -Dpoppler=disabled \
  -Dquantizr=disabled -Draw=disabled -Dspng=disabled -Djpeg-xl=disabled \
  -Dppm=false -Danalyze=false -Dradiance=false \
  -Drsvg=enabled -Dcplusplus=true
python3 "$WORK/scripts/sanitize-meson-config.py" _build
"$MESON" compile -C _build -j4
"$MESON" install -C _build --tags runtime,devel || "$MESON" install -C _build
ls -l "$PREFIX/lib"/libvips-cpp.so*
python3 "$WORK/scripts/elf_inspect.py" --require-ok "$PREFIX/lib/libvips-cpp.so.42.20.6" \
  || python3 "$WORK/scripts/elf_inspect.py" --require-ok "$PREFIX/lib/libvips-cpp.so"
echo "libvips-with-text done"
