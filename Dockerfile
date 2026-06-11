# 蓬莱 · Penglai — 容器镜像
#   docker build -t penglai .                                  # 国际网络
#   docker build --build-arg PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple -t penglai .   # 国内
# 数据(mykey.py/记忆/temp/微信token)全部落在 /data 卷,镜像升级不丢。
FROM python:3.11-slim
ARG PIP_INDEX=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
# 核心依赖:装失败必须让构建失败 —— 否则 || 兜底会吞掉核心失败,CI 仍发布跑不起来的镜像
RUN pip install --no-cache-dir -i "$PIP_INDEX" -e . lark-oapi qrcode pyyaml
# 构建期 import 冒烟:双架构构建都会执行,核心链路装坏则镜像构建直接失败(发布门禁)
RUN python -c "import requests, bs4, aiohttp, bottle, lark_oapi, qrcode, yaml"
# 微信/语音附加依赖:可选,装失败只禁用对应功能,不阻断构建(独立 RUN,失败不影响上面)
RUN pip install --no-cache-dir -i "$PIP_INDEX" pillow pycryptodome pilk \
    || echo "微信语音附加依赖跳过(不影响飞书主链路)"

ENV PENGLAI_DOCKER=1 \
    GA_WORKSPACE_ROOT=/data/workspace \
    PYTHONUNBUFFERED=1

VOLUME /data
ENTRYPOINT ["/app/docker-entrypoint.sh"]
