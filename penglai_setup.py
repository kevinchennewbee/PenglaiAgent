#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""蓬莱安装向导（penglai setup）— 目标：10 分钟从裸机到 IM 里说上话。

纯标准库实现（venv 建立之前也能运行）。流程（v2 翻页式）：
  语言 → 环境自检 → LLM（预设+真实连通测试）→ 渠道单页选择（飞书/微信/钉钉/QQ/TG/DC/企微）
  → 起名 → 能力面板（语音默认开/陪伴/情报矩阵，选了就真装真启）→ 写 mykey.py → 启动并验证
原则：
  · 身份与记忆分离 — 只在出厂态种入身份，绝不覆盖已有用户记忆
  · 诚实纪律 — 只报告可证实的事实，「进程在跑」≠「已连通」
  · 翻页式 UX — tty 下每步清屏如新页面（参考 Hermes alternate-screen 思路的 stdlib 等价）；
    非 tty/NO_COLOR 自动降级为顺序输出
"""
import os, sys, json, time, shutil, subprocess, unicodedata, urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
from penglai_i18n import T, set_lang, get_lang  # noqa: E402

OK, BAD, WARN, T_ICON = "✅", "❌", "⚠️ ", "🏮"

# ---------- 水墨终端样式（256色，macOS Terminal 也安全；非 tty/NO_COLOR 自动降级纯文本） ----------
_COLOR = (os.environ.get("NO_COLOR") is None and os.environ.get("TERM") != "dumb"
          and sys.stdout.isatty())
F = "38;5;{}".format     # 前景色
G = "48;5;{}".format     # 背景色
BOLD = "1"

def c(text, *codes):
    if not _COLOR or not codes:
        return str(text)
    return "".join(f"\033[{x}m" for x in codes) + str(text) + "\033[0m"

def _w(s):
    """CJK 感知显示宽度（全角算 2 列），表格对齐用。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WF" else 1 for ch in s)

def _pad(s, width):
    return s + " " * max(0, width - _w(s))

_LOGO = (
    "██████╗ ███████╗███╗   ██╗ ██████╗ ██╗      █████╗ ██╗",
    "██╔══██╗██╔════╝████╗  ██║██╔════╝ ██║     ██╔══██╗██║",
    "██████╔╝█████╗  ██╔██╗ ██║██║  ███╗██║     ███████║██║",
    "██╔═══╝ ██╔══╝  ██║╚██╗██║██║   ██║██║     ██╔══██║██║",
    "██║     ███████╗██║ ╚████║╚██████╔╝███████╗██║  ██║██║",
    "╚═╝     ╚══════╝╚═╝  ╚═══╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝",
)
_INK = (152, 110, 67, 60, 59, 238)   # 水墨渐变：雾青 → 黛蓝 → 浓墨

def print_banner():
    seal = {1: " 蓬 ", 2: " 萊 "}    # 朱砂印章，落在画面右上（落款位）
    print()
    for i, line in enumerate(_LOGO):
        tail = "   " + c(seal[i], G(124), F(231), BOLD) if i in seal else ""
        print("  " + c(line, F(_INK[i])) + tail)
    print("  " + c("～" * 9, F(37)) + c("～" * 9, F(30)) + c("～" * 9, F(23)))
    print("   " + c(T("蓬 莱 · 个人 AI 管家"), BOLD, F(252)) + c(T("（基于 GenericAgent）"), F(245)))
    print("   " + c(T("飞书 · 微信 · 记忆 · 多渠道"), F(245))
          + c("  ──  ", F(238)) + c(T("八仙过海，各显神通"), F(245)))

def print_minibanner():
    """翻页模式下每页顶部的迷你banner（清屏后保持身份感，不占视野）。"""
    print()
    print("  " + c(" 蓬 萊 ", G(124), F(231), BOLD) + " "
          + c("Penglai", BOLD, F(252)) + c(" · ", F(238)) + c(T("个人 AI 管家"), F(245)))
    print("  " + c("～" * 7, F(37)) + c("～" * 7, F(30)) + c("～" * 7, F(23)))

def header(tag, title):
    rule = "─" * max(4, 50 - _w(tag) - _w(title))
    print(f"\n{T_ICON} " + c(tag, BOLD, F(167)) + " " + c(title, BOLD, F(153)) + " " + c(rule, F(238)))

_TOTAL_STEPS = 6

def page(step_no, title):
    """新页面：tty 清屏 + 迷你banner + 步骤头；非 tty 降级为顺序步骤头。
    step_no=None 表示无编号子页（沿用当前页编号语境）。"""
    if _COLOR:
        print("\033[2J\033[H", end="")
        print_minibanner()
    tag = (T("步骤") + f" {step_no}/{_TOTAL_STEPS}") if step_no else T("可选")
    header(tag, title)

def _load_providers():
    """加载 penglai_providers.yaml，失败回退到内置最小列表。"""
    yaml_path = os.path.join(ROOT, "penglai_providers.yaml")
    if not os.path.exists(yaml_path):
        return None
    try:
        with open(yaml_path, encoding="utf-8") as f:
            raw = f.read()
        # 借助 venv 里的 yaml（setup 完成后可用），或降级到内置列表
        try:
            venv_py = os.path.join(ROOT, ".venv", "lib")
            for path in sys.path + ([venv_py] if os.path.isdir(venv_py) else []):
                if os.path.isdir(path):
                    for root_, dirs, _ in os.walk(path):
                        if "yaml" in dirs:
                            sys.path.insert(0, root_)
                            break
            import yaml
            return yaml.safe_load(raw)
        except ImportError:
            return None
    except Exception:
        return None

_PROVIDERS_DATA = _load_providers()

