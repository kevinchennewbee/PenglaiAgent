#!/bin/sh
# 蓬莱容器入口:把可变状态全部锚到 /data 卷,镜像保持无状态可升级。
#   无参数: 未配置 → 交互向导;已配置 → 前台跑飞书 + 后台调度器(容器即服务)
#   有参数: 透传给 penglai CLI(setup / doctor / logs ...)
set -e
D=/data
mkdir -p "$D/temp" "$D/workspace" "$D/wxbot"

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

python /app/agentmain.py --reflect /app/reflect/scheduler.py &
exec python /app/frontends/fsapp.py
