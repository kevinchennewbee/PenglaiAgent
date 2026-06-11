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
RUN pip install --no-cache-dir -i "$PIP_INDEX" -e . lark-oapi qrcode pyyaml \
    && pip install --no-cache-dir -i "$PIP_INDEX" pillow pycryptodome pilk \
       || echo "微信语音附加依赖跳过(不影响飞书主链路)"

ENV PENGLAI_DOCKER=1 \
    GA_WORKSPACE_ROOT=/data/workspace \
    PYTHONUNBUFFERED=1

VOLUME /data
ENTRYPOINT ["/app/docker-entrypoint.sh"]