def _get_provider_list():
    """返回 [(序号显示名, provider_id, billing_mode_id, base_url, default_model, signup_url), ...]"""
    if not _PROVIDERS_DATA:
        # 内置兜底（数据来自 penglai_providers.yaml，保持同步）
        return [
            (1,  "DeepSeek",               "deepseek",   "paygo", "https://api.deepseek.com",                    "deepseek-v4-flash",           "https://platform.deepseek.com"),
            (2,  "字节火山 Ark (按量)",     "volcengine", "paygo", "https://ark.cn-beijing.volces.com/api/v3",    "doubao-seed-2.0-lite",        "https://console.volcengine.com/ark"),
            (3,  "字节火山 Ark (Coding)",   "volcengine", "coding_plan", "https://ark.cn-beijing.volces.com/api/coding/v3", "ark-code-latest", "https://console.volcengine.com/ark"),
            (4,  "阿里云百炼 Qwen",         "bailian",    "paygo", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.7-plus",         "https://bailian.console.aliyun.com"),
            (5,  "智谱 GLM",               "zhipu",      "paygo", "https://open.bigmodel.cn/api/paas/v4/",       "glm-5.1",                     "https://open.bigmodel.cn"),
            (6,  "MiniMax",                "minimax",    "paygo", "https://api.minimaxi.com/v1",                 "MiniMax-M3",                  "https://platform.minimaxi.com"),
            (7,  "Moonshot Kimi",          "moonshot",   "paygo", "https://api.moonshot.cn/v1",                  "kimi-k2.6",                   "https://platform.kimi.com"),
            (8,  "OpenRouter",             "openrouter", "paygo", "https://openrouter.ai/api/v1",                "anthropic/claude-sonnet-4-6", "https://openrouter.ai"),
            (9,  "腾讯混元",               "hunyuan",    "paygo", "https://api.hunyuan.cloud.tencent.com/v1",    "hunyuan-2.0-thinking",        "https://cloud.tencent.com/product/hunyuan"),
            (10, "讯飞星火",               "xunfei",     "paygo", "https://spark-api-open.xf-yun.com/v1",        "max-32k",                     "https://www.xfyun.cn"),
            (11, "自定义 OpenAI 兼容端点", "custom",     "paygo", "",                                            "",                            ""),
        ]
    rows = []
    idx = 1
    order = _PROVIDERS_DATA.get("wizard_order", list(_PROVIDERS_DATA.get("providers", {}).keys()))
    providers = _PROVIDERS_DATA.get("providers", {})
    for pid in order:
        p = providers.get(pid)
        if not p:
            continue
        billing = p.get("billing", {})
        _short = {"paygo": "按量", "coding_plan": "Coding", "agent_plan": "Agent", "token_plan": "订阅"}
        for bid, bdata in billing.items():
            tag = _short.get(bid) or (bdata.get("label") or bid).split("（")[0]
            label = f"{p['display']} ({tag})" if len(billing) > 1 else p["display"]
            models = bdata.get("models", [])
            default_model = next((m["id"] for m in models if m.get("default")), models[0]["id"] if models else "")
            rows.append((idx, label, pid, bid, bdata.get("base_url", ""), default_model, p.get("signup_url", "")))
            idx += 1
    return rows

def ask(prompt, default=""):
    tip = c(T("（回车={d}）", d=default), F(245)) if default else ""
    try:
        v = input("  " + c("›", BOLD, F(167)) + f" {prompt}{tip}: ").strip()
    except EOFError:
        return default
    return v or default

def post_json(url, payload, headers=None, timeout=40):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())

# ---------- 步骤 0：语言 ----------
def step_lang():
    """语言选择打头（i18n 全流程的开关）。环境变量 PENGLAI_LANG 可预设跳过询问。"""
    if _COLOR:
        print("\033[2J\033[H", end="")
    print_banner()
    if os.environ.get("PENGLAI_LANG"):
        return get_lang()
    header("◐", "选择语言 / Language")
    print("  1. 中文   2. English")
    set_lang("en" if ask("选择 / choose", "1") == "2" else "zh")
    return get_lang()

# ---------- 步骤 1：环境 ----------
def step_env():
    page(1, T("环境自检"))
    if sys.version_info < (3, 10):
        print(f"{BAD} " + T("需要 Python 3.10+，当前 {v}", v=sys.version.split()[0])); sys.exit(1)
    print(f"{OK} Python {sys.version.split()[0]}")
    if os.environ.get("PENGLAI_DOCKER"):
        print(f"{OK} " + T("容器环境（依赖已随镜像就绪）")); return
    py = os.path.join(ROOT, ".venv", "bin", "python")
    if not os.path.exists(py):
        print("  " + T("正在创建虚拟环境并安装依赖（清华镜像）..."))
        uv = shutil.which("uv") or next((p for p in [os.path.expanduser("~/.local/bin/uv")]
                                         if os.path.exists(p)), None)
        if not uv:
            try:
                import ensurepip  # noqa: F401  裸 Ubuntu 的 python3 没装 python3-venv
            except ImportError:
                print(f"{BAD} " + T("系统 Python 缺 venv 模块（全新 Ubuntu 常见）。任选一个修法后重试："))
                print("    sudo apt install -y python3-venv")
                print("    " + T("或用一键脚本（自动装 uv 托管 Python，不动系统）："))
                print("    curl -fsSL https://gh-proxy.com/https://raw.githubusercontent.com/"
                      "kevinchennewbee/PenglaiAgent/main/install.sh | sh")
                sys.exit(1)
        idx = "https://pypi.tuna.tsinghua.edu.cn/simple"
        try:
            if uv:
                subprocess.run([uv, "venv", ".venv"], cwd=ROOT, check=True, env={**os.environ, "UV_DEFAULT_INDEX": idx})
                subprocess.run([uv, "pip", "install", "--python", py, "-q", "-e", ".", "lark-oapi", "qrcode", "pyyaml"], cwd=ROOT, check=True,
                               env={**os.environ, "UV_DEFAULT_INDEX": idx})
            else:
                subprocess.run([sys.executable, "-m", "venv", ".venv"], cwd=ROOT, check=True)
                subprocess.run([py, "-m", "pip", "install", "-q", "-i", idx, "-e", ".", "lark-oapi", "qrcode", "pyyaml"], cwd=ROOT, check=True)
            print(f"{OK} " + T("依赖安装完成"))
        except subprocess.CalledProcessError:
            print(f"{BAD} " + T("依赖安装失败，请手动执行后重试: python3 -m venv .venv && .venv/bin/pip install -e . lark-oapi pyyaml"))
            sys.exit(1)
    else:
        print(f"{OK} " + T("虚拟环境已存在"))

