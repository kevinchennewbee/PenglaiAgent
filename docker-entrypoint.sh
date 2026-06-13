#!/bin/sh
# 蓬莱容器入口:把可变状态全部锚到 /data 卷,镜像保持无状态可升级。
#   无参数: 未配置 → 交互向导;已配置 → 前台跑飞书 + 后台调度器(容器即服务)
#   有参数: 透传给 penglai CLI(setup / doctor / logs ...)
set -e
D=/data
mkdir -p "$D/temp" "$D/workspace" "$D/wxbot" "$D/penglai-models"

# 首次启动:把镜像自带的记忆(SOP 包)播种到卷;此后卷为准,升级镜像不覆盖你的记忆
if [ ! -d "$D/memory" ]; then
    cp -a /app/memory "$D/memory.seed" && mv "$D/memory.seed" "$D/memory"
fi
rm -rf /app/memory /app/temp
ln -s "$D/memory" /app/memory
ln -s "$D/temp"   /app/temp
ln -sf "$D/mykey.py" /app/mykey.py
ln -snf "$D/wxbot" /root/.wxbot

if [ "$#" -gt 0 ]; then
    exec python /app/penglai "$@"
fi

if [ ! -s "$D/mykey.py" ]; then
    echo "🏮 首次启动,进入安装向导(需要 -it 交互终端)..."
    exec python /app/penglai setup
fi

# 安全插件未挂载就拒绝启动（F-011：别让 agent 无防护裸奔；设 PENGLAI_ALLOW_UNGUARDED=1 可强制）
if [ "${PENGLAI_ALLOW_UNGUARDED:-0}" != "1" ]; then
    python /app/penglai _guardcheck \
        || { echo "❌ 安全插件未挂载，拒绝启动（PENGLAI_ALLOW_UNGUARDED=1 可强制，危险）"; exit 2; }
fi

# ── 常驻监工循环（真实用户实测教训:渠道配置不是只在容器启动时出现）──
# 旧逻辑在启动那一刻一次性决定启动什么,导致:扫码比向导慢半拍/docker exec 手动跑向导/
# 事后 penglai enable,新出现的 token/凭证永远没人拉起。改为每 30 秒巡检:
# 该跑没跑的拉起(含进程意外退出后的自愈),什么都没配置就提示一次并继续守着。
set +e   # 巡检循环里单个组件失败不能放倒 PID1

has_fs() { python -c "import sys; sys.path.insert(0,'/app'); import mykey; print(1 if getattr(mykey,'fs_app_id','') and getattr(mykey,'fs_app_secret','') else 0)" 2>/dev/null || echo 0; }
has_cp() { python -c "import sys; sys.path.insert(0,'/app'); import mykey; print(1 if getattr(mykey,'companion_enabled',False) else 0)" 2>/dev/null || echo 0; }
alive()  { pgrep -f "$1" >/dev/null 2>&1; }

HINTED=0
echo "🏮 蓬莱容器守护启动(每30秒巡检渠道配置与进程,新扫码/新配置无需重启容器)"
while :; do
    alive "reflect/scheduler[.]py" \
        || { echo "▶ 启动调度器"; python /app/agentmain.py --reflect /app/reflect/scheduler.py & }
    if [ "$(has_cp)" = "1" ]; then
        alive "reflect/penglai_companion[.]py" \
            || { echo "▶ 启动主动陪伴"; python /app/agentmain.py --reflect /app/reflect/penglai_companion.py & }
    fi
    FS_OK=$(has_fs); WX_OK=0
    [ -s "$D/wxbot/token.json" ] && WX_OK=1
    if [ "$FS_OK" = "1" ] && ! alive "frontends/fsapp[.]py"; then
        echo "▶ 启动飞书前端"; python /app/frontends/fsapp.py &
    fi
    # 微信走 penglai_im_launch 包装器:记录主人 uid 供主动陪伴投递,行为与直跑 wechatapp 一致
    if [ "$WX_OK" = "1" ] && ! alive "penglai_im_launch[.]py wechat"; then
        echo "▶ 启动微信前端"; python /app/penglai_im_launch.py wechat &
    fi
    if [ "$FS_OK" != "1" ] && [ "$WX_OK" != "1" ] && [ "$HINTED" = "0" ]; then
        echo "⚠️ 暂无已配置的 IM 渠道(飞书凭证未填、微信未绑定)。"
        echo "   补配: docker exec -it penglai penglai setup"
        echo "   扫码/填好后【无需重启容器】,30 秒内自动拉起对应渠道。"
        HINTED=1
    fi
    sleep 30
done
