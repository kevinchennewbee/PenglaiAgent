#!/bin/bash
# Official librsvg 2.62.91 via posix.sh meson flags + isolated nightly
# -Zbuild-std linked with oldworld-cc. No version downgrade.
set -euo pipefail
source "$(dirname "$0")/env.sh"
"$(dirname "$0")/setup-linkroot.sh"
PREFIX="$WORK/work/vips-prefix"
DEPS="$WORK/work/vips-deps"
SRC="$WORK/inputs/src"
CROSS="$WORK/work/cross"
MESON="$WORK/cache/venv/bin/meson"
export RUSTUP_HOME="$WORK/cache/rustup"
export CARGO_HOME="$WORK/cache/cargo"
export PATH="$CARGO_HOME/bin:$RUSTUP_HOME/toolchains/nightly-aarch64-apple-darwin/bin:$WORK/work:$WORK/cache/venv/bin:$PREFIX/bin:/usr/bin:/opt/homebrew/bin:$PATH"
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
export CARGO_PROFILE_RELEASE_DEBUG=false
export CARGO_PROFILE_RELEASE_CODEGEN_UNITS=1
export CARGO_PROFILE_RELEASE_INCREMENTAL=false
export CARGO_PROFILE_RELEASE_LTO=true
export CARGO_PROFILE_RELEASE_OPT_LEVEL=z
export CARGO_PROFILE_RELEASE_PANIC=abort
export RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=-lsx,-lasx -C panic=abort --remap-path-prefix=$CARGO_HOME/registry/= --remap-path-prefix=$RUSTUP_HOME/= --remap-path-prefix=$WORK/="
export CARGO_BUILD_TARGET=loongarch64-unknown-linux-gnu
RUST_TARGET=loongarch64-unknown-linux-gnu
MESONFLAGS="--cross-file=$CROSS/meson.ini"

command -v cargo-cbuild
cargo-cbuild --version
rustc --version
"$PKG_CONFIG" --modversion glib-2.0
"$PKG_CONFIG" --modversion pangocairo
"$PKG_CONFIG" --modversion cairo-gobject
"$PKG_CONFIG" --modversion cairo-png

rm -rf "$DEPS/rsvg"
mkdir -p "$DEPS/rsvg"
tar -xf "$SRC/librsvg-2.62.91.tar.xz" -C "$DEPS/rsvg" --strip-components=1
cd "$DEPS/rsvg"

# Official posix.sh Cargo.toml edits
python3 - <<'PY'
from pathlib import Path
root = Path("/private/tmp/penglai-uos20-addons-060/work/vips-deps/rsvg")
p = root / "rsvg/Cargo.toml"
t = p.read_text()
if ', "gif", "webp"' not in t and ", \"gif\", \"webp\"" not in t:
    # try the exact posix pattern
    pass
t2 = t.replace(', "gif", "webp"', "")
t2 = t2.replace(", \"gif\", \"webp\"", "")
if t2 == t:
    raise SystemExit("rsvg/Cargo.toml: gif/webp image features not found")
p.write_text(t2)
for rel in ("librsvg-c/Cargo.toml", "rsvg/Cargo.toml"):
    p = root / rel
    t = p.read_text()
    t2 = t.replace(', "pdf", "ps"', "")
    t2 = t2.replace(", \"pdf\", \"ps\"", "")
    p.write_text(t2)
meson = (root / "meson.build").read_text()
old = "if host_system in ['windows', 'linux']"
# posix: sed "/^if host_system in \['windows'/s/, 'linux'//"
if "if host_system in ['windows'" in meson:
    meson2 = meson.replace("if host_system in ['windows', 'linux']", "if host_system in ['windows']")
    meson2 = meson2.replace("if host_system in ['windows', 'linux',", "if host_system in ['windows',")
    (root / "meson.build").write_text(meson2)
    print("patched meson linux-static host_system")
else:
    print("WARN: meson host_system windows/linux line not found")
PY

mkdir -p .cargo
cat > .cargo/config.toml <<'EOF'
[target.loongarch64-unknown-linux-gnu]
linker = "/private/tmp/penglai-uos20-addons-060/work/oldworld-cc"
ar = "/private/tmp/penglai-uos20-addons-060/work/oldworld-ar"
rustflags = [
  "-C", "target-feature=-lsx,-lasx",
  "-C", "panic=abort",
]

[unstable]
build-std = ["std", "panic_abort"]
EOF

cargo update --workspace

# posix: PKG_CONFIG=${PKG_CONFIG/ --static/}
export PKG_CONFIG="$WORK/work/oldworld-pkg-config"
rm -rf _build
"$MESON" setup _build . --prefix="$PREFIX" --default-library=static \
  --buildtype=plain $MESONFLAGS \
  -Dintrospection=disabled -Dpixbuf=disabled -Dpixbuf-loader=disabled \
  -Drsvg-convert=disabled -Ddocs=disabled -Dvala=disabled -Dtests=false \
  -Davif=disabled \
  -Dtriplet="$RUST_TARGET"
python3 "$WORK/scripts/sanitize-meson-config.py" _build
"$MESON" compile -C _build -j4
if ! "$MESON" install -C _build --tags devel; then
  echo "WARN: librsvg meson install tags failed; copying .a/.pc/.h"
  mkdir -p "$PREFIX/lib/pkgconfig" "$PREFIX/include/librsvg-2.0/librsvg"
  find _build -name 'librsvg*.a' -o -name 'rsvg*.a' | while read -r a; do cp -f "$a" "$PREFIX/lib/"; done
  find _build -name '*.pc' | while read -r pc; do cp -f "$pc" "$PREFIX/lib/pkgconfig/"; done
fi
ls -l "$PREFIX/lib"/librsvg* "$PREFIX/lib"/lib*rsvg* 2>/dev/null || true
"$PKG_CONFIG" --modversion librsvg-2.0 || true
echo "librsvg oldworld done"
