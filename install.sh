#!/bin/sh
# 蓬莱 · Penglai 一键安装 —— 新机器只需联网:
#   curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/install.sh | sh
# 自动完成:网络探测(国内走镜像) → 取代码(无 git 走压缩包) → 备好 Python(无则装 uv 托管版)
#   → 装依赖 → 进入向导。用户不需要预装任何东西,也不需要懂环境配置。
set -e

OWNER_REPO="${PENGLAI_REPO:-kevinchennewbee/PenglaiAgent}"
TARGET="${PENGLAI_DIR:-$HOME/PenglaiAgent}"
GH="https://github.com/$OWNER_REPO"
PROXY="https://gh-proxy.com/"
UV_BIN="$HOME/.local/bin/uv"

say()  { printf '%s\n' "$1"; }
die()  { printf '❌ %s\n' "$1" >&2; exit 1; }

say "🏮 蓬莱 · Penglai — 住在你飞书和微信里的中文 AI 管家"
command -v curl >/dev/null || die "需要 curl(macOS/多数 Linux 自带)。Ubuntu: apt install -y curl"

# ── 1. 网络探测:GitHub 直连不通则全程走 gh-proxy 镜像 ────────────────────────
MIRROR=""
if ! curl -fsSL -m 6 -o /dev/null "https://github.com" 2>/dev/null; then
    MIRROR="$PROXY"
    say "  🇨🇳 检测到 GitHub 直连受限,自动启用 gh-proxy 镜像"
fi

# ── 2. 取代码:有 git 用 git(日后 penglai update 可用),没有走 tarball ─────────
if [ -f "$TARGET/penglai" ] && [ -f "$TARGET/agent_loop.py" ]; then
    say "  ✅ 发行版已存在:$TARGET"
elif [ -e "$TARGET" ] && [ -n "$(ls -A "$TARGET" 2>/dev/null)" ]; then
    die "目录 $TARGET 非空且不是蓬莱发行版。设 PENGLAI_DIR=其他目录 后重试"
else
    say "  ⬇️  正在获取蓬莱发行版..."
    if command -v git >/dev/null; then
        git clone --depth 1 "${MIRROR}${GH}.git" "$TARGET"
    else
        say "  （未检测到 git,改用压缩包下载;日后升级请先安装 git）"
        mkdir -p "$TARGET"
        curl -fsSL "${MIRROR}${GH}/archive/refs/heads/main.tar.gz" \
            | tar -xz -C "$TARGET" --strip-components=1
    fi
fi
cd "$TARGET"

# ── 3. Python:系统有 3.10+ 直接用;没有就装 uv,由 uv 托管一个独立 Python ──────
PY=""
for c in python3 python3.12 python3.11 python3.10; do
    # 版本 ≥3.10 且 venv 可用(裸 Ubuntu 的 python3 没装 python3-venv,ensurepip 缺失)
    if command -v "$c" >/dev/null 2>&1 \
       && "$c" -c 'import sys, ensurepip; sys.exit(0 if sys.version_info >= (3,10) else 1)' 2>/dev/null; then
        PY="$c"; break
    fi
done
if [ -z "$PY" ]; then
    say "  🐍 未找到 Python 3.10+,自动安装 uv 托管版(不动系统,只装到你的用户目录)..."
    if [ ! -x "$UV_BIN" ] && ! command -v uv >/dev/null; then
        if [ -n "$MIRROR" ]; then
            # 镜像直取 uv 二进制(官方安装脚本的下载源在 GitHub,国内不可达)
            case "$(uname -sm)" in
                "Darwin arm64")  UV_TRIPLE="aarch64-apple-darwin" ;;
                "Darwin x86_64") UV_TRIPLE="x86_64-apple-darwin" ;;
                "Linux aarch64") UV_TRIPLE="aarch64-unknown-linux-gnu" ;;
                *)               UV_TRIPLE="x86_64-unknown-linux-gnu" ;;
            esac
            mkdir -p "$HOME/.local/bin"
            curl -fsSL "${PROXY}https://github.com/astral-sh/uv/releases/latest/download/uv-${UV_TRIPLE}.tar.gz" \
                | tar -xz -C "$HOME/.local/bin" --strip-components=1
        else
            curl -fsSL https://astral.sh/uv/install.sh | sh >/dev/null
        fi
    fi
    command -v uv >/dev/null || PATH="$HOME/.local/bin:$PATH"
    command -v uv >/dev/null || die "uv 安装失败,请手动安装 Python 3.10+ 后重试"
    [ -n "$MIRROR" ] && export UV_PYTHON_INSTALL_MIRROR="${PROXY}https://github.com/astral-sh/python-build-standalone/releases/download"
    uv venv .venv --python 3.11 --quiet
    say "  📦 正在安装依赖..."
    if [ -n "$MIRROR" ]; then
        uv pip install --python .venv/bin/python --quiet \
            -i https://pypi.tuna.tsinghua.edu.cn/simple -e . lark-oapi qrcode pyyaml
    else
        uv pip install --python .venv/bin/python --quiet -e . lark-oapi qrcode pyyaml
    fi
    PY=".venv/bin/python"
    say "  ✅ Python 环境就绪(uv 托管,卸载=删除目录,零残留)"
else
    say "  ✅ 检测到 $($PY --version 2>&1)(依赖由向导自动安装)"
fi

# ── 4. 进入向导 ──────────────────────────────────────────────────────────────
say ""
say "✅ 发行版就绪:$TARGET"
say "   进入安装向导(模型 → 飞书 → 可选微信扫码)..."
say ""
# curl|sh 模式下 stdin 是脚本管道,向导的交互必须改接终端(/dev/tty)
if [ ! -t 0 ] && (: </dev/tty) 2>/dev/null; then
    exec "$PY" penglai setup </dev/tty
fi
exec "$PY" penglai setup
