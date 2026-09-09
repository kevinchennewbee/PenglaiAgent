#!/bin/bash
# Cross-build libvips 8.18.6 + codec deps for UOS 20 old-world loong64.
# Uses official sharp-libvips 1.3.3 versions. SVG/HEIF/librsvg (Rust) omitted
# on this pass unless they build; core JPEG/PNG/WebP/TIFF/GIF/EXIF/LCMS included.
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"

PREFIX="$WORK/work/vips-prefix"
DEPS="$WORK/work/vips-deps"
SRC="$WORK/inputs/src"
CROSS="$WORK/work/cross"
MESON="$WORK/cache/venv/bin/meson"
CURL="curl --silent --location --retry 3 --retry-max-time 30"
mkdir -p "$PREFIX" "$DEPS" "$SRC"
export PATH="$WORK/work:$WORK/cache/venv/bin:$PATH"
export CC="$WORK/work/oldworld-cc"
export CXX="$WORK/work/oldworld-c++"
export AR="$WORK/work/oldworld-ar"
export RANLIB=/usr/bin/true
unset TARGET
export CHOST=loongarch64-linux-gnu
export PKG_CONFIG=/opt/homebrew/bin/pkg-config
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig"
export PKG_CONFIG_PATH=""
export PKG_CONFIG_SYSROOT_DIR=""
export TARGET_SYSROOT="$PREFIX"
export CFLAGS="-fPIC -Os"
export CXXFLAGS="-fPIC -Os"
export CPPFLAGS="-I$PREFIX/include"
export LDFLAGS="-L$PREFIX/lib"
export MESONFLAGS="--cross-file=$CROSS/meson.ini"

fetch() {
  local url="$1" dest="$2"
  if [[ ! -f "$dest" ]]; then
    echo "GET $url"
    $CURL -o "$dest" "$url"
  fi
}

extract() {
  local tgz="$1" dest="$2"
  rm -rf "$dest"
  mkdir -p "$dest"
  tar -xf "$tgz" -C "$dest" --strip-components=1
}

# --- zlib-ng 2.3.3 (compat zlib) ---
if [[ ! -f "$PREFIX/lib/libz.a" ]]; then
  fetch "https://github.com/zlib-ng/zlib-ng/archive/2.3.3.tar.gz" "$SRC/zlib-ng-2.3.3.tar.gz"
  extract "$SRC/zlib-ng-2.3.3.tar.gz" "$DEPS/zlib-ng"
  cmake -S "$DEPS/zlib-ng" -B "$DEPS/zlib-ng/build" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$CROSS/Toolchain.cmake" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE=Release \
    -DBUILD_SHARED_LIBS=FALSE -DBUILD_TESTING=FALSE \
    -DZLIB_COMPAT=TRUE -DWITH_ARMV6=FALSE
  cmake --build "$DEPS/zlib-ng/build" -j4
  cmake --install "$DEPS/zlib-ng/build"
fi
echo "zlib-ng OK"

cmake_lib() {
  local name="$1"
  shift
  cmake -S "$DEPS/$name" -B "$DEPS/$name/build" -G "Unix Makefiles" \
    -DCMAKE_TOOLCHAIN_FILE="$CROSS/Toolchain.cmake" \
    -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_INSTALL_LIBDIR=lib \
    -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_PREFIX_PATH="$PREFIX" \
    "$@"
  cmake --build "$DEPS/$name/build" -j4
  cmake --install "$DEPS/$name/build"
}

# --- libffi 3.8.0 ---
if [[ ! -f "$PREFIX/lib/libffi.a" && ! -f "$PREFIX/lib64/libffi.a" ]]; then
  fetch "https://github.com/libffi/libffi/releases/download/v3.8.0/libffi-3.8.0.tar.gz" "$SRC/libffi-3.8.0.tar.gz"
  extract "$SRC/libffi-3.8.0.tar.gz" "$DEPS/ffi"
  if [[ -f "$DEPS/ffi/meson.build" ]]; then
    "$MESON" setup "$DEPS/ffi/_build" "$DEPS/ffi" --prefix="$PREFIX" --default-library=static --buildtype=release $MESONFLAGS \
      -Dtests=false -Ddocs=false || true
  fi
  if [[ ! -f "$PREFIX/lib/libffi.a" ]]; then
    (
      cd "$DEPS/ffi"
      ./configure --host="$CHOST" --build=aarch64-apple-darwin --prefix="$PREFIX" \
        --enable-static --disable-shared --disable-dependency-tracking \
        --disable-docs --disable-multi-os-directory \
        CC="$CC" CXX="$CXX" AR="$AR" RANLIB="$RANLIB" \
        ffi_cv_hidden_visibility_attribute=yes \
        ac_cv_func_mmap_fixed_mapped=yes \
        ac_cv_func_malloc_0_nonnull=yes \
        ac_cv_func_realloc_0_nonnull=yes
      make -j4
      make install
    )
  fi
fi
echo "libffi OK"; ls "$PREFIX/lib"/libffi* "$PREFIX/lib64"/libffi* 2>/dev/null || true