# ---------- 步骤 2：LLM ----------
def step_llm():
    page(2, T("选择大模型（蓬莱的大脑）"))
    rows = _get_provider_list()
    for idx, label, pid, bid, base, model, signup in rows:
        num = c(f"{idx:>2}", BOLD, F(167))
        name = c(_pad(label, 28), F(252))
        model_s = (c(T("默认 "), F(245)) + c(_pad(model, 30), F(37))) if model \
                  else c(_pad(T("（手动填模型名）"), 35), F(245))
        # 列表展示 base_url（接入端点才是用户要核对的；注册链接选中后再给）
        base_s = base.replace("https://", "") if base else T("（手动填）")
        print(f"  {num}  {name}{model_s}{c(base_s, F(245))}")
    print()

    # 弃用模型警告表（来自 providers yaml）
    deprecated_map = {}
    if _PROVIDERS_DATA:
        for p in _PROVIDERS_DATA.get("providers", {}).values():
            for d in p.get("deprecated", []):
                deprecated_map[d["id"]] = d.get("replace", "")

    while True:
        try:
            chosen = int(ask(T("选择序号"), "1")) - 1
            _, name, pid, bid, base, default_model, signup = rows[chosen]
            break
        except (ValueError, IndexError):
            print("  " + T("无效序号，请重选"))

    if signup:
        print("  " + c(T("注册/充值入口："), F(245)) + c(signup, F(37)))

    # plan 警告
    if _PROVIDERS_DATA and pid in _PROVIDERS_DATA.get("providers", {}):
        bdata = _PROVIDERS_DATA["providers"][pid].get("billing", {}).get(bid, {})
        if bdata.get("warning"):
            print(f"  ⚠️  {bdata['warning']}")

    if not base:
        base = ask(T("API Base URL（如 https://api.example.com/v1）"))
    model = ask(T("模型名"), default_model)

    # 弃用提示
    if model in deprecated_map:
        replace = deprecated_map[model]
        print("  ⚠️  " + T("{m} 即将废弃，建议改用 {r}", m=model, r=replace))
        if ask(T("改用 {r}？(y/n)", r=replace), "y").lower().startswith("y"):
            model = replace

    key = ask(T("API Key（粘贴后回车）"))
    print("  " + T("连通性测试中..."), end="", flush=True)
    try:
        r = post_json(base.rstrip("/") + "/chat/completions",
                      {"model": model, "messages": [{"role": "user", "content": "回复两个字：蓬莱"}], "max_tokens": 64},
                      {"Authorization": f"Bearer {key}"})
        reply = r["choices"][0]["message"]["content"].strip()[:20]
        print(f"\r{OK} " + T("模型连通") + (T("，回复：{r}", r=reply) if reply else T("（思考型模型，空文本正常）")))
        return {"name": name, "apikey": key, "apibase": base, "model": model}
    except Exception as e:
        print(f"\r{BAD} " + T("测试失败：{e}", e=e))
        if ask(T("重试？(y/n)"), "y").lower().startswith("y"): return step_llm()
        sys.exit(1)

# ---------- 步骤 3：渠道单页选择 ----------
_CHANNEL_MENU = (
    # (id, 展示名, 备注 i18n key)
    ("feishu",   "飞书 Feishu",       "推荐·已实测·扫码即用"),
    ("wechat",   "微信 WeChat",       "已实测·扫码登录个人微信"),
    ("dingtalk", "钉钉 DingTalk",     "扫码自动建应用·待实测"),
    ("qq",       "QQ",                "扫码自动建应用·待实测"),
    ("telegram", "Telegram",          "贴 token 接入·待实测"),
    ("discord",  "Discord",           "贴 token 接入·待实测"),
    ("wecom",    "企业微信 WeCom",    "贴 token 接入·待实测"),
)

def step_channels():
    """单页渠道选择（多选）。飞书/微信在向导内闭环配置；其余渠道写入待办，
    在启动后经渠道矩阵（penglai_channels）逐个配置。"""
    page(3, T("接入渠道（你的管家住在哪）"))
    for i, (cid, label, note) in enumerate(_CHANNEL_MENU, 1):
        num = c(f"{i:>2}", BOLD, F(167))
        print(f"  {num}  {c(_pad(label, 22), F(252))}{c(T(note), F(245))}")
    print()
    print("  " + c(T("多选，逗号分隔（如 1,2）。飞书是目前验证闭环最完整的主渠道。"), F(245)))
    print("  " + c(T("终端 TUI 无需配置，装完直接敲 penglai 就能聊"), F(245)))
    while True:
        raw = ask(T("选择渠道"), "1")
        picks, bad = [], False
        for tok in raw.replace("，", ",").split(","):
            tok = tok.strip()
            if not tok:
                continue
            if tok.isdigit() and 1 <= int(tok) <= len(_CHANNEL_MENU):
                cid = _CHANNEL_MENU[int(tok) - 1][0]
                if cid not in picks:
                    picks.append(cid)
            else:
                bad = True
        if picks and not bad:
            break
        print("  " + T("无效序号，请重选"))
    if "feishu" not in picks:
        print(f"{WARN}" + T("未选飞书：跳过飞书配置，启动验证闭环也将跳过（其余渠道为「进程在跑」级报告）"))
    return picks

# ---------- 飞书（渠道子页） ----------
_FS_REG = "https://accounts.feishu.cn/oauth/v1/app/registration"

