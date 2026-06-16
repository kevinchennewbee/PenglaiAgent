# -*- coding: utf-8 -*-
"""penglai_abilities — 装机后补开向导里没开的蓬莱能力（语音/主动陪伴/情报矩阵）。

向导(penglai setup)第一次没开的能力，事后用 `penglai enable <能力>` 补开，
不必重跑整个向导。与渠道共用 enable 入口（penglai CLI 按名字分发到这里或渠道矩阵）。

  penglai enable voice      装 sherpa-onnx + ffmpeg + SenseVoice 模型（语音转写+情绪）
  penglai enable companion  开启主动陪伴（独立心跳进程，门禁守护）
  penglai enable intel      配置情报矩阵（多源搜索交叉验证）
  penglai disable <能力>    关闭
  penglai abilities         能力总览（已开/未开 + 开启命令）

诚实纪律：只报告可证实的状态；装一半/缺依赖如实说，并给出下一步命令。
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
OK, BAD, WARN = "✅", "❌", "⚠️ "

ABILITIES = ("voice", "companion", "intel", "critic")

# 批判脑复核模型 = 用户从整张厂商目录自选（与向导主力模型同一套选择 UI，复用 penglai_setup，
# 不限免费）。仅约束「与主力不同厂商」以获得交叉视差——见 enable_critic()。

# 情报矩阵免费源指引(注册即送额度,具体额度以官网为准)
INTEL_FREE_GUIDE = (
    "  推荐免费源（注册即送额度，具体以官网为准）：",
    "   · TinyFish   https://agent.tinyfish.ai/api-keys   免费、自有索引，推荐首选",
    "   · Tavily     https://app.tavily.com               注册有每月免费额度",
    "   · Firecrawl  https://firecrawl.dev                注册送一次性免费额度",
)


def _pc():
    import penglai_channels as pc
    return pc


def _ask(q, default=""):
    try:
        return input(f"  {q} ").strip() or default
    except EOFError:
        return default


# ---------- 状态探测 ----------
def _voice_ready():
    import shutil
    pc = _pc()
    mdir = os.path.join(os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models")),
                        "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    model = os.path.isfile(os.path.join(mdir, "model.int8.onnx"))
    engine = pc.sh([pc.venv_python(), "-c", "import sherpa_onnx"]).returncode == 0
    ffmpeg = shutil.which("ffmpeg") is not None
    return model and engine and ffmpeg, (model, engine, ffmpeg)


def _companion_on():
    return _pc().mykey_get("companion_enabled")


def _companion_enabled():
    """公开探针：agent/脚本探活时常按此名调（F10：曾撞 AttributeError）。与 _companion_running 配套。"""
    return bool(_companion_on())


def _companion_running():
    """真实存活：开关开着且心跳进程真在跑（systemd 看 is-active，非 systemd 看进程在不在）。
    U11：status() 不再只凭旗标误报『已开启』（macOS 心跳进程死了旗标仍 True）。"""
    pc = _pc()
    if not _companion_on():
        return False
    if pc.has_systemd():
        return pc.sh(["systemctl", "is-active", "penglai-companion"]).stdout.strip() == "active"
    return pc.sh(["pgrep", "-f", "reflect/penglai_companion.py"]).returncode == 0


def _intel_sources():
    pc = _pc()
    return [k for k in ("tinyfish_key", "tavily_key", "firecrawl_key") if pc.mykey_get(k)]


def _vision_ready():
    return os.path.exists(os.path.join(ROOT, "memory", "vision_api.py"))


def build_vision_api():
    """从 GA 的 vision_api.template.py 构建 memory/vision_api.py 并配到主力模型(native_oai_config)，
    让 ask_vision(img, backend='openai') 把图按 image_url 喂给主力多模态模型(如 M3)看图——补 U4/F7
    『IM 发来的图看不到』。GA 模板零改动；vision_api.py 是用户配置产物(同 mykey.py)，已存在不覆盖。
    返回 built / exists / skip（无 OAI 兼容主力模型）/ no_template。"""
    mem = os.path.join(ROOT, "memory")
    tmpl = os.path.join(mem, "vision_api.template.py")
    out = os.path.join(mem, "vision_api.py")
    if not os.path.exists(tmpl):
        return "no_template"
    if os.path.exists(out):
        return "exists"
    pc = _pc()
    has_oai = pc.sh([pc.venv_python(), "-c",
                     "import mykey;c=getattr(mykey,'native_oai_config',{});"
                     "print(1 if isinstance(c,dict) and c.get('apibase') and c.get('apikey') "
                     "and c.get('model') else 0)"], cwd=ROOT).stdout.strip() == "1"
    if not has_oai:
        return "skip"
    try:
        src = open(tmpl, encoding="utf-8").read()
        src = src.replace("OPENAI_CONFIG_KEY = 'oai_config1'", "OPENAI_CONFIG_KEY = 'native_oai_config'")
        src = src.replace("DEFAULT_BACKEND = 'claude'", "DEFAULT_BACKEND = 'openai'")
        with open(out, "w", encoding="utf-8") as f:
            f.write(src)
        return "built"
    except Exception:
        return "no_template"


def notify_owner(text):
    """给主人发一条 IM（飞书 + 微信），任何蓬莱进程 / agent 手写脚本都可 import 复用：
        from penglai_abilities import notify_owner; notify_owner("...")
    复用 reflect.penglai_companion 的发送实现（import 它会建一次端口锁，已被其内部
    try/except 兜住，send-only 无害）。未配 IM 时静默返回 False，调用方勿当异常。
    U8：补上 agent/脚本唯一缺的『一行发给主人』公开原语，省得再猜 import penglai。"""
    try:
        import llmcore
        mk = llmcore.reload_mykeys()[0] or {}
    except Exception:
        try:
            import mykey
            mk = {k: v for k, v in vars(mykey).items() if not k.startswith("_")}
        except Exception:
            return False
    try:
        import reflect.penglai_companion as cp
    except Exception:
        return False
    sent = False
    users = mk.get("fs_allowed_users", []) or []
    app_id, secret = mk.get("fs_app_id", ""), mk.get("fs_app_secret", "")
    if users and app_id:
        try:
            sent = cp._feishu_send({"open_id": users[0], "app_id": app_id,
                                    "app_secret": secret}, text) or sent
        except Exception:
            pass
    if os.path.exists(os.path.expanduser("~/.wxbot/token.json")):
        try:
            sent = cp._wechat_send(text) or sent
        except Exception:
            pass
    return sent


# ---------- 通用 systemd 服务安装（reflect 心跳类）----------
def _launchd_label(service):
    return "com.penglai." + service.replace("penglai-", "")


def install_launchd(label_id, program_args, logf):
    """通用 macOS launchd 守护：KeepAlive(崩/被杀自动重启) + RunAtLoad(开机自启) + PATH 固化
    (含 venv / ~/.local/bin / /opt/homebrew/bin)。给任何长驻进程(fsapp 飞书前端 / scheduler 提醒日程 /
    companion 陪伴 / wechat)补 Linux systemd Restart=always 的等价物——macOS 无头服务器才有真正的
    守护与开机自启。真机教训：旧版非 systemd 只裸 Popen fire-and-forget，被杀/崩就永久死、开机不自启、
    更新重启后还滞留旧码。program_args=完整启动命令 list；logf=日志路径。返回是否注册成功。"""
    from xml.sax.saxutils import escape as _x
    pc = _pc()
    plist_dir = os.path.expanduser("~/Library/LaunchAgents"); os.makedirs(plist_dir, exist_ok=True)
    plist_path = os.path.join(plist_dir, label_id + ".plist")
    os.makedirs(os.path.dirname(logf) or ".", exist_ok=True)
    vbin = os.path.join(ROOT, ".venv", "bin")
    path_env = ":".join([vbin if os.path.isdir(vbin) else os.path.dirname(pc.venv_python()),
                         os.path.expanduser("~/.local/bin"), "/opt/homebrew/bin", "/usr/local/bin",
                         "/usr/bin", "/bin", "/usr/sbin", "/sbin"])
    args_xml = "".join(f"<string>{_x(a)}</string>" for a in program_args)
    plist = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        f'  <key>Label</key><string>{label_id}</string>\n'
        f'  <key>ProgramArguments</key><array>{args_xml}</array>\n'
        f'  <key>WorkingDirectory</key><string>{_x(ROOT)}</string>\n'
        '  <key>EnvironmentVariables</key><dict>'
        f'<key>PATH</key><string>{path_env}</string>'
        f'<key>HOME</key><string>{_x(os.path.expanduser("~"))}</string></dict>\n'
        '  <key>RunAtLoad</key><true/>\n  <key>KeepAlive</key><true/>\n'
        '  <key>ThrottleInterval</key><integer>20</integer>\n'
        f'  <key>StandardOutPath</key><string>{_x(logf)}</string>\n'
        f'  <key>StandardErrorPath</key><string>{_x(logf)}</string>\n'
        '</dict></plist>\n')
    try:
        with open(plist_path, "w", encoding="utf-8") as f:
            f.write(plist)
    except Exception as e:
        print(f"{BAD} launchd plist 写入失败（{label_id}）: {e}"); return False
    uid = str(os.getuid())
    pc.sh(["launchctl", "bootout", f"gui/{uid}/{label_id}"])      # 幂等卸旧
    r = pc.sh(["launchctl", "bootstrap", f"gui/{uid}", plist_path])
    if r.returncode != 0:                                         # 旧 macOS 回退 load
        pc.sh(["launchctl", "unload", plist_path]); pc.sh(["launchctl", "load", plist_path])
    return pc.sh(["launchctl", "list", label_id]).returncode == 0


def _install_launchd(service, reflect_py, label):
    """reflect 心跳类(companion/scheduler)的 launchd 守护——薄封装通用 install_launchd。"""
    logf = os.path.join(ROOT, "temp", f"{service}.log")
    ok = install_launchd(_launchd_label(service),
                         [_pc().venv_python(), os.path.join(ROOT, "agentmain.py"),
                          "--reflect", os.path.join(ROOT, reflect_py)], logf)
    print(f"{OK} {label} 已用 launchd 守护 + 开机自启（{_launchd_label(service)}，崩溃/被杀自动重启）" if ok
          else f"{WARN}{label} launchd 注册未确认（launchctl list {_launchd_label(service)} 可查）")
    return True


def _install_reflect_service(service, reflect_py, label):
    pc = _pc()
    if not pc.has_systemd():
        if sys.platform == "darwin":
            return _install_launchd(service, reflect_py, label)
        # 非 macOS 又无 systemd（容器等）：nohup 起后台心跳（尽力，无守护，崩溃不自动重启）
        os.makedirs(os.path.join(ROOT, "temp"), exist_ok=True)
        log = open(os.path.join(ROOT, "temp", f"{service}.log"), "ab")
        subprocess.Popen([pc.venv_python(), os.path.join(ROOT, "agentmain.py"),
                          "--reflect", os.path.join(ROOT, reflect_py)],
                         cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, start_new_session=True)
        print(f"{WARN}{label} 已后台启动（无 systemd/launchd，崩溃不自动重启，日志 temp/{service}.log）")
        return True
    env_sh = os.path.join(ROOT, "env.sh")
    if not os.path.exists(env_sh):
        open(env_sh, "w").write(f'export PATH="{ROOT}/.venv/bin:$PATH"\n')
    work = os.path.expanduser("~/penglai-work"); os.makedirs(work, exist_ok=True)
    guard = (f"ExecStartPre=/bin/bash -lc 'source {env_sh} && python {ROOT}/penglai _guardcheck'\n")
    cmd = f"python {ROOT}/agentmain.py --reflect {ROOT}/{reflect_py}"
    unit = (f"[Unit]\nDescription=Penglai {label}\nAfter=network-online.target\n\n"
            f"[Service]\nType=simple\nUser={os.environ.get('USER', 'root')}\n"
            f"WorkingDirectory={ROOT}\nEnvironment=HOME={os.path.expanduser('~')}\n"
            f"Environment=GA_WORKSPACE_ROOT={work}\n{guard}"
            f"ExecStart=/bin/bash -lc 'source {env_sh} && exec {cmd}'\n"
            f"Restart=always\nRestartSec=20\n\n[Install]\nWantedBy=multi-user.target\n")
    try:
        subprocess.run(["sudo", "tee", f"/etc/systemd/system/{service}.service"],
                       input=unit, text=True, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
        subprocess.run(["sudo", "systemctl", "enable", "--now", service], check=True)
        print(f"{OK} {label} 服务已安装并开机自启（{service}）")
        return True
    except subprocess.CalledProcessError:
        print(f"{BAD} {label} 服务安装失败（sudo 权限？）")
        return False


# ---------- 语音 ----------
def enable_voice():
    ready, _ = _voice_ready()
    if ready:
        print(f"{OK} 语音已就绪，无需重复安装。"); return 0
    import penglai_setup as ps   # 复用向导的真实安装逻辑（装引擎+ffmpeg+下模型）
    return 0 if ps._voice_install() else 1


def disable_voice():
    print(f"{WARN} 语音是工具能力（无常驻进程），无需停用；"
          "如要省盘可手动删 ~/penglai-models/ 下的模型目录。")
    return 0


# ---------- 主动陪伴 ----------
def enable_companion():
    pc = _pc()
    if _companion_running():   # 按进程实判（launchd/systemd/pgrep），不只看旗标——死了就重装守护
        print(f"{OK} 主动陪伴已在运行。"); return 0
    print("  💞 开启主动陪伴：独立心跳进程，门禁守护（默认勿扰 22-8 点、最短间隔 4 小时），")
    print("     触发源：恶劣天气预警 / 语音情绪承接 / 早晚问候 / 久未联系。投递到飞书和微信。")
    print("     是蓬莱第一个有持续 token 成本的功能（一天约几分钱）。")
    if not _ask("现在开启？(y/n)", "y").lower().startswith("y"):
        return 0
    keys = {"companion_enabled": True}
    city = _ask("所在城市（开启恶劣天气主动提醒，回车跳过）", "").strip()
    if city:
        keys["companion_city"] = city
    pc.mykey_set(keys)
    extra = f"、companion_city={city}（天气预警开）" if city else "（未设城市，天气预警关）"
    print(f"{OK} 已写入 companion_enabled=True{extra}")
    return 0 if _install_reflect_service("penglai-companion", "reflect/penglai_companion.py", "主动陪伴") else 1


def disable_companion():
    pc = _pc()
    pc.mykey_set({"companion_enabled": False})
    if pc.has_systemd():
        pc.sh(["sudo", "systemctl", "disable", "--now", "penglai-companion"])
        pc.sh(["sudo", "rm", "-f", "/etc/systemd/system/penglai-companion.service"])
        pc.sh(["sudo", "systemctl", "daemon-reload"])
    else:
        if sys.platform == "darwin":   # 先卸 launchd 守护，否则 KeepAlive 会把 pkill 掉的进程立刻拉回
            label_id = _launchd_label("penglai-companion")
            pc.sh(["launchctl", "bootout", f"gui/{os.getuid()}/{label_id}"])
            try: os.remove(os.path.expanduser(f"~/Library/LaunchAgents/{label_id}.plist"))
            except OSError: pass
        pc.sh(["pkill", "-f", "reflect/penglai_companion.py"])
    print(f"{OK} 主动陪伴已关闭。")
    return 0


# ---------- 批判脑（跨厂商复核，smart 档）----------
def _main_vendor():
    """主力模型的厂商显示名（向导写入 mykey 的 name，如 'DeepSeek' / '智谱 GLM (按量)'）。"""
    pc = _pc()
    r = pc.sh([pc.venv_python(), "-c",
               "import mykey;print(getattr(mykey,'native_oai_config',{}).get('name',''))"], cwd=ROOT)
    return (r.stdout or "").strip()


def _critic_on():
    pc = _pc()
    r = pc.sh([pc.venv_python(), "-c",
               "import mykey;m=getattr(mykey,'critic_model',None);"
               "print('ON' if isinstance(m,dict) and m.get('apikey') and "
               "getattr(mykey,'critic_mode','smart')!='off' else '')"], cwd=ROOT)
    return (r.stdout or "").strip() == "ON"


def enable_critic():
    pc = _pc()
    if _critic_on():
        print(f"{OK} 批判脑已在 smart 档运行（绊线常开 + 异厂商复核）。"); return 0
    main = _main_vendor()
    print("  🧐 批判脑 smart 档：本地绊线常开（免费）嗅探过度自信措辞；命中才调用")
    print("     【另一厂商】的模型复核记忆写入——单模型查不出自己的幻觉，跨厂商才有视差。")
    print("     成本极低：只在绊线命中时调用，每次复核上限 200 token。")
    print(f"\n  你的主力模型：{main or '（未配置）'}。从整张厂商目录任选一个【不同厂商】的复核模型")
    print("  （免费如智谱 GLM-4.7-Flash / 讯飞 Lite / 混元 Lite，也可投入更强的付费模型，视差更大）：")
    # 与向导主菜单同一套全目录选择 + 连通测试（复用 penglai_setup，不再各写一份）
    import penglai_setup as ps
    r = ps._select_provider_model(exclude_vendor=main or "")
    if not r:
        print(f"{BAD} 未配置（未选 / 未填 Key / 连通失败）。检查后重跑 penglai enable critic"); return 1
    pc.mykey_set({"critic_model": {"name": r["name"], "apibase": r["apibase"],
                                   "apikey": r["apikey"], "model": r["model"]},
                  "critic_mode": "smart"})
    print(f"{OK} 批判脑已开启 smart 档（{r['name']} / {r['model']}）。下次记忆写入时自动复核，即时生效、无需重启。")
    return 0


def disable_critic():
    pc = _pc()
    pc.mykey_set({"critic_mode": "off"})
    print(f"{OK} 批判脑已关闭（critic_mode=off，绊线与复核都不再运行；"
          "复核模型配置保留，penglai enable critic 可复开）。即时生效、无需重启。")
    return 0


# ---------- 情报矩阵 ----------
def enable_intel():
    pc = _pc()
    cur = _intel_sources()
    if cur:
        print(f"{OK} 情报矩阵已配置 {len(cur)} 个源：{', '.join(cur)}")
        if not _ask("重新配置？(y/N)", "n").lower().startswith("y"):
            return 0
    print("  🔭 网页搜索默认已开箱可用（内置免费 Bing 兜底）。情报矩阵 = 在它之上叠加多个独立搜索 API，")
    print("     多源并查 + 交叉验证，更适合事实核查/写记忆/做决策。")
    for line in INTEL_FREE_GUIDE:
        print(line)
    print("  （都不想注册就全部回车跳过，内置免费 Bing 搜索照常可用，只是没有多源交叉验证）")
    pairs = {}
    if k := _ask("TinyFish API Key（X-API-Key，可空）"): pairs["tinyfish_key"] = k
    if k := _ask("Tavily API Key（免费额度，可空）"):    pairs["tavily_key"] = k
    if k := _ask("Firecrawl API Key（可空）"):           pairs["firecrawl_key"] = k
    if not pairs:
        print("  未填任何 key，保持内置免费 Bing 搜索。"); return 0
    pc.mykey_set(pairs)
    print(f"{OK} 情报矩阵：{len(pairs)} 个源已写入。下次搜索自动多源交叉验证，即时生效、无需重启。")
    return 0


def disable_intel():
    print(f"{WARN} 删除情报源请手动编辑 mykey.py 移除 tinyfish_key/tavily_key/firecrawl_key 行，"
          "即时生效、无需重启。")
    return 0


# ---------- 总览 ----------
def status():
    print("🏮 蓬莱能力总览（装完后可随时补开）\n")
    vr, (vm, ve, vf) = _voice_ready()
    comp_on, comp_run = _companion_on(), _companion_running()
    comp_mark = True if (comp_on and comp_run) else ("warn" if comp_on else False)
    comp_state = ("已开启" if (comp_on and comp_run)
                  else "已开启但心跳进程未运行 → penglai enable companion 重启" if comp_on
                  else "未开启（零成本，被动回复）")
    intel = _intel_sources()
    rows = [
        ("🎙️ 语音转写+情绪", vr,
         "就绪（SenseVoice 本地）" if vr else f"未装齐（缺 {'/'.join(n for n, ok in (('模型', vm), ('引擎', ve), ('ffmpeg', vf)) if not ok)}）",
         "penglai enable voice"),
        ("💞 主动陪伴", comp_mark, comp_state, "penglai enable companion"),
        ("🔭 情报矩阵", bool(intel),
         f"已配 {len(intel)} 个源" if intel else "默认（GA 浏览器搜索）",
         "penglai enable intel"),
        ("🧐 批判脑", _critic_on(),
         "smart 档（绊线常开 + 异厂商复核）" if _critic_on() else "仅本地绊线（免费常开）；异厂商复核未配",
         "penglai enable critic"),
    ]
    for label, on, state, cmd in rows:
        mark = {True: OK, False: "○"}.get(on, "⚠️")   # on=True/False/'warn'(开着但心跳没跑)
        tail = f"   → 开启：{cmd}" if on is False else ""
        print(f"  {mark} {label:<16} {state}{tail}")
    print("\n  🧠 长期记忆 — 内核标配，已自动启用（无需开关）")
    print("  ⏰ 提醒/日程 — 内核标配，已自动启用（说「X点提醒我做Y」即可）")
    print("  🌤️ 天气查询 — 内核标配，已自动启用（免 key）")
    print("  🔗 网页/文章总结 — 内核标配，已自动启用（发链接说「帮我总结」即可）")
    print("  🛡️ 红线/记忆卫生/出站文件白名单（飞书渠道）— 出厂常开（确定性防线，不可关）")
    print("\n  加 IM 渠道：penglai enable <dingtalk|qq|telegram|discord|wecom> · 渠道总览：penglai channels")
    return 0


# ---------- CLI 分发（由 penglai 脚本调用）----------
def enable(name):
    return {"voice": enable_voice, "companion": enable_companion,
            "intel": enable_intel, "critic": enable_critic}[name]()


def disable(name):
    return {"voice": disable_voice, "companion": disable_companion,
            "intel": disable_intel, "critic": disable_critic}[name]()
