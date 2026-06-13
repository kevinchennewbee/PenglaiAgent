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

# 按已配置的渠道决定启动哪个前端,不写死飞书(issue #1:只配微信时 fsapp 报错退出→无限重启)
FS_OK=$(python -c "import sys; sys.path.insert(0,'/app'); import mykey; print(1 if getattr(mykey,'fs_app_id','') and getattr(mykey,'fs_app_secret','') else 0)" 2>/dev/null || echo 0)
WX_OK=0
[ -s "$D/wxbot/token.json" ] && WX_OK=1

python /app/agentmain.py --reflect /app/reflect/scheduler.py &

if [ "$FS_OK" = "1" ]; then
    [ "$WX_OK" = "1" ] && python /app/frontends/wechatapp.py &
    exec python /app/frontends/fsapp.py
elif [ "$WX_OK" = "1" ]; then
    echo "ℹ️ 未配置飞书,以微信为主渠道启动"
    exec python /app/frontends/wechatapp.py
else
    echo "⚠️ 未检测到任何已配置的 IM 渠道(飞书凭证未填、微信未绑定)。"
    echo "   补配渠道: docker exec -it penglai /app/docker-entrypoint.sh setup"
    echo "   体检:     docker exec -it penglai /app/docker-entrypoint.sh doctor"
    echo "   容器保持运行,不再反复重启刷错误日志。"
    exec tail -f /dev/null
fi
