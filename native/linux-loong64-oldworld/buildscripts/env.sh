# shellcheck shell=bash
# Isolated UOS20 old-world build environment. Do not write outside WORK.
export WORK="${WORK:-/tmp/penglai-uos20-oldworld-build}"
export ZIG_GLOBAL_CACHE_DIR="$WORK/cache/zig-global"
export ZIG_LOCAL_CACHE_DIR="$WORK/cache/zig-local"
export npm_config_cache="$WORK/npm-cache"
export npm_config_update_notifier=false
export npm_config_fund=false
mkdir -p "$ZIG_GLOBAL_CACHE_DIR" "$ZIG_LOCAL_CACHE_DIR" "$WORK/work" "$WORK/deliverables" "$WORK/cache"

export SYSROOT="$WORK/inputs/toolchain/sysroot"
export GCCLIB="$WORK/inputs/toolchain/gcc-lib"
export LINKROOT="$WORK/work/linkroot"
export ELECTRON_NODE_INC="$WORK/inputs/electron-31.7.7-node_headers/include/node"
: "${ZIG:?set ZIG to a Zig 0.16 binary}"
export ZIG
export ZIG_TARGET=loongarch64-linux-gnu.2.28
# Do not export TARGET= — autotools (libffi) treats $TARGET as a builddir.
export OLD_INTERP=/lib64/ld.so.1
export NEW_INTERP=/lib64/ld-linux-loongarch-lp64d.so.1