def _post_form(url, body, timeout=10):
    """表单 POST。注册端点 4xx 也带 JSON（poll 的 authorization_pending 走 400），照常解析。"""
    import urllib.error, urllib.parse
    req = urllib.request.Request(url, data=urllib.parse.urlencode(body).encode(),
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read()
        if raw:
            try: return json.loads(raw.decode())
            except ValueError: raise
        raise

def _render_qr(url):
    """终端渲染二维码。当前解释器没有 qrcode 就借 venv 的（step_env 已装入）。"""
    code = ("import qrcode\nq=qrcode.QRCode(); q.add_data(%r); q.make(fit=True); "
            "q.print_ascii(invert=True)" % url)
    for py in (sys.executable, os.path.join(ROOT, ".venv", "bin", "python")):
        if os.path.exists(py) and subprocess.run([py, "-c", code]).returncode == 0:
            return True
    return False

def _feishu_qr_create():
    """扫码自动建应用：飞书官方设备码注册流（accounts.feishu.cn）。
    begin 拿二维码 → 手机飞书扫码确认 → 平台自动创建配好权限的机器人应用 → poll 返回凭证。
    成功返回 (app_id, app_secret)，失败返回 None（外层回落手动）。"""
    init = _post_form(_FS_REG, {"action": "init"})
    if "client_secret" not in (init.get("supported_auth_methods") or []):
        return None
    begin = _post_form(_FS_REG, {"action": "begin", "archetype": "PersonalAgent",
                                 "auth_method": "client_secret", "request_user_info": "open_id"})
    device = begin.get("device_code")
    if not device:
        return None
    qr_url = begin.get("verification_uri_complete", "")
    shown = _render_qr(qr_url)
    print("  " + T("📱 打开手机飞书「扫一扫」，{hint}，确认创建机器人应用",
                   hint=T("扫上方二维码") if shown else T("扫码入口见下方链接（电脑浏览器打开后出码）")))
    print(f"  {qr_url}\n  " + T("等待确认"), end="", flush=True)
    deadline = time.monotonic() + min(int(begin.get("expires_in") or 600), 600)
    interval = max(int(begin.get("interval") or 5), 2)
    while time.monotonic() < deadline:
        try:
            res = _post_form(_FS_REG, {"action": "poll", "device_code": device, "tp": "ob_app"})
        except Exception:
            time.sleep(interval); continue
        if res.get("client_id") and res.get("client_secret"):
            print()
            return res["client_id"], res["client_secret"]
        if res.get("error") in ("access_denied", "expired_token"):
            print(f"\n  {BAD} " + (T("已在手机上取消") if res["error"] == "access_denied" else T("二维码已过期")))
            return None
        print(".", end="", flush=True)
        time.sleep(interval)
    print(f"\n  {BAD} " + T("等待扫码超时"))
    return None

def _feishu_verify(app_id, app_secret):
    r = post_json("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                  {"app_id": app_id, "app_secret": app_secret})
    return r.get("code") == 0, r.get("msg")

def step_feishu():
    page(3, T("接入飞书"))
    print("  " + T("1. 手机飞书扫码，自动创建机器人应用（推荐，免开网页）"))
    print("  " + T("2. 手动填入已有的 App ID / App Secret"))
    if ask(T("选择方式"), "1") == "1":
        try:
            cred = _feishu_qr_create()
        except Exception as e:
            print(f"  {BAD} " + T("扫码流程异常：{e}", e=e)); cred = None
        if cred:
            app_id, app_secret = cred
            print("  " + T("凭证验证中..."), end="", flush=True)
            ok, msg = _feishu_verify(app_id, app_secret)
            if ok:
                print(f"\r{OK} " + T("应用已创建，凭证有效（App ID: {id}）", id=app_id)); return app_id, app_secret
            print(f"\r{BAD} " + T("自动创建的凭证验证失败：{m}", m=msg))
        print("  " + T("↓ 回落手动方式"))
        print("""  ① 浏览器打开 https://open.feishu.cn/app → 创建企业自建应用（名字随意，如「蓬莱」）
  ② 左栏「添加应用能力」→ 添加「机器人」
  ③ 左栏「权限管理」→ 搜索并开通: im:message（获取与发送单聊/群聊消息相关权限，批量勾选）
  ④ 左栏「事件订阅」→ 订阅方式选「使用长连接接收事件」→ 添加事件: 接收消息 im.message.receive_v1
  ⑤ 左栏「版本管理与发布」→ 创建版本并发布（自建应用秒过审）
  ⑥ 「凭证与基础信息」页拿 App ID 和 App Secret，填到下面""")
    while True:
        app_id = ask(T("App ID（cli_ 开头）"))
        app_secret = ask("App Secret")
        print("  " + T("凭证验证中..."), end="", flush=True)
        try:
            ok, msg = _feishu_verify(app_id, app_secret)
            if ok:
                print(f"\r{OK} " + T("飞书凭证有效")); return app_id, app_secret
            print(f"\r{BAD} " + T("飞书返回错误：{m}（检查是否复制完整）", m=msg))
        except Exception as e:
            print(f"\r{BAD} " + T("验证失败：{e}", e=e))

# ---------- 步骤 4：起名 ----------
def step_identity():
    page(4, T("给你的管家起名"))
    agent = ask(T("管家名字"), "蓬莱助手 Penglai")
    user = ask(T("它怎么称呼你"), T("主人"))
    # 身份写入 L1 索引（GA 每轮注入系统提示的是 L1，不是 L2）。
    # 身份/SOP 行保持中文：发行版记忆体系是中文资产，向导语言只影响交互文案。
    ins = os.path.join(ROOT, "memory", "global_mem_insight.txt")
    if not os.path.exists(ins):
        tpl = os.path.join(ROOT, "assets", "global_mem_insight_template.txt")
        os.makedirs(os.path.dirname(ins), exist_ok=True)
        with open(ins, "w", encoding="utf-8") as f:
            f.write(open(tpl, encoding="utf-8").read() if os.path.exists(tpl) else "# [Global Memory Insight]\n")
    lines = [l for l in open(ins, encoding="utf-8", errors="replace").read().splitlines()
             if not l.startswith(("[身份]", "[蓬莱SOP]", "[蓬莱规则]"))]
    ident = (f"[身份] 我是「{agent}」，基于 GenericAgent 的开源个人管家发行版蓬莱。用户称呼：{user}。"
             f"被问及身份/名字时以此为准，勿自称底层模型名。")
    # 蓬莱 SOP 包索引（L3 文件随发行版出厂，带 penglai_ 前缀与上游永不撞名）
    sops = ("[蓬莱SOP] 长任务断点→penglai_checkpoint_sop | 压缩记忆留出处→penglai_compress_sop"
            " | 生成海报/SVG/视频→penglai_genmedia_sop | 用户想加/换IM渠道→penglai_channels_sop"
            "(有现成penglai enable命令,勿教手动建应用)")
    # 聊天渠道行为规则（vision_sop 的 OCR 优先是桌面 UI 自动化基因，不适合用户聊天发图）
    # 语音规则写硬：小模型(如 deepseek-flash)常嘴上说"先转写"却跑去调别的工具(真机实测)
    rules = ("[蓬莱规则] 聊天渠道用户发图→直接 vision 原生看图(勿先OCR,仅需逐字提取时才OCR)；"
             "消息含 [audio: 文件名]→你的第一个工具调用必须是 transcribe(path=该音频路径)，"
             "严禁跳过、严禁先调 file_read/web_scan/ask_user 等任何其他工具、严禁凭空猜测语音内容；"
             "拿到转写文本后再据此回应(支持微信silk,自带情绪标签)")
    out = ([lines[0], ident, sops, rules] + lines[1:] if lines and lines[0].startswith("#")
           else [ident, sops, rules] + lines)
    with open(ins, "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(f"{OK} " + T("身份 + 蓬莱SOP索引已写入 L1（每轮注入）"))
    return agent

# ---------- 步骤 5：能力面板 ----------
MODEL_BASE = os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models"))
MODEL_DIR = os.path.join(MODEL_BASE, "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
# 单文件直下只取 int8 推理件(229MB+tokens 0.3MB)。官方 tar 包内含 895MB 的 fp32
# model.onnx(我们不用),整包下载会让用户多拉近 4 倍流量——实测踩坑(2026-06-12)
_MODEL_FILES = ("model.int8.onnx", "tokens.txt")
_MODEL_FILE_BASES = (
    "https://hf-mirror.com/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/",
    "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/main/",
)
_MODEL_TAR = ("sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2")
_MODEL_URLS = (
    "https://gh-proxy.com/https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + _MODEL_TAR,
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/" + _MODEL_TAR,
)

def _dl_progress(url, dest):
    """下载到 dest，单行刷新进度。失败抛异常由调用方兜。"""
    req = urllib.request.Request(url, headers={"User-Agent": "penglai-setup"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        total = int(r.headers.get("Content-Length") or 0)
        got = 0
        while True:
            chunk = r.read(1 << 18)
            if not chunk:
                break
            f.write(chunk); got += len(chunk)
            if total:
                print(f"\r  {got // (1 << 20)}MB / {total // (1 << 20)}MB", end="", flush=True)
            else:
                print(f"\r  {got // (1 << 20)}MB", end="", flush=True)
    print()

def _voice_install():
    """语音能力真实落地：sherpa-onnx + ffmpeg + SenseVoice 模型。只报告可证实状态。"""
    docker = bool(os.environ.get("PENGLAI_DOCKER"))
    py = sys.executable if docker else os.path.join(ROOT, ".venv", "bin", "python")
    ok = True
    # 1) sherpa-onnx 推理引擎
    if subprocess.run([py, "-c", "import sherpa_onnx"], capture_output=True).returncode != 0:
        print("  " + T("安装语音识别引擎 sherpa-onnx ..."), flush=True)
        idx = "https://pypi.tuna.tsinghua.edu.cn/simple"
        uv = shutil.which("uv") or next((p for p in [os.path.expanduser("~/.local/bin/uv")]
                                         if os.path.exists(p)), None)
        if uv and not docker:
            r = subprocess.run([uv, "pip", "install", "-q", "--python", py, "sherpa-onnx"],
                               capture_output=True, text=True, env={**os.environ, "UV_DEFAULT_INDEX": idx})
        else:
            r = subprocess.run([py, "-m", "pip", "install", "-q", "-i", idx, "sherpa-onnx"],
                               capture_output=True, text=True)
        if r.returncode != 0 or subprocess.run([py, "-c", "import sherpa_onnx"],
                                               capture_output=True).returncode != 0:
            print(f"  {BAD} " + T("sherpa-onnx 安装失败：{e}", e=(r.stderr or "")[-120:])); ok = False
        else:
            print(f"  {OK} " + T("sherpa-onnx 就绪"))
    else:
        print(f"  {OK} " + T("sherpa-onnx 就绪"))
    # 2) ffmpeg（音频解码）
    if not shutil.which("ffmpeg"):
        if shutil.which("apt-get") and ask(T("缺 ffmpeg（音频解码必需）。现在用 apt 安装？(y/n)"), "y").lower().startswith("y"):
            subprocess.run(["sudo", "apt-get", "install", "-y", "ffmpeg"])
        if not shutil.which("ffmpeg"):
            print(f"  {WARN}" + T("请自行安装 ffmpeg 后语音即可用（Ubuntu: sudo apt install -y ffmpeg / macOS: brew install ffmpeg）"))
            ok = False
        else:
            print(f"  {OK} " + T("ffmpeg 就绪"))
    else:
        print(f"  {OK} " + T("ffmpeg 就绪"))
    # 3) SenseVoice 模型（int8 推理件约 230MB；hf 镜像单文件直下，gh-proxy tar 兜底）
    if os.path.isfile(os.path.join(MODEL_DIR, "model.int8.onnx")):
        print(f"  {OK} " + T("模型已存在，跳过下载"))
    else:
        print("  " + T("下载 SenseVoice 模型（约 230MB，国内自动走镜像）..."))
        os.makedirs(MODEL_DIR, exist_ok=True)
        got = False
        for base in _MODEL_FILE_BASES:
            try:
                for fn in _MODEL_FILES:
                    part = os.path.join(MODEL_DIR, fn + ".part")
                    _dl_progress(base + fn, part)
                    os.replace(part, os.path.join(MODEL_DIR, fn))
                got = True
                break
            except Exception as e:
                print(f"  {WARN}" + T("下载失败：{e}", e=str(e)[:80]))
        if not got:
            # tar 兜底（含 895MB fp32，解压后即删，只留 int8）
            tar_path = os.path.join(MODEL_BASE, _MODEL_TAR)
            for url in _MODEL_URLS:
                try:
                    _dl_progress(url, tar_path)
                    got = True
                    break
                except Exception as e:
                    print(f"  {WARN}" + T("下载失败：{e}", e=str(e)[:80]))
            if got:
                print("  " + T("解压中..."), flush=True)
                import tarfile
                try:
                    with tarfile.open(tar_path, "r:bz2") as tf:
                        try:
                            tf.extractall(MODEL_BASE, filter="data")
                        except TypeError:   # Python < 3.12 无 filter 参数
                            tf.extractall(MODEL_BASE)
                finally:
                    try: os.remove(tar_path)
                    except OSError: pass
                try: os.remove(os.path.join(MODEL_DIR, "model.onnx"))   # fp32 不用，省 895MB
                except OSError: pass
        if not os.path.isfile(os.path.join(MODEL_DIR, "model.int8.onnx")):
            ok = False
    # 4) 诚实结论
    if ok:
        print(f"{OK} " + T("语音就绪：转写 + 情绪 + 声学事件（飞书/微信语音条开箱即用）"))
    else:
        print(f"{WARN}" + T("语音未就绪（见上方原因），稍后可重跑 penglai setup 补装"))
    return ok

def step_abilities(llm_name=""):
    """能力面板：一页看全蓬莱层能力。选了就真装真启（语音默认开），不做摆设。"""
    page(5, T("蓬莱能力（按需开启，立即生效）"))
    print("  " + c(T("出厂常开（确定性防线，不可关）："), F(245))
          + c(T("红线审计 · 记忆卫生 · 出站文件白名单（飞书渠道）"), F(252)))
    print("  🧠 " + c(T("长期记忆：GA 内核标配，已自动启用"), F(252))
          + c(T("（L1 每轮注入 / 聊天结束自动结算沉淀，无需配置）"), F(245)))
    out = {}
    # —— 语音（默认开：发语音条是 IM 管家的基本盘）——
    print()
    print("  🎙️ " + c(T("语音情绪耳朵（本地 SenseVoice：转写+情绪+声学事件，含微信语音）"), BOLD, F(252)))
    print("     " + c(T("约下载 230MB 模型，本地 CPU 推理，零 API 成本。发语音条给管家必需。"), F(245)))
    voice_ready = False
    if ask(T("现在启用语音？(y/n)"), "y").lower().startswith("y"):
        voice_ready = _voice_install()
    # —— 主动陪伴（opt-in：有持续 token 成本）——
    print()
    print("  💞 " + c(T("主动陪伴（会主动关心你，不只是被动回复）"), BOLD, F(252)))
    print("     " + c(T("默认不开 → 蓬莱只在你发消息时回应（零成本）。"), F(245)))
    print("     " + c(T("开启后 → 独立心跳进程，门禁守护（勿扰时段/不打断聊天/频率上限），"), F(245)))
    print("     " + c(T("         偶尔主动联系你。是蓬莱第一个有持续 token 成本的功能（一天约几分钱）。"), F(245)))
    if ask(T("现在开启主动陪伴？(y/n)"), "n").lower().startswith("y"):
        print(f"  {OK} " + T("主动陪伴已开启（默认勿扰 22-8 点、最短间隔 4 小时；可后续在 mykey.py 调）"))
        out["companion_enabled"] = True
    # —— 批判脑（opt-in：跨厂商复核，绊线本就出厂常开）——
    print()
    print("  🧐 " + c(T("批判脑 smart 档（防幻觉第二保险：异厂商复核）"), BOLD, F(252)))
    print("     " + c(T("本地绊线出厂常开（免费）：嗅到「过度自信」措辞就拦下自检。"), F(245)))
    print("     " + c(T("再配一个【不同厂商】的免费模型，命中时交叉复核——单模型查不出自己的幻觉。"), F(245)))
    print("     " + c(T("成本极低：只在绊线命中时调用，单次上限 200 token。推荐智谱 GLM-4.7-Flash（完全免费）。"), F(245)))
    if ask(T("现在配置异厂商复核？(y/n)"), "n").lower().startswith("y"):
        main_name = (llm_name or "").split()[0] if llm_name else ""
        picks = [("智谱 GLM", "https://open.bigmodel.cn/api/paas/v4/", "glm-4.7-flash", T("完全免费"), "https://open.bigmodel.cn"),
                 ("讯飞星火", "https://spark-api-open.xf-yun.com/v1", "lite", T("永久免费"), "https://www.xfyun.cn"),
                 ("DeepSeek", "https://api.deepseek.com", "deepseek-v4-flash", T("约 ¥1/百万tok"), "https://platform.deepseek.com")]
        picks = [p for p in picks if not (main_name and p[0].split()[0] in main_name)]
        for i, (nm, bs, md, pr, su) in enumerate(picks, 1):
            print(f"   {i}. {_pad(nm, 10)}{_pad(md, 20)}{_pad(pr, 12)}{c(su, F(245))}")
        try:
            pi = int(ask(T("选择序号"), "1")) - 1
        except ValueError:
            pi = 0
        nm, bs, md, _, su = picks[max(0, min(pi, len(picks) - 1))]
        print("  " + T("到 {s} 注册并创建 API Key（免费档不用充值）", s=su))
        ckey = ask(T("API Key（粘贴后回车，留空跳过）"))
        if ckey:
            print("  " + T("连通性测试中..."), end="", flush=True)
            try:
                post_json(bs.rstrip("/") + "/chat/completions",
                          {"model": md, "messages": [{"role": "user", "content": "回复两个字：蓬莱"}], "max_tokens": 16},
                          {"Authorization": f"Bearer {ckey}"})
                print(f"\r{OK} " + T("复核模型连通（{n} / {m}）", n=nm, m=md))
                out["critic_model"] = {"name": nm, "apibase": bs, "apikey": ckey, "model": md}
                out["critic_mode"] = "smart"
            except Exception as e:
                print(f"\r{BAD} " + T("复核模型连通失败：{e}（稍后可 penglai enable critic 重配）", e=str(e)[:80]))
        else:
            print("  " + T("已跳过。稍后一条命令可开：penglai enable critic"))

    # —— 情报矩阵（opt-in：需要第三方 key）——
    print()
    print("  🔭 " + c(T("情报矩阵（多源交叉验证，降低幻觉）"), BOLD, F(252)))
    print("     " + c(T("默认不开 → 蓬莱用 GA 自带的真浏览器搜索（免费、开箱即用，已够用）。"), F(245)))
    print("     " + c(T("开启后 → 多个独立搜索 API 并查 + 交叉验证，更适合事实核查/写记忆/做决策。"), F(245)))
    if ask(T("现在开启情报矩阵增强？(y/n)"), "n").lower().startswith("y"):
        print("  " + T("推荐免费源（注册即送额度，具体以官网为准）："))
        print("   · TinyFish   " + c("https://agent.tinyfish.ai/api-keys", F(37)) + "  " + T("免费、自有索引，推荐首选"))
        print("   · Tavily     " + c("https://app.tavily.com", F(37)) + "             " + T("注册有每月免费额度"))
        print("   · Firecrawl  " + c("https://firecrawl.dev", F(37)) + "              " + T("注册送一次性免费额度"))
        print("  " + T("（都不想注册就全部回车跳过，继续用 GA 自带的免费浏览器搜索）"))
        if k := ask(T("TinyFish API Key（X-API-Key，可空）")): out["tinyfish_key"] = k
        if k := ask(T("Tavily API Key（可空）")):              out["tavily_key"] = k
        if k := ask(T("Firecrawl API Key（可空）")):           out["firecrawl_key"] = k
        n = len([1 for x in ("tinyfish_key", "tavily_key", "firecrawl_key") if x in out])
        print(f"  {OK} " + T("情报矩阵：{n} 个源已配置", n=n) if n else "  " + T("未填 key，保持默认（GA 浏览器）"))
    return out, voice_ready

# ---------- 写配置 ----------
def step_write(llm, app_id, app_secret, intel=None):
    header(T("步骤") + f" 6/{_TOTAL_STEPS}", T("写入配置 mykey.py"))
    path = os.path.join(ROOT, "mykey.py")
    if os.path.exists(path):
        bak = f"{path}.bak.{time.strftime('%Y%m%d-%H%M%S')}"
        shutil.copy2(path, bak); print("  " + T("已备份旧配置 → {b}", b=os.path.basename(bak)))
    body = f"""# mykey.py — 由 penglai setup 生成 {time.strftime('%Y-%m-%d %H:%M')}
native_oai_config = {{
    'name': {llm['name']!r},
    'apikey': {llm['apikey']!r},
    'apibase': {llm['apibase']!r},
    'model': {llm['model']!r},
    'max_retries': 3,
}}
mixin_config = {{
    'llm_nos': [{llm['name']!r}],
    'max_retries': 2,
    'base_delay': 2,
}}
penglai_lang = {get_lang()!r}
fs_app_id = {(app_id or '')!r}
fs_app_secret = {(app_secret or '')!r}
fs_allowed_users = []   # 留空=对所有可见用户开放（不安全）；向导实测时会自动收紧为你本人
"""
    for k, v in (intel or {}).items():
        body += f"{k} = {v!r}\n"
    with open(path, "w", encoding="utf-8") as f: f.write(body)
    os.chmod(path, 0o600)
    print(f"{OK} " + T("配置完成（权限 600，已加入 .gitignore 范围）"))

# ---------- 微信（渠道子页，须在 mykey 写入后调用） ----------
def step_wechat():
    """微信渠道：GA 原生 iLink 协议，扫码绑定。"""
    page(6, T("微信（扫码绑定个人微信，作为第二渠道）"))
    py = os.path.join(ROOT, ".venv", "bin", "python")
    if os.environ.get("PENGLAI_DOCKER"):
        py = sys.executable   # 容器内依赖已随镜像就绪，无 venv
    else:
        print("  " + T("安装微信依赖..."), end="", flush=True)
        r = subprocess.run(["uv", "pip", "install", "-q", "--python", py,
                            "qrcode", "pillow", "pycryptodome", "pilk"], capture_output=True, text=True)
        if r.returncode != 0:
            print(f"\r{BAD} " + T("依赖安装失败：{e}", e=(r.stderr or '')[-120:])); return False
        print(f"\r{OK} " + T("微信依赖就绪（qrcode/pillow/pycryptodome/pilk）"))
    tok = os.path.expanduser("~/.wxbot/token.json")
    if os.path.exists(tok) and not ask(T("检测到已有微信绑定，重新扫码？(y/n)"), "n").lower().startswith("y"):
        print(f"{OK} " + T("沿用现有绑定")); return True
    print("  " + T("📱 打开手机微信「扫一扫」，扫终端二维码并确认（图片也存在 ~/.wxbot/wx_qr.png）"))
    # 绕过 GA 主入口的 isatty 检查 bug（检查发生在 stdout 重定向之后，扫码路径不可达），直接调 WxBotClient
    code = (f"import sys; sys.path[:0] = [{ROOT!r}, {os.path.join(ROOT, 'frontends')!r}]\n"
            "from wechatapp import WxBotClient\n"
            "WxBotClient().login_qr()\n")
    if subprocess.run([py, "-c", code]).returncode != 0:
        print(f"{BAD} " + T("扫码未完成（可稍后重跑 penglai setup，只重做本步）")); return False
    print(f"{OK} " + T("微信绑定成功（token 已存 ~/.wxbot/，重启不用重扫）"))
    return True

# ---------- 步骤 6：启动并验证 ----------
def _fsapp_pids():
    r = subprocess.run(["pgrep", "-f", "frontends/fsapp.py"], capture_output=True, text=True)
    return [int(x) for x in r.stdout.split()] if r.returncode == 0 else []

def _spawn_fsapp(py):
    """非 systemd 环境后台拉起飞书进程。重跑幂等：先停旧实例。返回 (日志路径, 起始偏移)。"""
    import signal
    for pid in _fsapp_pids():
        try: os.kill(pid, signal.SIGTERM)
        except ProcessLookupError: pass
    if _fsapp_pids(): time.sleep(1.5)
    os.makedirs(os.path.join(ROOT, "temp"), exist_ok=True)
    log = os.path.join(ROOT, "temp", "fsapp.log")
    lf = open(log, "ab")
    pos = lf.tell()
    p = subprocess.Popen([py, os.path.join(ROOT, "frontends", "fsapp.py")], cwd=ROOT,
                         stdout=lf, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                         start_new_session=True)
    with open(os.path.join(ROOT, "temp", "fsapp.pid"), "w") as f:
        f.write(str(p.pid))
    return log, pos

def _watch(read_log, pattern, timeout, allow_skip=False):
    """轮询日志等 pattern 出现。返回 True / False(超时) / 'skip'(用户回车跳过)。"""
    import select
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if pattern in read_log():
            return True
        if allow_skip and sys.stdin in select.select([sys.stdin], [], [], 2)[0]:
            sys.stdin.readline()
            return "skip"
        if not allow_skip:
            time.sleep(2)
        print(".", end="", flush=True)
    return False

def _patch_allowlist(open_id):
    """把 fs_allowed_users 从【空】收紧为 [open_id]（secure-by-default，F-003）。
    仅在当前为空时改——不覆盖用户/上次已设的白名单。返回是否改动。"""
    import re
    path = os.path.join(ROOT, "mykey.py")
    try:
        src = open(path, encoding="utf-8").read()
    except Exception:
        return False
    m = re.search(r"^fs_allowed_users\s*=\s*(\[.*?\])", src, re.M)
    if not m:
        return False
    try:
        cur = eval(m.group(1), {"__builtins__": {}})
    except Exception:
        return False
    if cur:   # 已非空，尊重现状，不动
        return False
    new = src[:m.start(1)] + repr([open_id]) + src[m.end(1):]
    new = new.replace("# 留空=对所有可见用户开放（不安全）；向导实测时会自动收紧为你本人",
                      "# 已自动收紧为机器人主人；要加人就把对方 open_id 追加进列表")
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(new)
        os.chmod(path, 0o600)
    except Exception:
        return False
    return True

def _verify_live(read_log, log_hint):
    """端到端实测：日志见 connected → 用户真发消息 → 日志见「收到消息」。只报告真实状态。
    返回 (状态, 主人open_id)：状态 ∈ {True, "skip", False}；open_id 从「收到消息 [X]」捕获。"""
    import re
    print("  " + T("等待飞书长连接建立"), end="", flush=True)
    got = _watch(read_log, "connected to wss", 45)
    print()
    if not got:
        print(f"{BAD} " + T("45 秒内未建立连接，最近日志（完整: {h}）：", h=log_hint))
        for l in read_log().splitlines()[-8:]:
            print("    " + l[:160])
        return False, None
    print(f"{OK} " + T("飞书长连接已建立（日志确认 connected）"))
    print("  " + T("📨 实测收发：用手机飞书给机器人发一句「你好」（回车跳过，最长等 3 分钟）"), end="", flush=True)
    got = _watch(read_log, "收到消息", 180, allow_skip=True)
    print()
    if got is True:
        print(f"{OK} " + T("已收到你的消息，收发链路实测全通"))
        m = re.search(r"收到消息 \[([^\]]+)\]", read_log())
        return True, (m.group(1) if m else None)
    if got == "skip":
        print(f"{WARN}" + T("已跳过实测，链路尚未端到端验证"))
        return "skip", None
    print(f"{BAD} " + T("3 分钟内未收到消息。常见原因：发错了机器人 / 应用版本未发布 / 可见范围不含你"))
    print("    " + T("日志：{h}", h=log_hint))
    return False, None

def step_launch(with_feishu=True, with_companion=False, with_wechat=False):
    header(T("步骤") + f" 6/{_TOTAL_STEPS}", T("启动并验证"))
    if os.environ.get("PENGLAI_DOCKER"):
        print(f"{OK} " + T("容器模式：配置完成，启动与连接验证由 Docker 部署脚本接管"))
        return "docker"
    py = os.path.join(ROOT, ".venv", "bin", "python")
    if not with_feishu:
        print(f"{WARN}" + T("未选飞书渠道：跳过飞书启动验证"))
    if shutil.which("systemctl") and ask(T("安装为系统服务（开机自启）？(y/n)"), "y").lower().startswith("y"):
        env_sh = os.path.join(ROOT, "env.sh")
        if not os.path.exists(env_sh):
            open(env_sh, "w").write(f'export PATH="{ROOT}/.venv/bin:$PATH"\n')
        work = os.path.expanduser("~/penglai-work"); os.makedirs(work, exist_ok=True)
        units = {"penglai-scheduler": f"python {ROOT}/agentmain.py --reflect {ROOT}/reflect/scheduler.py"}
        if with_feishu:
            units["penglai-feishu"] = f"python {ROOT}/frontends/fsapp.py"
        if with_companion:
            units["penglai-companion"] = f"python {ROOT}/agentmain.py --reflect {ROOT}/reflect/penglai_companion.py"
        if with_wechat:
            units["penglai-wechat"] = f"python {ROOT}/frontends/wechatapp.py"
        t0 = int(time.time())
        try:
            for name, cmd in units.items():
                # 微信退出码 1=单例/无token、2=token过期需人扫码 → 不自动重启刷屏
                extra = "RestartPreventExitStatus=1 2\n" if name == "penglai-wechat" else ""
                # 启动前核验安全插件已挂载（F-011 fail-closed）；失败则 systemd 不拉起本服务
                guard = (f"ExecStartPre=/bin/bash -lc 'source {env_sh} && "
                         f"python {ROOT}/penglai _guardcheck'\n")
                unit = (f"[Unit]\nDescription=Penglai {name}\nAfter=network-online.target\n\n[Service]\nType=simple\n"
                        f"User={os.environ.get('USER', 'root')}\nWorkingDirectory={ROOT}\nEnvironment=HOME={os.path.expanduser('~')}\n"
                        f"Environment=GA_WORKSPACE_ROOT={work}\n{guard}ExecStart=/bin/bash -lc 'source {env_sh} && exec {cmd}'\n"
                        f"Restart=always\nRestartSec=20\n{extra}\n[Install]\nWantedBy=multi-user.target\n")
                subprocess.run(["sudo", "tee", f"/etc/systemd/system/{name}.service"], input=unit, text=True,
                               check=True, stdout=subprocess.DEVNULL)
            subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
            subprocess.run(["sudo", "systemctl", "enable", "--now"] + list(units), check=True)
            print(f"{OK} " + T("服务已安装并设为开机自启，开始验证..."))
        except subprocess.CalledProcessError:
            print(f"{BAD} " + T("服务安装失败（sudo 权限？），可手动前台运行: .venv/bin/python frontends/fsapp.py"))
            return False
        # 陪伴服务真实状态（诚实纪律：装了 ≠ 在跑）
        if with_companion:
            st = subprocess.run(["systemctl", "is-active", "penglai-companion"],
                                capture_output=True, text=True).stdout.strip()
            print((f"{OK} " + T("陪伴服务已启动（systemd: penglai-companion）")) if st == "active"
                  else (f"{BAD} " + T("陪伴服务未在运行，请检查: systemctl status penglai-companion")))
        if not with_feishu:
            return "nofs"
        def read_log():
            r = subprocess.run(["sudo", "journalctl", "-u", "penglai-feishu", f"--since=@{t0}",
                                "-o", "cat", "--no-pager"], capture_output=True, text=True)
            return r.stdout or ""
        status, owner = _verify_live(read_log, "journalctl -u penglai-feishu -f")
        if status is True and owner and _patch_allowlist(owner):
            print(f"{OK} " + T("已自动把你（{o}）设为唯一授权用户，机器人不再对所有可见用户开放", o=owner))
            print("  " + T("正在重启服务让白名单生效..."))
            subprocess.run(["sudo", "systemctl", "restart", "penglai-feishu"])
            time.sleep(2)
            print(f"  {WARN}" + T("重启会打断刚才正在处理的消息——你在“发你好”之后抢发的语音/消息可能没回应，稍等几秒后重发即可。"))
        return status
    # 无 systemd（容器/macOS）或用户拒绝装服务 → 后台直启，照样实测验证
    if not with_feishu:
        return "nofs"
    if not ask(T("无系统服务模式：现在后台启动飞书进程并实测？(y/n)"), "y").lower().startswith("y"):
        print(f"{WARN}" + T("未启动。稍后手动: penglai start（日志: penglai logs）"))
        return "skip"
    log, pos = _spawn_fsapp(py)
    print(f"{OK} " + T("飞书进程已后台启动（停止: penglai stop，日志: penglai logs）"))
    def read_log():
        with open(log, encoding="utf-8", errors="replace") as f:
            f.seek(pos)
            return f.read()
    status, owner = _verify_live(read_log, f"tail -f {log}")
    if status is True and owner and _patch_allowlist(owner):
        print(f"{OK} " + T("已自动把你（{o}）设为唯一授权用户，机器人不再对所有可见用户开放", o=owner))
        print("  " + T("正在重启飞书进程让白名单生效..."))
        _spawn_fsapp(py)
        time.sleep(2)
        print(f"  {WARN}" + T("重启会打断刚才正在处理的消息——你在“发你好”之后抢发的语音/消息可能没回应，稍等几秒后重发即可。"))
    return status

# ---------- 附加渠道（启动后经渠道矩阵配置） ----------
def step_extras(extras):
    """钉钉/QQ/TG/Discord/企微：复用 penglai_channels 的扫码/凭证/服务流程。
    （渠道矩阵交互文案当前为中文；其状态报告遵循诚实纪律「进程在跑」级。）"""
    if not extras:
        return
    page(None, T("配置附加渠道"))
    import penglai_channels as pc
    for ch in extras:
        label = pc.CHANNELS[ch]["label"]
        print("\n  " + T("开始配置 {l}（扫码/凭证流程来自渠道矩阵）", l=label))
        try:
            pc.enable(ch)
        except KeyboardInterrupt:
            raise
        except Exception as e:
            print(f"  {BAD} {label}: {e}")
    print(f"\n{OK} " + T("附加渠道配置完成。状态总览: penglai channels"))

def main():
    step_lang()
    step_env()
    llm = step_llm()
    channels = step_channels()
    app_id = app_secret = None
    if "feishu" in channels:
        app_id, app_secret = step_feishu()
    agent = step_identity()
    intel, _voice_ready = step_abilities(llm.get("name", ""))
    comp = {"companion_enabled": True} if intel.get("companion_enabled") else {}
    # 步骤 6 页：写配置 + 微信 + 启动验证同属收尾页
    if _COLOR:
        print("\033[2J\033[H", end="")
        print_minibanner()
    step_write(llm, app_id, app_secret, intel)
    wx = step_wechat() if "wechat" in channels else False
    live = step_launch(with_feishu="feishu" in channels,
                       with_companion=bool(comp), with_wechat=wx)
    step_extras([ch for ch in channels if ch not in ("feishu", "wechat")])
    if live is True:
        print("\n" + T("🎉 安装完成，飞书收发链路已实测全通！"))
    elif live == "docker":
        print(f"\n{OK} " + T("配置完成。容器服务即将由部署脚本启动并验证连接。"))
        return
    elif live == "skip":
        print(f"\n{OK} " + T("安装完成（链路未实测）。去飞书给「{a}」发一句「你好」，用 penglai logs 看到「收到消息」即全通。", a=agent))
    elif live == "nofs":
        print(f"\n{OK} " + T("安装完成。已配置渠道见上；终端随时可聊。"))
    else:
        print(f"\n{WARN}" + T("配置已写入，但飞书链路验证未通过 —— 按上方提示排查后运行 penglai doctor 复检。"))
    if live is True or live == "skip" or live == "nofs":
        print("\n   " + T("现在就可以和「{a}」聊天了：", a=agent))
        print("   " + T("💬 飞书（或已绑定的微信）里直接发消息"))
        print("   " + T("⌨️  终端任意位置输入 penglai 进入命令行对话（同一个管家，同一份记忆）"))
    print("\n   " + T("体检: penglai doctor   日志: penglai logs   更新: penglai update"))
    print("   " + T("（若提示 command not found：重开终端，或先用 ./penglai）"))

if __name__ == "__main__":
    try: sys.exit(main())
    except KeyboardInterrupt: print("\n" + T("已取消。随时重新运行 penglai setup")); sys.exit(1)
