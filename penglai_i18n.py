# -*- coding: utf-8 -*-
"""蓬莱向导 i18n — gettext 风格：中文原文即 key，英文缺词回落中文，绝不抛错。

范围刻意做薄（借鉴 Hermes locales 设计）：只覆盖向导/CLI 高频交互文案；
日志、内核输出、报错堆栈保持原语言。语言来源优先级：
set_lang() 显式设置 > PENGLAI_LANG 环境变量 > 中文。
"""
import os

_lang = "en" if os.environ.get("PENGLAI_LANG", "").lower().startswith("en") else "zh"


def set_lang(lang):
    global _lang
    _lang = "en" if str(lang).lower().startswith("en") else "zh"


def get_lang():
    return _lang


def T(zh, **kw):
    """中文原文进，按当前语言出。EN 缺词回落中文；format 失败回落原串。"""
    s = EN.get(zh, zh) if _lang == "en" else zh
    if kw:
        try:
            return s.format(**kw)
        except (KeyError, IndexError):
            return s
    return s


EN = {
    # ---- banner / 公共 ----
    "步骤": "Step",
    "可选": "Optional",
    "蓬 莱 · 个人 AI 管家": "P E N G L A I · Personal AI Butler",
    "（基于 GenericAgent）": " (powered by GenericAgent)",
    "飞书 · 微信 · 记忆 · 多渠道": "Feishu · WeChat · Memory · Multi-channel",
    "八仙过海，各显神通": "Eight Immortals cross the sea, each shows their magic",
    "个人 AI 管家": "Personal AI Butler",
    "（回车={d}）": " (Enter = {d})",
    "重试？(y/n)": "Retry? (y/n)",
    "已取消。随时重新运行 penglai setup": "Cancelled. Run `penglai setup` again anytime.",

    # ---- 步骤 0：语言 ----
    "选择语言 / Language": "Language / 选择语言",
    "1. 中文   2. English": "1. 中文   2. English",
    "选择 / choose": "Choose / 选择",

    # ---- 步骤 1：环境 ----
    "环境自检": "Environment check",
    "需要 Python 3.10+，当前 {v}": "Python 3.10+ required, found {v}",
    "容器环境（依赖已随镜像就绪）": "Container detected (dependencies shipped with the image)",
    "正在创建虚拟环境并安装依赖（清华镜像）...": "Creating virtualenv and installing dependencies...",
    "系统 Python 缺 venv 模块（全新 Ubuntu 常见）。任选一个修法后重试：": "System Python lacks the venv module (common on fresh Ubuntu). Pick one fix and retry:",
    "或用一键脚本（自动装 uv 托管 Python，不动系统）：": "or use the one-line installer (uv-managed Python, system untouched):",
    "依赖安装完成": "Dependencies installed",
    "依赖安装失败，请手动执行后重试: python3 -m venv .venv && .venv/bin/pip install -e . lark-oapi pyyaml": "Dependency install failed. Run manually then retry: python3 -m venv .venv && .venv/bin/pip install -e . lark-oapi pyyaml",
    "虚拟环境已存在": "Virtualenv already present",

    # ---- 步骤 2：LLM ----
    "选择大模型（蓬莱的大脑）": "Choose your LLM (Penglai's brain)",
    "默认 ": "default ",
    "（手动填模型名）": "(enter model name manually)",
    "选择序号": "Pick a number",
    "无效序号，请重选": "Invalid number, try again",
    "API Base URL（如 https://api.example.com/v1）": "API Base URL (e.g. https://api.example.com/v1)",
    "模型名": "Model name",
    "{m} 即将废弃，建议改用 {r}": "{m} is being deprecated, consider {r}",
    "改用 {r}？(y/n)": "Switch to {r}? (y/n)",
    "API Key（粘贴后回车）": "API Key (paste and press Enter)",
    "连通性测试中...": "Testing connectivity...",
    "模型连通": "Model reachable",
    "，回复：{r}": ", reply: {r}",
    "（思考型模型，空文本正常）": " (reasoning model, empty text is normal)",
    "测试失败：{e}": "Test failed: {e}",

    # ---- 步骤 3：渠道 ----
    "接入渠道（你的管家住在哪）": "Channels (where your butler lives)",
    "推荐·已实测·扫码即用": "recommended · battle-tested · scan to go",
    "已实测·扫码登录个人微信": "battle-tested · scan to link personal WeChat",
    "扫码自动建应用·待实测": "QR auto-register · not yet field-tested",
    "贴 token 接入·待实测": "paste a token · not yet field-tested",
    "多选，逗号分隔（如 1,2）。飞书是目前验证闭环最完整的主渠道。": "Multi-select, comma separated (e.g. 1,2). Feishu has the most complete verified loop today.",
    "选择渠道": "Pick channels",
    "未选飞书：跳过飞书配置，启动验证闭环也将跳过（其余渠道为「进程在跑」级报告）": "Feishu not selected: skipping Feishu config; the launch verification loop will also be skipped (other channels report at 'process running' level only)",
    "终端 TUI 无需配置，装完直接敲 penglai 就能聊": "The terminal TUI needs no config — just run `penglai` after setup",

    # ---- 飞书 ----
    "接入飞书": "Connect Feishu",
    "1. 手机飞书扫码，自动创建机器人应用（推荐，免开网页）": "1. Scan with the Feishu app to auto-create the bot (recommended, no browser needed)",
    "2. 手动填入已有的 App ID / App Secret": "2. Enter an existing App ID / App Secret manually",
    "选择方式": "Choose a method",
    "扫码流程异常：{e}": "QR flow error: {e}",
    "凭证验证中...": "Verifying credentials...",
    "应用已创建，凭证有效（App ID: {id}）": "App created, credentials valid (App ID: {id})",
    "自动创建的凭证验证失败：{m}": "Auto-created credentials failed verification: {m}",
    "↓ 回落手动方式": "↓ Falling back to manual entry",
    "App ID（cli_ 开头）": "App ID (starts with cli_)",
    "飞书凭证有效": "Feishu credentials valid",
    "飞书返回错误：{m}（检查是否复制完整）": "Feishu returned an error: {m} (check you copied the whole value)",
    "验证失败：{e}": "Verification failed: {e}",
    "📱 打开手机飞书「扫一扫」，{hint}，确认创建机器人应用": "📱 Open Feishu on your phone, {hint}, and confirm creating the bot app",
    "扫上方二维码": "scan the QR code above",
    "扫码入口见下方链接（电脑浏览器打开后出码）": "open the link below in a desktop browser to show the QR",
    "等待确认": "Waiting for confirmation",
    "已在手机上取消": "Cancelled on the phone",
    "二维码已过期": "QR code expired",
    "等待扫码超时": "Timed out waiting for scan",

    # ---- 微信 ----
    "微信（扫码绑定个人微信，作为第二渠道）": "WeChat (scan to link your personal account as a second channel)",
    "安装微信依赖...": "Installing WeChat dependencies...",
    "依赖安装失败：{e}": "Dependency install failed: {e}",
    "微信依赖就绪（qrcode/pillow/pycryptodome/pilk）": "WeChat dependencies ready (qrcode/pillow/pycryptodome/pilk)",
    "检测到已有微信绑定，重新扫码？(y/n)": "Existing WeChat binding found. Re-scan? (y/n)",
    "沿用现有绑定": "Keeping the existing binding",
    "📱 打开手机微信「扫一扫」，扫终端二维码并确认（图片也存在 ~/.wxbot/wx_qr.png）": "📱 Open WeChat on your phone and scan the QR in the terminal (also saved to ~/.wxbot/wx_qr.png)",
    "扫码未完成（可稍后重跑 penglai setup，只重做本步）": "Scan not completed (re-run `penglai setup` later to redo just this step)",
    "微信绑定成功（token 已存 ~/.wxbot/，重启不用重扫）": "WeChat linked (token saved to ~/.wxbot/, survives restarts)",

    # ---- 步骤 4：起名 ----
    "给你的管家起名": "Name your butler",
    "管家名字": "Butler's name",
    "它怎么称呼你": "What should it call you",
    "主人": "Boss",
    "身份 + 蓬莱SOP索引已写入 L1（每轮注入）": "Identity + Penglai SOP index written to L1 (injected every turn)",

    # ---- 步骤 5：能力面板 ----
    "蓬莱能力（按需开启，立即生效）": "Penglai abilities (enable what you want, takes effect now)",
    "出厂常开（确定性防线，不可关）：": "Always-on (deterministic safety rails, cannot be disabled):",
    "红线审计 · 记忆卫生 · 出站文件白名单": "red-line audit · memory hygiene · outbound file allowlist",
    "语音情绪耳朵（本地 SenseVoice：转写+情绪+声学事件，含微信语音）": "Voice with emotional hearing (local SenseVoice: transcription + emotion + acoustic events, incl. WeChat voice)",
    "约下载 230MB 模型，本地 CPU 推理，零 API 成本。发语音条给管家必需。": "Downloads a ~230MB model, local CPU inference, zero API cost. Required for voice messages.",
    "现在启用语音？(y/n)": "Enable voice now? (y/n)",
    "主动陪伴（会主动关心你，不只是被动回复）": "Proactive companion (reaches out to you, not just replies)",
    "默认不开 → 蓬莱只在你发消息时回应（零成本）。": "Off by default → Penglai only responds when you message it (zero cost).",
    "开启后 → 独立心跳进程，门禁守护（勿扰时段/不打断聊天/频率上限），": "On → independent heartbeat process with gates (quiet hours / never interrupts / rate limit),",
    "         偶尔主动联系你。是蓬莱第一个有持续 token 成本的功能（一天约几分钱）。": "         occasionally reaches out. First feature with ongoing token cost (pennies a day).",
    "现在开启主动陪伴？(y/n)": "Enable proactive companion? (y/n)",
    "主动陪伴已开启（默认勿扰 22-8 点、最短间隔 4 小时；可后续在 mykey.py 调）": "Companion enabled (quiet hours 22-8, min interval 4h; tune later in mykey.py)",
    "情报矩阵（多源交叉验证，降低幻觉）": "Intel matrix (multi-source cross-checking, fewer hallucinations)",
    "默认即可搜网：内置免费 Bing 兜底，无头服务器也能查天气/新闻/事实，开箱即用。": "Search works out of the box: built-in free Bing fallback — queries weather/news/facts even on a headless server.",
    "开启增强 → 再叠加独立搜索 API，多源并查 + 交叉验证，更适合写记忆/做决策。": "Enable enhancement → add independent search APIs on top; multi-source cross-check, better for memory / decisions.",
    "现在开启情报矩阵增强？(y/n)": "Enable the intel matrix? (y/n)",
    "推荐 TinyFish（免费、自有索引）：到 https://agent.tinyfish.ai/api-keys 申请，回车跳过": "TinyFish recommended (free, own index): get a key at https://agent.tinyfish.ai/api-keys, Enter to skip",
    "TinyFish API Key（X-API-Key，可空）": "TinyFish API Key (X-API-Key, optional)",
    "Tavily API Key（免费额度，可空）": "Tavily API Key (free tier, optional)",
    "Firecrawl API Key（可空）": "Firecrawl API Key (optional)",
    "情报矩阵：{n} 个增强源已配置（叠加在免费 Bing 之上）": "Intel matrix: {n} enhanced source(s) configured (on top of free Bing)",
    "未填 key，保持内置免费 Bing 搜索": "No keys entered, keeping the built-in free Bing search",
    "再配一个【不同厂商】的模型，命中时交叉复核——单模型查不出自己的幻觉。": "Add a model from another vendor; on a trip-wire hit it cross-checks — a model can't catch its own hallucination.",
    "从下面整张厂商目录任选（免费如智谱 GLM-4.7-Flash，也可投入更强的付费模型，视差更大）：": "Pick any from the full provider catalog below (free ones like Zhipu GLM-4.7-Flash, or invest in a stronger paid model for wider parallax):",
    "批判脑 smart 档已配置（{n} / {m}）": "Critic (smart) configured ({n} / {m})",
    "已跳过/未完成。稍后一条命令可开：penglai enable critic": "Skipped / not completed. Enable later with one command: penglai enable critic",
    "  ← 与主力同厂商，复核视差小": "  ← same vendor as main model, little review parallax",

    # ---- 语音安装 ----
    "安装语音识别引擎 sherpa-onnx ...": "Installing speech engine sherpa-onnx ...",
    "sherpa-onnx 安装失败：{e}": "sherpa-onnx install failed: {e}",
    "sherpa-onnx 就绪": "sherpa-onnx ready",
    "缺 ffmpeg（音频解码必需）。现在用 apt 安装？(y/n)": "ffmpeg missing (required for audio decode). Install via apt now? (y/n)",
    "请自行安装 ffmpeg 后语音即可用（Ubuntu: sudo apt install -y ffmpeg / macOS: brew install ffmpeg）": "Install ffmpeg yourself and voice will work (Ubuntu: sudo apt install -y ffmpeg / macOS: brew install ffmpeg)",
    "ffmpeg 就绪": "ffmpeg ready",
    "下载 SenseVoice 模型（约 230MB，国内自动走镜像）...": "Downloading the SenseVoice model (~230MB, mirror used in China)...",
    "模型已存在，跳过下载": "Model already present, skipping download",
    "下载失败：{e}": "Download failed: {e}",
    "解压中...": "Extracting...",
    "语音就绪：转写 + 情绪 + 声学事件（飞书/微信语音条开箱即用）": "Voice ready: transcription + emotion + acoustic events (Feishu/WeChat voice messages work out of the box)",
    "语音未就绪（见上方原因），稍后可重跑 penglai setup 补装": "Voice NOT ready (see above); re-run `penglai setup` later to finish",

    # ---- 写配置 ----
    "写入配置 mykey.py": "Writing mykey.py",
    "已备份旧配置 → {b}": "Old config backed up → {b}",
    "配置完成（权限 600，已加入 .gitignore 范围）": "Config written (mode 600, covered by .gitignore)",

    # ---- 启动验证 ----
    "启动并验证": "Launch & verify",
    "容器模式：配置完成。容器守护每 30 秒巡检，新配置的渠道自动拉起（无需重启容器）": "Container mode: config done. The container supervisor re-scans every 30s and auto-starts newly configured channels (no restart needed)",
    "安装为系统服务（开机自启）？(y/n)": "Install as system services (start on boot)? (y/n)",
    "服务已安装并设为开机自启，开始验证...": "Services installed and enabled, verifying...",
    "服务安装失败（sudo 权限？），可手动前台运行: .venv/bin/python frontends/fsapp.py": "Service install failed (sudo?). Run manually: .venv/bin/python frontends/fsapp.py",
    "无系统服务模式：现在后台启动飞书进程并实测？(y/n)": "No-systemd mode: start the Feishu process in the background and verify now? (y/n)",
    "未启动。稍后手动: penglai start（日志: penglai logs）": "Not started. Later: penglai start (logs: penglai logs)",
    "飞书进程已后台启动（停止: penglai stop，日志: penglai logs）": "Feishu process started in background (stop: penglai stop, logs: penglai logs)",
    "等待飞书长连接建立": "Waiting for the Feishu long connection",
    "45 秒内未建立连接，最近日志（完整: {h}）：": "No connection within 45s. Recent log (full: {h}):",
    "飞书长连接已建立（日志确认 connected）": "Feishu long connection established (log shows connected)",
    "📨 实测收发：用手机飞书给机器人发一句「你好」（回车跳过，最长等 3 分钟）": "📨 Live test: send the bot a hello from your phone's Feishu (Enter to skip, waits up to 3 min)",
    "已收到你的消息，收发链路实测全通": "Got your message — the full loop is verified",
    "已跳过实测，链路尚未端到端验证": "Live test skipped; the loop is NOT verified end-to-end yet",
    "3 分钟内未收到消息。常见原因：发错了机器人 / 应用版本未发布 / 可见范围不含你": "No message within 3 min. Common causes: wrong bot / app version unpublished / visibility excludes you",
    "日志：{h}": "Log: {h}",
    "已自动把你（{o}）设为唯一授权用户，机器人不再对所有可见用户开放": "You ({o}) are now the only authorized user; the bot is no longer open to everyone",
    "正在重启服务让白名单生效...": "Restarting the service to apply the allowlist...",
    "正在重启飞书进程让白名单生效...": "Restarting the Feishu process to apply the allowlist...",
    "未选飞书渠道：跳过飞书启动验证": "Feishu not selected: skipping its launch verification",
    "陪伴服务已启动（systemd: penglai-companion）": "Companion service running (systemd: penglai-companion)",
    "陪伴服务未在运行，请检查: systemctl status penglai-companion": "Companion service NOT running, check: systemctl status penglai-companion",

    # ---- 附加渠道 ----
    "配置附加渠道": "Configure extra channels",
    "开始配置 {l}（扫码/凭证流程来自渠道矩阵）": "Configuring {l} (QR/credential flow from the channel matrix)",
    "附加渠道配置完成。状态总览: penglai channels": "Extra channels configured. Overview: penglai channels",

    # ---- 总结 ----
    "🎉 安装完成，飞书收发链路已实测全通！": "🎉 Setup complete — the Feishu loop is live-verified!",
    "配置完成。容器守护将在 30 秒内拉起已配置的渠道并可在日志取证（docker logs -f penglai）。": "Config done. The container supervisor will start configured channels within 30s; verify via docker logs -f penglai.",
    "安装完成（链路未实测）。去飞书给「{a}」发一句「你好」，用 penglai logs 看到「收到消息」即全通。": "Setup complete (loop not live-verified). Message \"{a}\" on Feishu and check `penglai logs` for an incoming message.",
    "配置已写入，但飞书链路验证未通过 —— 按上方提示排查后运行 penglai doctor 复检。": "Config written, but Feishu verification failed — follow the hints above, then run `penglai doctor`.",
    "安装完成。已配置渠道见上；终端随时可聊。": "Setup complete. Channels as configured above; the terminal TUI is always available.",
    "现在就可以和「{a}」聊天了：": "You can talk to \"{a}\" now:",
    "💬 飞书（或已绑定的微信）里直接发消息": "💬 Message it on Feishu (or linked WeChat)",
    "⌨️  终端任意位置输入 penglai 进入命令行对话（同一个管家，同一份记忆）": "⌨️  Type `penglai` anywhere in a terminal (same butler, same memory)",
    "体检: penglai doctor   日志: penglai logs   更新: penglai update": "Health: penglai doctor   Logs: penglai logs   Update: penglai update",
    "（若提示 command not found：重开终端，或先用 ./penglai）": "(If command not found: reopen the terminal, or use ./penglai)",
}
