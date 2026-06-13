# 蓬莱 · Penglai — 容器镜像
#   docker build -t penglai .                                  # 国际网络
#   docker build --build-arg PIP_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple -t penglai .   # 国内
# 数据(mykey.py/记忆/temp/微信token)全部落在 /data 卷,镜像升级不丢。
FROM python:3.11-slim
ARG PIP_INDEX=https://pypi.org/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates procps ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .
# 核心依赖:装失败必须让构建失败 —— 否则 || 兜底会吞掉核心失败,CI 仍发布跑不起来的镜像
# pillow/pycryptodome 升为核心:微信扫码二维码与 secret 解密依赖它们,缺了向导扫码直接崩(issue #1)
RUN pip install --no-cache-dir -i "$PIP_INDEX" -e . lark-oapi qrcode pyyaml pillow pycryptodome
# 构建期 import 冒烟:双架构构建都会执行,核心链路装坏则镜像构建直接失败(发布门禁)
RUN python -c "import requests, bs4, aiohttp, bottle, lark_oapi, qrcode, yaml, PIL, Crypto"
# 语音附加依赖:可选,装失败只禁用语音功能,不阻断构建;各自独立 RUN,一个失败不连坐另一个
RUN pip install --no-cache-dir -i "$PIP_INDEX" pilk \
    || echo "pilk 跳过(仅影响微信语音条解码)"
RUN pip install --no-cache-dir -i "$PIP_INDEX" sherpa-onnx \
    || echo "sherpa-onnx 跳过(仅影响语音转写,可后续 penglai enable voice)"
# penglai 入 PATH:docker exec 进来直接敲 penglai,不用 ./penglai(真实用户实测反馈)
RUN chmod +x /app/penglai && ln -s /app/penglai /usr/local/bin/penglai

ENV PENGLAI_DOCKER=1 \
    GA_WORKSPACE_ROOT=/data/workspace \
    PENGLAI_MODEL_DIR=/data/penglai-models \
    PYTHONUNBUFFERED=1

VOLUME /data
ENTRYPOINT ["/app/docker-entrypoint.sh"]
