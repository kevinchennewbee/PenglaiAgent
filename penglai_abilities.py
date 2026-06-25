# -*- coding: utf-8 -*-
"""penglai_abilities — 装机后补开向导里没开的蓬莱能力（语音/主动陪伴/情报矩阵）。

向导(penglai setup)第一次没开的能力，事后用 `penglai enable <能力>` 补开，
不必重跑整个向导。与渠道共用 enable 入口（penglai CLI 按名字分发到这里或渠道矩阵）。

  penglai enable voice      装 sherpa-onnx + ffmpeg + SenseVoice 模型（语音转写+情绪）
  penglai enable tts        检查 MOSS-TTS-Nano 本地语音输出（说话/语音条）
  penglai enable companion  开启主动陪伴（独立心跳进程，门禁守护）
  penglai enable intel      配置情报矩阵（多源搜索交叉验证）
  penglai disable <能力>    关闭
  penglai abilities         能力总览（已开/未开 + 开启命令）

诚实纪律：只报告可证实的状态；装一半/缺依赖如实说，并给出下一步命令。
"""
import json
import os
import subprocess
import sys
import time
import uuid

ROOT = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, ROOT)
OK, BAD, WARN = "✅", "❌", "⚠️ "

ABILITIES = ("voice", "tts", "companion", "intel", "critic")

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
def _ffmpeg_bin():
    import shutil
    p = shutil.which("ffmpeg")
    if p:
        return p
    for cand in ("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg",
                 "/usr/bin/ffmpeg", "/opt/local/bin/ffmpeg"):
        if os.path.isfile(cand) and os.access(cand, os.X_OK):
            return cand
    return None


def _voice_ready():
    pc = _pc()
    mdir = os.path.join(os.environ.get("PENGLAI_MODEL_DIR", os.path.expanduser("~/penglai-models")),
                        "sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17")
    model = all(os.path.isfile(os.path.join(mdir, name)) for name in ("model.int8.onnx", "tokens.txt"))
    engine = pc.sh([pc.venv_python(), "-c", "import sherpa_onnx"]).returncode == 0
    ffmpeg = _ffmpeg_bin() is not None
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


def _fmt_age(ts):
    try:
        delta = max(0, int(time.time() - float(ts)))
    except Exception:
        return "无记录"
    if delta < 60:
        return f"{delta}秒前"
    if delta < 3600:
        return f"{delta // 60}分钟前"
    if delta < 86400:
        return f"{delta // 3600}小时前"
    return f"{delta // 86400}天前"


def _companion_state():
    path = os.path.join(ROOT, "temp", "companion_state.json")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


_COMPANION_REASON = {
    "disabled": "开关关闭",
    "no_target": "没有可投递的飞书/微信目标",
    "quiet_hours": "勿扰时段",
    "emotion_wait_user_idle": "有情绪信号，但用户刚活跃，先让路",
    "emotion_pending": "情绪承接正在处理中",
    "morning_done": "今天晨间锚点已发送",
    "morning_wait_user_idle": "晨间锚点在等用户停下手头输入",
    "morning_pending": "晨间锚点正在处理中",
    "evening_done": "今天晚间锚点已发送",
    "evening_wait_user_idle": "晚间锚点在等用户停下手头输入",
    "evening_pending": "晚间锚点正在处理中",
    "free_cooldown": "自由陪伴冷却中",
    "free_wait_user_idle": "自由陪伴在等用户空闲",
    "free_pending": "自由陪伴正在处理中",
    "cooldown_or_active": "冷却或用户活跃",
    "ok": "已触发",
}


def _companion_detail_line():
    st = _companion_state()
    if not st:
        return "最近心跳：尚无记录（服务刚启用或还没跑到第一次 10 分钟心跳）"
    reason = _COMPANION_REASON.get(st.get("last_reason", ""), st.get("last_reason", ""))
    parts = [f"最近心跳：{_fmt_age(st.get('last_check_ts'))}"]
    if reason:
        parts.append(f"原因：{reason}")
    if st.get("last_mode"):
        parts.append(f"模式：{st.get('last_mode')}")
    if st.get("last_idle_min") is not None:
        parts.append(f"用户空闲约 {st.get('last_idle_min')} 分钟")
    result = st.get("last_result")
    if result == "sent":
        parts.append(f"最近发送：{_fmt_age(st.get('last_sent_ts'))}（{'+'.join(st.get('last_sent_channels') or [])}）")
    elif result == "silent":
        parts.append(f"最近沉默：{_fmt_age(st.get('last_silent_ts'))}（模型选择不打扰）")
    elif result == "failed":
        parts.append(f"最近失败：{_fmt_age(st.get('last_error_ts'))}（{st.get('last_error', '')}）")
    return "；".join(parts)