# --- libpng 1.6.58 ---
if [[ ! -f "$PREFIX/lib/libpng.a" && ! -f "$PREFIX/lib/libpng16.a" ]]; then
  fetch "https://github.com/pnggroup/libpng/archive/v1.6.58.tar.gz" "$SRC/libpng-1.6.58.tar.gz"
  extract "$SRC/libpng-1.6.58.tar.gz" "$DEPS/png"
  cmake_lib png \
    -DBUILD_SHARED_LIBS=FALSE -DPNG_SHARED=OFF -DPNG_STATIC=ON \
    -DPNG_TESTS=OFF -DPNG_TOOLS=OFF -DZLIB_ROOT="$PREFIX"
fi
echo "libpng OK"

# --- libjpeg-turbo (SIMD off; no nasm). Not mozjpeg; same libjpeg API for libvips. ---
if [[ ! -f "$PREFIX/lib/libjpeg.a" ]]; then
  fetch "https://github.com/libjpeg-turbo/libjpeg-turbo/releases/download/3.0.4/libjpeg-turbo-3.0.4.tar.gz" "$SRC/libjpeg-turbo-3.0.4.tar.gz"
  extract "$SRC/libjpeg-turbo-3.0.4.tar.gz" "$DEPS/jpeg"
  cmake_lib jpeg \
    -DENABLE_SHARED=FALSE -DENABLE_STATIC=TRUE \
    -DWITH_TURBOJPEG=FALSE -DWITH_SIMD=FALSE \
    -DWITH_JAVA=FALSE
fi
echo "libjpeg OK"

# --- libwebp 1.6.0 ---
if [[ ! -f "$PREFIX/lib/libwebp.a" ]]; then
  fetch "https://storage.googleapis.com/downloads.webmproject.org/releases/webp/libwebp-1.6.0.tar.gz" "$SRC/libwebp-1.6.0.tar.gz"
  extract "$SRC/libwebp-1.6.0.tar.gz" "$DEPS/webp"
  cmake_lib webp \
    -DBUILD_SHARED_LIBS=FALSE \
    -DWEBP_BUILD_ANIM_UTILS=OFF -DWEBP_BUILD_CWEBP=OFF -DWEBP_BUILD_DWEBP=OFF \
    -DWEBP_BUILD_GIF2WEBP=OFF -DWEBP_BUILD_IMG2WEBP=OFF -DWEBP_BUILD_VWEBP=OFF \
    -DWEBP_BUILD_WEBPINFO=OFF -DWEBP_BUILD_WEBPMUX=OFF -DWEBP_BUILD_EXTRAS=OFF \
    -DWEBP_BUILD_TESTS=OFF
fi
echo "libwebp OK"

# --- glib 2.82.5 (2.89 needs extra wraps; 2.82 is sufficient for libvips 8.18) ---
if [[ ! -f "$PREFIX/lib/libglib-2.0.a" ]]; then
  fetch "https://download.gnome.org/sources/glib/2.82/glib-2.82.5.tar.xz" "$SRC/glib-2.82.5.tar.xz"
  extract "$SRC/glib-2.82.5.tar.xz" "$DEPS/glib"
  "$MESON" setup "$DEPS/glib/_build" "$DEPS/glib" --prefix="$PREFIX" --default-library=static \
    --buildtype=release $MESONFLAGS \
    --force-fallback-for=gvdb,pcre2 \
    -Dintrospection=disabled -Dnls=disabled -Dlibmount=disabled -Dsysprof=disabled \
    -Dlibelf=disabled -Dtests=false -Dglib_assert=false -Dglib_checks=false \
    -Dglib_debug=disabled -Dxattr=false
  "$MESON" compile -C "$DEPS/glib/_build" -j4
  "$MESON" install -C "$DEPS/glib/_build"
fi
echo "glib OK"

# --- libvips 8.18.6 ---
if [[ ! -f "$PREFIX/lib/libvips-cpp.so.8.18.6" && ! -f "$PREFIX/lib/libvips.so" && ! -f "$PREFIX/lib/libvips-cpp.a" ]]; then
  fetch "https://github.com/libvips/libvips/releases/download/v8.18.6/vips-8.18.6.tar.xz" "$SRC/vips-8.18.6.tar.xz"
  extract "$SRC/vips-8.18.6.tar.xz" "$DEPS/vips"
  "$MESON" setup "$DEPS/vips/_build" "$DEPS/vips" --prefix="$PREFIX" --default-library=shared \
    --buildtype=release $MESONFLAGS \
    -Dintrospection=disabled -Dmodules=disabled \
    -Dmagick=disabled -Dopenslide=disabled -Dmatio=disabled -Dcfitsio=disabled \
    -Dnifti=disabled -Dpdfium=disabled -Dpoppler=disabled -Drsvg=disabled \
    -Dpng=enabled -Djpeg=enabled -Dwebp=enabled -Dtiff=disabled -Dexif=disabled \
    -Dlcms=disabled -Dheif=disabled -Djxl=disabled -Darchive=disabled \
    -Dfftw=disabled -Dorc=disabled -Dhighway=disabled -Dimagequant=disabled \
    -Dcplusplus=true
  "$MESON" compile -C "$DEPS/vips/_build" -j4
  "$MESON" install -C "$DEPS/vips/_build"
fi
echo "libvips OK"
ls -la "$PREFIX/lib" | head -40


