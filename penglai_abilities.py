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

ABILITIES = ("voice", "companion", "intel")


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


def _intel_sources():
    pc = _pc()
    return [k for k in ("tinyfish_key", "tavily_key", "firecrawl_key") if pc.mykey_get(k)]


# ---------- 通用 systemd 服务安装（reflect 心跳类）----------
def _install_reflect_service(service, reflect_py, label):
    pc = _pc()
    if not pc.has_systemd():
        # 非 systemd（容器/macOS）：nohup 起后台心跳进程
        os.makedirs(os.path.join(ROOT, "temp"), exist_ok=True)
        log = open(os.path.join(ROOT, "temp", f"{service}.log"), "ab")
        subprocess.Popen([pc.venv_python(), os.path.join(ROOT, "agentmain.py"),
                          "--reflect", os.path.join(ROOT, reflect_py)],
                         cwd=ROOT, stdout=log, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, start_new_session=True)
        print(f"{OK} {label} 已后台启动（非 systemd 环境，日志 temp/{service}.log）")
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
    if _companion_on() and (not pc.has_systemd()
                            or pc.sh(["systemctl", "is-active", "penglai-companion"]).stdout.strip() == "active"):
        print(f"{OK} 主动陪伴已在运行。"); return 0
    print("  💞 开启主动陪伴：独立心跳进程，门禁守护（默认勿扰 22-8 点、最短间隔 4 小时），")
    print("     偶尔主动联系你。是蓬莱第一个有持续 token 成本的功能（一天约几分钱）。")
    if not _ask("现在开启？(y/n)", "y").lower().startswith("y"):
        return 0
    pc.mykey_set({"companion_enabled": True})
    print(f"{OK} 已写入 companion_enabled=True（可后续在 mykey.py 调勿扰时段/间隔）")
    return 0 if _install_reflect_service("penglai-companion", "reflect/penglai_companion.py", "主动陪伴") else 1


def disable_companion():
    pc = _pc()
    pc.mykey_set({"companion_enabled": False})
    if pc.has_systemd():
        pc.sh(["sudo", "systemctl", "disable", "--now", "penglai-companion"])
        pc.sh(["sudo", "rm", "-f", "/etc/systemd/system/penglai-companion.service"])
        pc.sh(["sudo", "systemctl", "daemon-reload"])
    else:
        pc.sh(["pkill", "-f", "reflect/penglai_companion.py"])
    print(f"{OK} 主动陪伴已关闭。")
    return 0


# ---------- 情报矩阵 ----------
def enable_intel():
    pc = _pc()
    cur = _intel_sources()
    if cur:
        print(f"{OK} 情报矩阵已配置 {len(cur)} 个源：{', '.join(cur)}")
        if not _ask("重新配置？(y/N)", "n").lower().startswith("y"):
            return 0
    print("  🔭 情报矩阵：多个独立搜索 API 并查 + 交叉验证，更适合事实核查/写记忆/做决策。")
    print("  推荐 TinyFish（免费、自有索引）：https://agent.tinyfish.ai/api-keys ，回车跳过")
    pairs = {}
    if k := _ask("TinyFish API Key（X-API-Key，可空）"): pairs["tinyfish_key"] = k
    if k := _ask("Tavily API Key（免费额度，可空）"):    pairs["tavily_key"] = k
    if k := _ask("Firecrawl API Key（可空）"):           pairs["firecrawl_key"] = k
    if not pairs:
        print("  未填任何 key，保持默认（GA 自带浏览器搜索）。"); return 0
    pc.mykey_set(pairs)
    print(f"{OK} 情报矩阵：{len(pairs)} 个源已写入 mykey.py（重启服务后生效：penglai restart）")
    return 0


def disable_intel():
    print(f"{WARN} 删除情报源请手动编辑 mykey.py 移除 tinyfish_key/tavily_key/firecrawl_key 行，"
          "然后 penglai restart。")
    return 0


# ---------- 总览 ----------
def status():
    print("🏮 蓬莱能力总览（装完后可随时补开）\n")
    vr, (vm, ve, vf) = _voice_ready()
    rows = [
        ("🎙️ 语音转写+情绪", vr,
         "就绪（SenseVoice 本地）" if vr else f"未装齐（缺 {'/'.join(n for n, ok in (('模型', vm), ('引擎', ve), ('ffmpeg', vf)) if not ok)}）",
         "penglai enable voice"),
        ("💞 主动陪伴", _companion_on(),
         "已开启" if _companion_on() else "未开启（零成本，被动回复）",
         "penglai enable companion"),
        ("🔭 情报矩阵", bool(_intel_sources()),
         f"已配 {len(_intel_sources())} 个源" if _intel_sources() else "默认（GA 浏览器搜索）",
         "penglai enable intel"),
    ]
    for label, on, state, cmd in rows:
        mark = OK if on else "○"
        tail = "" if on else f"   → 开启：{cmd}"
        print(f"  {mark} {label:<16} {state}{tail}")
    print("\n  🧠 长期记忆 — 内核标配，已自动启用（无需开关）")
    print("  🛡️ 红线/记忆卫生/出站文件白名单 — 出厂常开（确定性防线，不可关）")
    print("\n  加 IM 渠道：penglai enable <dingtalk|qq|telegram|discord|wecom> · 渠道总览：penglai channels")
    return 0


# ---------- CLI 分发（由 penglai 脚本调用）----------
def enable(name):
    return {"voice": enable_voice, "companion": enable_companion, "intel": enable_intel}[name]()


def disable(name):
    return {"voice": disable_voice, "companion": disable_companion, "intel": disable_intel}[name]()