def _load_json_file(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _critic_detail_line():
    st = _load_json_file(os.path.join(ROOT, "temp", "critic_state.json"))
    if not st:
        return "最近复核：尚无记录（只在长期记忆写入路径触发）"
    result = st.get("last_result", "")
    hits = st.get("last_hits") or []
    last_ts = st.get("last_check_ts") or st.get("last_review_ts")
    result = result or st.get("last_review_result", "")
    text = f"最近复核：{_fmt_age(last_ts)}；结果：{result or 'unknown'}"
    if hits:
        text += f"；命中：{','.join(hits)}"
    if st.get("last_review"):
        text += "；有异厂商意见"
    if st.get("last_review_model"):
        text += f"；模型：{st.get('last_review_model')}"
    if st.get("main_vendor") and st.get("critic_vendor"):
        text += f"；厂商：{st.get('main_vendor')}→{st.get('critic_vendor')}"
    if st.get("last_review_skipped"):
        text += f"；跳过：{st.get('last_review_skipped')}"
    return text


def _memory_detail_line():
    l2 = os.path.join(ROOT, "memory", "global_mem.txt")
    l1 = os.path.join(ROOT, "memory", "global_mem_insight.txt")
    l2_lines = 0
    try:
        l2_lines = sum(1 for _ in open(l2, encoding="utf-8", errors="replace"))
    except Exception:
        pass
    try:
        insight = open(l1, encoding="utf-8", errors="replace").read()
    except Exception:
        insight = ""
    flags = []
    if l2_lines > 6 and ("L2: 现空" in insight or "L2：现空" in insight):
        flags.append("L1 仍写 L2 现空，需刷新索引")
    if not insight.strip():
        flags.append("L1 索引为空")
    return f"L2 {l2_lines or 0} 行；" + ("；".join(flags) if flags else "L1/L2 基本一致")


def _intel_sources():
    pc = _pc()
    return [k for k in ("tinyfish_key", "tavily_key", "firecrawl_key") if pc.mykey_get(k)]


def _vision_ready():
    return os.path.exists(os.path.join(ROOT, "memory", "vision_api.py"))


def _select_oai_config_key(configs):
    """Pick the main OAI-compatible model config without exposing secrets."""
    candidates = []
    for key, cfg in sorted((configs or {}).items()):
        if not isinstance(cfg, dict):
            continue
        if not all(cfg.get(name) for name in ("apibase", "apikey", "model")):
            continue
        lower = str(key).lower()
        if lower.startswith("critic") or "critic" in lower:
            continue
        if str(key) == "native_oai_config":
            score = 100
        elif lower.endswith("_native_oai_config"):
            score = 90
        elif lower.endswith("oai_config") or "oai_config" in lower:
            score = 80
        else:
            score = 10
        candidates.append((score, str(key)))
    return max(candidates)[1] if candidates else ""


def _oai_config_inventory():
    pc = _pc()
    code = (
        "import json, mykey\n"
        "items={}\n"
        "for k,v in vars(mykey).items():\n"
        "    if k.startswith('_') or not isinstance(v, dict):\n"
        "        continue\n"
        "    items[k]={\n"
        "        'apibase': bool(v.get('apibase')),\n"
        "        'apikey': bool(v.get('apikey')),\n"
        "        'model': bool(v.get('model')),\n"
        "        'name': str(v.get('name') or ''),\n"
        "    }\n"
        "print(json.dumps(items, ensure_ascii=False))\n"
    )
    r = pc.sh([pc.venv_python(), "-c", code], cwd=ROOT)
    try:
        return json.loads((r.stdout or "{}").strip() or "{}")
    except Exception:
        return {}


def _active_oai_config_key():
    return _select_oai_config_key(_oai_config_inventory())


def _repair_vision_api(path):
    """Best-effort repair for user-generated memory/vision_api.py from older templates."""
    try:
        src = open(path, encoding="utf-8").read()
    except Exception:
        return "exists"
    changed = False
    old = "apibase.rstrip('/') + '/v1/chat/completions'"
    if "import base64, requests" in src:
        src = src.replace("import base64, requests", "import base64, re, requests", 1)
        changed = True
    elif "import re" not in src:
        src = "import re\n" + src
        changed = True
    if old in src:
        src = src.replace(old, "_chat_completions_url(apibase)")
        changed = True
    if "_clean_vision_text(" not in src:
        for old_return in (
            "return resp.json()['content'][0]['text']",
            "return resp.json()['choices'][0]['message']['content']",
        ):
            src = src.replace(old_return, old_return.replace("return ", "return _clean_vision_text(") + ")")
        marker = "\ndef _call_claude("
        helper = (
            "\n\ndef _clean_vision_text(text):\n"
            "    return re.sub(r\"<think>.*?</think>\\s*\", \"\", str(text or \"\"), flags=re.S).strip()\n"
        )
        src = src.replace(marker, helper + marker, 1) if marker in src else src + helper
        changed = True
    if old in src and "def _chat_completions_url(apibase):" not in src:
        # Kept for defensive clarity; normal path already replaced `old`.
        changed = True
    if "_chat_completions_url(apibase)" in src and "def _chat_completions_url(apibase):" not in src:
        marker = "\nif __name__ == '__main__':"
        helper = (
            "\n\ndef _chat_completions_url(apibase):\n"
            "    base = (apibase or '').rstrip('/')\n"
            "    if re.search(r'/v\\d+$', base):\n"
            "        return base + '/chat/completions'\n"
            "    return base + '/v1/chat/completions'\n"
        )
        src = src.replace(marker, helper + marker, 1) if marker in src else src + helper
        changed = True
    if not changed:
        return "exists"
    try:
        with open(path, "w", encoding="utf-8") as f:
            f.write(src)
        return "repaired"
    except Exception:
        return "exists"


def build_vision_api():
    """从 GA 的 vision_api.template.py 构建 memory/vision_api.py 并配到主力 OAI 兼容模型，
    让 ask_vision(img, backend='openai') 把图按 image_url 喂给主力多模态模型(如 M3)看图——补 U4/F7
    『IM 发来的图看不到』。GA 模板零改动；vision_api.py 是用户配置产物(同 mykey.py)，已存在不覆盖。
    返回 built / exists / skip（无 OAI 兼容主力模型）/ no_template。"""
    mem = os.path.join(ROOT, "memory")
    tmpl = os.path.join(mem, "vision_api.template.py")
    out = os.path.join(mem, "vision_api.py")
    if not os.path.exists(tmpl):
        return "no_template"
    if os.path.exists(out):
        return _repair_vision_api(out)
    config_key = _active_oai_config_key()
    if not config_key:
        return "skip"
    try:
        src = open(tmpl, encoding="utf-8").read()
        src = src.replace("OPENAI_CONFIG_KEY = 'oai_config1'", f"OPENAI_CONFIG_KEY = '{config_key}'")
        src = src.replace("DEFAULT_BACKEND = 'claude'", "DEFAULT_BACKEND = 'openai'")
        with open(out, "w", encoding="utf-8") as f:
            f.write(src)
        _repair_vision_api(out)
        return "built"
    except Exception:
        return "no_template"


def _load_mykey_dict():
    try:
        import llmcore
        return llmcore.reload_mykeys()[0] or {}
    except Exception:
        try:
            import mykey
            return {k: v for k, v in vars(mykey).items() if not k.startswith("_")}
        except Exception:
            return {}


def _deliver_owner_text(text, *, mk=None):
    mk = mk or _load_mykey_dict()
    try:
        import reflect.penglai_companion as cp
    except Exception as exc:
        return [], [f"companion_send_import_failed: {exc}"]
    sent = False
    channels = []
    errors = []
    users = mk.get("fs_allowed_users", []) or []
    owner = (mk.get("fs_owner_open_id", "") or "").strip()
    if not owner and users:
        owner = str(users[0]).strip()
    app_id, secret = mk.get("fs_app_id", ""), mk.get("fs_app_secret", "")
    if owner and app_id:
        try:
            ok = cp._feishu_send({"open_id": owner, "app_id": app_id,
                                  "app_secret": secret}, text)
            if ok:
                channels.append("feishu")
                sent = True
            else:
                errors.append("feishu_send_failed")
        except Exception as exc:
            errors.append(f"feishu_send_error: {exc}")
    if os.path.exists(os.path.expanduser("~/.wxbot/token.json")):
        try:
            ok = cp._wechat_send(text)
            if ok:
                channels.append("wechat")
                sent = True
            else:
                errors.append("wechat_send_failed")
        except Exception as exc:
            errors.append(f"wechat_send_error: {exc}")
    if not sent and not errors:
        errors.append("no_owner_delivery_target")
    return channels, errors


def notify_owner(text, *, service=None, store_path=None, context_log_path=None, send_text=None):
    """给主人发一条 IM（飞书 + 微信），并作为 Runtime Hub 服务事件落账。

    任何蓬莱进程 / agent 手写脚本都可复用：
        from penglai_abilities import notify_owner; notify_owner("...")
    未配 IM 或投递失败时返回 False，调用方勿当异常。
    """
    body = str(text or "").strip()
    if not body:
        return False
    try:
        from penglai_runtime.context_events import default_context_log_path
        from penglai_runtime.contracts import InboundEvent
        from penglai_runtime.delivery import DeliveryService
        from penglai_runtime.port import CallableAgentPort
        from penglai_runtime.runner import AgentRunner
        from penglai_runtime.service import RuntimeHubService
    except Exception:
        return False

    state = {"channels": [], "errors": []}

    def _send_text(payload):
        if callable(send_text):
            try:
                ok = bool(send_text(payload))
            except Exception as exc:
                state["errors"].append(f"custom_send_error: {exc}")
                return False
            if ok:
                state["channels"].append("custom")
            else:
                state["errors"].append("custom_send_failed")
            return ok
        channels, errors = _deliver_owner_text(payload)
        state["channels"].extend(channels)
        state["errors"].extend(errors)
        return bool(channels)

    if service is None:
        runner = AgentRunner(
            owner_user_ids={"owner"},
            delivery=DeliveryService(send_text=_send_text),
        )
        service = RuntimeHubService(
            owner_user_ids={"owner"},
            runner=runner,
            store_path=store_path,
            context_log_path=context_log_path or default_context_log_path(),
        )
    event = InboundEvent(
        event_id=f"notify_owner_{int(time.time())}_{uuid.uuid4().hex[:10]}",
        channel="notify_owner",
        user_id="owner",
        chat_id="owner",
        chat_type="private",
        text="[通知主人]",
        metadata={"service": "notify_owner"},
    )
    result = service.receive_blocking(
        event,
        port=CallableAgentPort(lambda _event, _body=body: _body, worker_id="notify-owner"),
        send_body=True,
        send_notice=False,
        fail_on_delivery_failure=True,
    )
    result.task_run.metadata["notify_owner"] = {
        "delivery_status": "sent" if state["channels"] else "failed",
        "channels": list(dict.fromkeys(state["channels"])),
        "errors": state["errors"][:5],
    }
    service.store.record_run(result.task_run)
    return result.task_run.status == "succeeded" and bool(state["channels"])


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
    env_xml = f'<key>PATH</key><string>{path_env}</string>' \
              f'<key>HOME</key><string>{_x(os.path.expanduser("~"))}</string>'
    for key in ("PENGLAI_RUNTIME_HUB", "PENGLAI_RUNTIME_HUB_SHADOW"):
        if key in os.environ:
            env_xml += f"<key>{key}</key><string>{_x(os.environ.get(key, ''))}</string>"
    plist = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" '
        '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n'
        '<plist version="1.0"><dict>\n'
        f'  <key>Label</key><string>{label_id}</string>\n'
        f'  <key>ProgramArguments</key><array>{args_xml}</array>\n'
        f'  <key>WorkingDirectory</key><string>{_x(ROOT)}</string>\n'
        f'  <key>EnvironmentVariables</key><dict>{env_xml}</dict>\n'
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


def reflect_systemd_unit(service, reflect_py, label, *, root=None, python=None, user=None, home=None):
    root = os.path.realpath(root or ROOT)
    pc = _pc()
    python = python or pc.venv_python()
    user = user or os.environ.get("USER", "root")
    home = home or os.path.expanduser("~")
    env_sh = os.path.join(root, "env.sh")
    work = os.path.join(home, "penglai-work")
    guard = (
        f"ExecStartPre=/bin/bash -lc 'source {env_sh} 2>/dev/null || true; "
        f"{python} {root}/penglai _guardcheck'\n"
    )
    cmd = f"{python} {root}/agentmain.py --reflect {root}/{reflect_py}"
    return (
        f"[Unit]\nDescription=Penglai {label}\nAfter=network-online.target\n\n"
        f"[Service]\nType=simple\nUser={user}\n"
        f"WorkingDirectory={root}\nEnvironment=HOME={home}\n"
        f"Environment=GA_WORKSPACE_ROOT={work}\n{guard}"
        f"ExecStart=/bin/bash -lc 'source {env_sh} 2>/dev/null || true; exec {cmd}'\n"
        f"Restart=always\nRestartSec=20\n\n[Install]\nWantedBy=multi-user.target\n"
    )


def _install_reflect_service(service, reflect_py, label):
    pc = _pc()
    if not pc.has_systemd():
        if sys.platform == "darwin":
            return _install_launchd(service, reflect_py, label)
        # 非 macOS 又无 systemd：nohup 起后台心跳（尽力，无守护，崩溃不自动重启）
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
    unit = reflect_systemd_unit(service, reflect_py, label, python=pc.venv_python())
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


def enable_tts():
    from penglai_runtime import tts_service
    from penglai_runtime.capabilities import tts_runtime_status
    st = tts_runtime_status()
    print(st.get("detail") or "语音输出：状态未知")
    if st.get("ready"):
        print(f"{OK} MOSS-TTS-Nano 本地语音输出已就绪。")
        return 0
    print(f"{WARN} MOSS-TTS-Nano 还未就绪。缺：{','.join(st.get('missing') or []) or '未知'}")
    print("     官方源码目录：", st.get("repo_dir"))
    print("     ONNX 模型目录：", st.get("model_dir"))
    print("     现在开始安装依赖、下载 ONNX 权重，并做中英本地 CPU 合成 smoke。")
    result = tts_service.ensure_ready(stream=True, update_repo=False, run_smoke_check=True)
    final = result.get("status") or tts_runtime_status()
    print(final.get("detail") or "语音输出：状态未知")
    smoke = (result.get("smoke") or {}).get("results") or []
    for item in smoke:
        if item.get("ok"):
            audio = item.get("audio") or {}
            print(f"{OK} {item.get('lang')} smoke: {audio.get('path')} ({audio.get('sample_rate')}Hz, {audio.get('channels')}ch, {audio.get('seconds')}s)")
        else:
            print(f"{BAD} {item.get('lang', '?')} smoke 失败：{item.get('error')}")
    if result.get("ok") and final.get("ready"):
        print(f"{OK} MOSS-TTS-Nano ONNX CPU 本地语音输出已就绪。")
        return 0
    print(f"{BAD} MOSS-TTS-Nano 安装/验证未完成，阶段：{result.get('stage')}")
    return 1


def disable_tts():
    print(f"{WARN} 语音输出是工具能力（无常驻进程），无需停用；"
          "如要省盘可手动删 ~/penglai-models/ 下的 MOSS-TTS-Nano 模型目录。")
    return 0


# ---------- 主动陪伴 ----------
def enable_companion():
    pc = _pc()
    if _companion_running():   # 按进程实判（launchd/systemd/pgrep），不只看旗标——死了就重装守护
        print(f"{OK} 主动陪伴已在运行。"); return 0
    print("  💞 开启主动陪伴：独立心跳进程，门禁守护（默认勿扰 22-8 点、自由陪伴最短间隔 4 小时），")
    print("     默认 present 模式：天气/语音情绪/早晚锚点过门禁后会给一句短消息；久未联系仍谨慎判断。")
    print("     是蓬莱第一个有持续 token 成本的功能（一天约几分钱）。")
    if not _ask("现在开启？(y/n)", "y").lower().startswith("y"):
        return 0
    keys = {"companion_enabled": True, "companion_mode": "present"}
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
    """主力模型的厂商显示名（向导写入 mykey 的 name，如 DeepSeek / MiniMax）。"""
    inventory = _oai_config_inventory()
    key = _select_oai_config_key(inventory)
    return str((inventory.get(key) or {}).get("name") or "")


def _critic_on():
    pc = _pc()
    r = pc.sh([pc.venv_python(), "-c",
               "import json;"
               "from penglai_runtime.capabilities import critic_runtime_status;"
               "print(json.dumps(critic_runtime_status(), ensure_ascii=False))"], cwd=ROOT)
    try:
        return bool(json.loads((r.stdout or "{}").strip() or "{}").get("ready"))
    except Exception:
        return False


def _critic_status():
    pc = _pc()
    r = pc.sh([pc.venv_python(), "-c",
               "import json;"
               "from penglai_runtime.capabilities import critic_runtime_status;"
               "print(json.dumps(critic_runtime_status(), ensure_ascii=False))"], cwd=ROOT)
    try:
        return json.loads((r.stdout or "{}").strip() or "{}")
    except Exception:
        return {"ready": False, "detail": "批判脑：状态检查不可用", "status": "unknown"}


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
    critic = _critic_status()
    try:
        from penglai_runtime.capabilities import tts_runtime_status
        tts = tts_runtime_status()
    except Exception:
        tts = {"ready": False, "detail": "语音输出：状态未知"}
    rows = [
        ("🎙️ 语音转写+情绪", vr,
         "就绪（SenseVoice 本地）" if vr else f"未装齐（缺 {'/'.join(n for n, ok in (('模型', vm), ('引擎', ve), ('ffmpeg', vf)) if not ok)}）",
         "penglai enable voice"),
        ("🔊 语音输出", bool(tts.get("ready")),
         tts.get("detail") or "语音输出：状态未知",
         "penglai enable tts"),
        ("💞 主动陪伴", comp_mark, comp_state, "penglai enable companion"),
        ("🔭 情报矩阵", bool(intel),
         f"已配 {len(intel)} 个源" if intel else "默认（GA 浏览器搜索）",
         "penglai enable intel"),
        ("🧐 批判脑", bool(critic.get("ready")),
         critic.get("detail") or "批判脑：仅本地绊线（免费常开）；异厂商复核未配",
         "penglai enable critic"),
    ]
    for label, on, state, cmd in rows:
        mark = {True: OK, False: "○"}.get(on, "⚠️")   # on=True/False/'warn'(开着但心跳没跑)
        action = "检查/配置" if label.startswith("🔊") else "开启"
        tail = f"   → {action}：{cmd}" if on is False else ""
        print(f"  {mark} {label:<16} {state}{tail}")
        if label.startswith("💞") and comp_on:
            print(f"      {_companion_detail_line()}")
        if label.startswith("🧐"):
            print(f"      {_critic_detail_line()}")
    print("\n  🧠 长期记忆 — 内核标配，已自动启用（无需开关）")
    print(f"      {_memory_detail_line()}")
    print("  ⏰ 提醒/日程 — 内核标配，已自动启用（说「X点提醒我做Y」即可）")
    print("  🌤️ 天气查询 — 内核标配，已自动启用（免 key）")
    print("  🔗 网页/文章总结 — 内核标配，已自动启用（发链接说「帮我总结」即可）")
    print("  🛡️ 红线/记忆卫生/出站文件白名单（Runtime Hub/IM 交付层）— 出厂常开（确定性防线，不可关）")
    print("\n  加 IM 渠道：penglai enable <dingtalk|qq|telegram|discord|wecom> · 渠道总览：penglai channels")
    return 0


# ---------- CLI 分发（由 penglai 脚本调用）----------
def enable(name):
    return {"voice": enable_voice, "tts": enable_tts, "companion": enable_companion,
            "intel": enable_intel, "critic": enable_critic}[name]()


def disable(name):
    return {"voice": disable_voice, "tts": disable_tts, "companion": disable_companion,
            "intel": disable_intel, "critic": disable_critic}[name]()
