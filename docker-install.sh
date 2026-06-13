#!/bin/sh
# 蓬莱 · Penglai — Docker 一键部署:
#   curl -fsSL https://raw.githubusercontent.com/kevinchennewbee/PenglaiAgent/main/docker-install.sh | sh
# 自动完成:取镜像(GHCR → 国内镜像站 → 本地构建三级兜底) → 交互向导 → 常驻容器(开机自启) → 连接验证
set -e

IMG="ghcr.io/kevinchennewbee/penglai:latest"
IMG_CN="ghcr.nju.edu.cn/kevinchennewbee/penglai:latest"
OWNER_REPO="${PENGLAI_REPO:-kevinchennewbee/PenglaiAgent}"
PROXY="https://gh-proxy.com/"
NAME="penglai"
VOL="penglai-data"

say() { printf '%s\n' "$1"; }
die() { printf '❌ %s\n' "$1" >&2; exit 1; }

say "🏮 蓬莱 · Penglai — Docker 一键部署"
command -v docker >/dev/null || die "需要 Docker。一行安装: curl -fsSL https://get.docker.com | sh"
docker info >/dev/null 2>&1 || die "Docker 守护进程未运行(或当前用户无权限,试试 sudo,或把用户加入 docker 组)"

# ── 1. 网络探测 ───────────────────────────────────────────────────────────────
MIRROR=""
curl -fsSL -m 6 -o /dev/null "https://github.com" 2>/dev/null || MIRROR="$PROXY"
[ -n "$MIRROR" ] && say "  🇨🇳 GitHub 直连受限,自动启用国内镜像路径"

# ── 2. 取镜像:GHCR → 国内镜像站 → 从源码本地构建 ────────────────────────────
get_image() {
    if [ -z "$MIRROR" ] && docker pull "$IMG" 2>/dev/null; then
        return 0
    fi
    say "  尝试国内镜像站..."
    if docker pull "$IMG_CN" 2>/dev/null; then
        docker tag "$IMG_CN" "$IMG"; return 0
    fi
    say "  📦 镜像站不可达,改为从源码本地构建(约 2-5 分钟,只需一次)..."
    BUILD_DIR="$(mktemp -d)"
    curl -fsSL "${MIRROR}https://github.com/$OWNER_REPO/archive/refs/heads/main.tar.gz" \
        | tar -xz -C "$BUILD_DIR" --strip-components=1
    PIP_IDX="https://pypi.org/simple"
    [ -n "$MIRROR" ] && PIP_IDX="https://pypi.tuna.tsinghua.edu.cn/simple"
    docker build -q --build-arg PIP_INDEX="$PIP_IDX" -t "$IMG" "$BUILD_DIR"
    rm -rf "$BUILD_DIR"
}
get_image || die "镜像获取失败,请检查网络后重试"
say "  ✅ 镜像就绪"

# ── 3. 首次配置:交互向导(配置写入 $VOL 卷,容器删了也不丢) ─────────────────
docker volume create "$VOL" >/dev/null
if ! docker run --rm -v "$VOL:/data" --entrypoint sh "$IMG" -c 'test -s /data/mykey.py'; then
    # curl|sh 下 stdin 是脚本管道,向导 input() 会读到 EOF 而中断。
    # 改接真实终端 /dev/tty(install.sh 同款修法);无终端则给可操作提示,不让向导空跑崩溃。
    if [ -t 0 ]; then
        docker run -it --rm -v "$VOL:/data" "$IMG" setup \
            || die "向导未完成。重跑本命令可从断点继续(已验证的配置不用重填)"
    elif (: </dev/tty) 2>/dev/null; then
        docker run -it --rm -v "$VOL:/data" "$IMG" setup </dev/tty \
            || die "向导未完成。重跑本命令可从断点继续(已验证的配置不用重填)"
    else
        die "安装向导需要交互终端。请改为【下载后运行】: curl -fsSLO ${MIRROR}https://raw.githubusercontent.com/$OWNER_REPO/main/docker-install.sh && sh docker-install.sh"
    fi
fi

# ── 4. 常驻服务:开机自启,挂了自动拉起 ──────────────────────────────────────
docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --restart unless-stopped -v "$VOL:/data" "$IMG" >/dev/null
say "  ⏳ 服务已启动,等待 IM 渠道连接建立..."

# ── 5. 验证:按实际配置的渠道取证(飞书=connected to wss / 微信=WeChat Bot 已启动) ──
n=0
while [ $n -lt 30 ]; do
    LOGS=$(docker logs "$NAME" 2>&1)
    OKCH=""
    printf '%s' "$LOGS" | grep -q "connected to wss"   && OKCH="飞书"
    printf '%s' "$LOGS" | grep -q "WeChat Bot 已启动"  && OKCH="${OKCH:+$OKCH + }微信"
    if [ -n "$OKCH" ]; then
        say "  ✅ ${OKCH} 连接已建立(日志确认)"
        say ""
        say "🎉 部署完成!去${OKCH}给机器人发一句「你好」,然后:"
        say "   看日志: docker logs -f $NAME    (出现「收到消息」即收发全通)"
        say "   重启:   docker restart $NAME    停止: docker stop $NAME"
        say "   补配渠道: docker exec -it penglai penglai setup  (扫码后无需重启,30秒内自动拉起)"
        say "   升级:   重跑本安装命令即可(数据在 $VOL 卷,不会丢)"
        exit 0
    fi
    sleep 2; n=$((n+1))
done
say "  ⚠️  60 秒内未见任何渠道连接成功,最近日志:"
docker logs --tail 10 "$NAME" 2>&1 | sed 's/^/    /'
say "  若刚才向导里跳过了扫码:补跑 docker exec -it penglai penglai setup,完成后 30 秒内自动拉起"
say "  其他排查后可: docker restart $NAME && docker logs -f $NAME"
exit 1
