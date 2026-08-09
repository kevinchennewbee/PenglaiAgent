#!/bin/sh
# 蓬莱 · Penglai 0.4 Host 安装脚本 (Linux/macOS)
#
# 安装 TS Host(不是 Tauri 桌面):检查 Node -> npm install -> 构建运行时 ->
# 创建 ~/.penglai -> 安装 penglai 命令到 PATH。
#
# 用法:
#   sh packages/host/scripts/install.sh
#
# 可选环境变量:
#   PENGLAI_DIR     数据目录 (默认 ~/.penglai)
#   PENGLAI_PREFIX  安装前缀 (默认 ~/.local)
set -e

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
# scripts -> host -> packages -> repo root
REPO_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/../../.." && pwd)
HOST_PKG="$REPO_ROOT/packages/host"

PENGLAI_DIR="${PENGLAI_DIR:-$HOME/.penglai}"
PENGLAI_PREFIX="${PENGLAI_PREFIX:-$HOME/.local}"
BIN_DIR="$PENGLAI_PREFIX/bin"
NEED_NODE=22
BUILD_LOG="${TMPDIR:-/tmp}/penglai-host-build.log"

say() { printf '%s\n' "$1"; }
die() { printf '❌ %s\n' "$1" >&2; exit 1; }

say "🏮 蓬莱 · Penglai 0.4 Host 安装 (Linux/macOS)"
say "   repo: $REPO_ROOT"

# 1. Node >= 22. Installation stays owner-managed: piping a remote bootstrap
# into a shell would bypass this repository's pinned supply chain.
have_node() {
  command -v node >/dev/null 2>&1 || return 1
  node -e "process.exit(Number(process.versions.node.split('.')[0]) >= $NEED_NODE ? 0 : 1)" 2>/dev/null
}
have_node || die "需要 Node.js >= $NEED_NODE。请先从 https://nodejs.org/ 安装官方版本，或自行使用已信任的版本管理器。"
say "✓ Node.js $(node -v)"

# 2. npm install (workspace: protocol + host)
cd "$REPO_ROOT" || die "无法进入仓库目录"
if [ -f package-lock.json ]; then
  say "npm ci ..."
  npm ci
else
  say "npm install ..."
  npm install
fi

# 3. Build the production runtime. An installer must not report success after
# silently falling back to a source/development execution path.
RUNTIME_JS="$HOST_PKG/dist-runtime/src/cli.js"
node "$HOST_PKG/scripts/build-runtime.mjs" >"$BUILD_LOG" 2>&1 || die "生产运行时构建失败；日志: $BUILD_LOG"
[ -f "$RUNTIME_JS" ] || die "生产运行时缺少入口: $RUNTIME_JS"
say "✓ 预构建运行时: $HOST_PKG/dist-runtime"

# 4. data directory
mkdir -p "$PENGLAI_DIR"
say "✓ 数据目录: $PENGLAI_DIR"

# 5. Canonical launcher plus a compatibility alias -> BIN_DIR
mkdir -p "$BIN_DIR"
cat > "$BIN_DIR/penglai" <<EOF
#!/bin/sh
# Penglai 0.4 Host launcher (prebuilt runtime)
exec node "$RUNTIME_JS" "\$@"
EOF
chmod +x "$BIN_DIR/penglai"
cp "$BIN_DIR/penglai" "$BIN_DIR/penglai-host"
chmod +x "$BIN_DIR/penglai-host"
say "✓ 启动器: $BIN_DIR/penglai"
say "✓ 兼容入口: $BIN_DIR/penglai-host"

# 6. ensure BIN_DIR on PATH (best-effort, non-fatal)
add_to_rc() {
  rc="$1"
  [ -f "$rc" ] || return 0
  grep -q "$BIN_DIR" "$rc" 2>/dev/null && return 0
  # Write literal $PATH for the next shell.
  # shellcheck disable=SC2016
  printf '\n# Penglai 0.4 Host\nexport PATH="%s:$PATH"\n' "$BIN_DIR" >> "$rc"
  say "✓ 已添加到 $rc (新终端生效)"
}
add_to_rc "$HOME/.bashrc" || true
add_to_rc "$HOME/.zshrc" || true
add_to_rc "$HOME/.profile" || true

say ""
say "✅ 安装完成。"
say "   启动:  penglai serve --port 14169"
say "   若提示命令未找到,运行: export PATH=\"$BIN_DIR:\$PATH\""
say "   Web UI: http://127.0.0.1:14169"
say "   数据/会话: $PENGLAI_DIR"
