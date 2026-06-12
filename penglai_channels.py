# -*- coding: utf-8 -*-
"""penglai_channels — 蓬莱渠道封装（IM 矩阵，内核零改动）。

GA 内核自带 7 个 IM 前端（frontends/*.py），蓬莱层在此之上提供统一的
启用/停用/状态管理：依赖安装 → 凭证获取（钉钉/QQ 支持扫码自动建应用，
参考 Hermes Agent 的官方设备码注册流）→ 写入 mykey → 服务安装 → 启动取证。

诚实纪律：本模块只报告可证实的事实——"进程已启动"≠"平台已连通"，
连通与否以用户真实发消息 + 日志为准（飞书/微信在向导里有完整验证闭环，
其余渠道由用户实测后反馈）。

用法（由 penglai CLI 分发）：
  penglai channels            渠道总览（凭证/依赖/运行状态/实测状态）
  penglai enable <渠道>       启用：dingtalk|wecom|qq|telegram|discord
  penglai disable <渠道>      停用并卸载服务
"""
import os, re, subprocess, sys, time

ROOT = os.path.dirname(os.path.abspath(__file__))
OK, BAD, WARN = "✅", "❌", "⚠️ "

# 渠道注册表：上游脚本 / 服务名 / pip 依赖(import名) / mykey 凭证键 / 白名单键
# tested=True 表示蓬莱在腾讯云真机实测过；False=内核自带、封装可用、等待实测
CHANNELS = {
    "feishu":   dict(label="飞书",     script="fsapp.py",        service="penglai-feishu",
                     pip={}, keys=[], allow="fs_allowed_users", tested=True,
                     note="主渠道，penglai setup 向导扫码建应用 + 连接验证闭环"),
    "wechat":   dict(label="微信",     script="wechatapp.py",    service="penglai-wechat",
                     pip={}, keys=[], allow=None, tested=True,
                     note="penglai setup 向导扫码登录（iLink，token 存 ~/.wxbot/）"),
    "dingtalk": dict(label="钉钉",     script="dingtalkapp.py",  service="penglai-dingtalk",
                     pip={"dingtalk-stream": "dingtalk_stream"},
                     keys=["dingtalk_client_id", "dingtalk_client_secret"],
                     allow="dingtalk_allowed_users", tested=False, qr="dingtalk",
                     guide=["自动：钉钉 App 扫码授权，平台自动创建机器人应用（含 AppKey/Secret）",
                            "手动：open-dev.dingtalk.com → 创建应用 → 凭证页抄 AppKey/AppSecret",
                            "     → 机器人设置里开启 Stream 模式"]),
    "wecom":    dict(label="企业微信", script="wecomapp.py",     service="penglai-wecom2",
                     pip={"wecom-aibot-sdk": "wecom_aibot_sdk"},
                     keys=["wecom_bot_id", "wecom_secret"],
                     allow="wecom_allowed_users", tested=False,
                     guide=["企业微信管理后台 → 应用管理 → 创建「智能机器人」",
                            "在机器人凭证页抄 Bot ID 与 Secret（WebSocket 直连，无需公网回调）",
                            "⚠️ 上游已知问题：媒体消息文件名路径穿越（已记上游 PR 候选），",
                            "   白名单生效前请勿把机器人开放给陌生人"]),
    "qq":       dict(label="QQ",       script="qqapp.py",        service="penglai-qq",
                     # pycryptodome 是扫码绑定解密 secret 的硬依赖（AES-256-GCM）——
                     # 缺它则扫码成功也在最后一步解密崩掉（2026-06-12 用户实测踩坑）
                     pip={"qq-botpy": "botpy", "pycryptodome": "Crypto"},
                     keys=["qq_app_id", "qq_app_secret"],
                     allow="qq_allowed_users", tested=False, qr="qq",
                     guide=["自动：手机 QQ 扫码绑定，自动创建机器人并取回凭证",
                            "手动：q.qq.com 注册机器人应用，抄 App ID / App Secret"]),
    "telegram": dict(label="Telegram", script="tgapp.py",        service="penglai-telegram",
                     pip={"python-telegram-bot>=20": "telegram"},
                     keys=["tg_bot_token"],
                     allow="tg_allowed_users", tested=False, allow_int=True,
                     guide=["Telegram 里找 @BotFather → 发送 /newbot → 起名",
                            "把 BotFather 给的 bot token 贴进来即可（需可访问 api.telegram.org）"]),
    "discord":  dict(label="Discord",  script="dcapp.py",        service="penglai-discord",
                     pip={"discord.py": "discord"},
                     keys=["discord_bot_token"],
                     allow="discord_allowed_users", tested=False,
                     guide=["discord.com/developers/applications → New Application",
                            "Bot 页 → Reset Token → 抄 bot token；并开启 MESSAGE CONTENT intent",
                            "（需可访问 discord.com gateway）"]),
}

EXTRA = [k for k, v in CHANNELS.items() if not v["tested"]]  # 可 enable 的渠道


def sh(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def venv_python():
    p = os.path.join(ROOT, ".venv", "bin", "python")
    return p if os.path.exists(p) else sys.executable


def has_systemd():
    import shutil
    return shutil.which("systemctl") is not None


def ask(q, default=""):
    try:
        v = input(f"{q} ").strip()
        return v or default
    except EOFError:
        return default


# ---------- 扫码建应用（移植自 Hermes Agent 的官方设备码/绑定流，纯 requests）----------

def _qr_print(url):
    """终端打出二维码；qrcode 库缺失则降级为可点击链接。"""
    try:
        import qrcode
        q = qrcode.QRCode(border=1)
        q.add_data(url); q.make(fit=True)
        q.print_ascii(invert=True)
        return True
    except Exception:
        print(f"  （终端二维码不可用，请手机打开此链接确认）\n  {url}")
        return False


def dingtalk_qr():
    """钉钉官方设备码注册流：init→begin 出码→手机钉钉扫码授权→poll 取回凭证。
    返回 (client_id, client_secret) 或 None（失败/超时转手动）。"""
    import requests
    base = os.environ.get("DINGTALK_REGISTRATION_BASE_URL", "https://oapi.dingtalk.com")
    src = os.environ.get("DINGTALK_REGISTRATION_SOURCE", "penglai")

    def post(path, payload):
        r = requests.post(base + path, json=payload, timeout=15)
        r.raise_for_status()
        d = r.json()
        if d.get("errcode", -1) != 0:
            raise RuntimeError(f"{path}: {d.get('errmsg', 'unknown')} (errcode={d.get('errcode')})")
        return d

    try:
        nonce = str(post("/app/registration/init", {"source": src}).get("nonce", "")).strip()
        beg = post("/app/registration/begin", {"nonce": nonce})
        code, url = beg.get("device_code", ""), beg.get("verification_uri_complete", "")
        if not (code and url):
            raise RuntimeError("begin 响应缺 device_code/verification_uri")
        print("\n  用【手机钉钉】扫码并确认授权（自动创建机器人应用）：")
        _qr_print(url)
        interval = max(int(beg.get("interval", 3)), 2)
        deadline = time.monotonic() + min(int(beg.get("expires_in", 600)), 600)
        while time.monotonic() < deadline:
            time.sleep(interval)
            st = post("/app/registration/poll", {"device_code": code})
            s = str(st.get("status", "")).upper()
            if s == "SUCCESS":
                cid, sec = st.get("client_id", ""), st.get("client_secret", "")
                if cid and sec:
                    print(f"{OK} 扫码成功，已自动取得凭证（Client ID: {cid[:8]}...）")
                    return cid, sec
                raise RuntimeError("授权成功但凭证为空")
            if s in ("FAIL", "EXPIRED"):
                raise RuntimeError(f"授权{s}: {st.get('fail_reason', '')}")
        print(f"{WARN}扫码超时")
    except Exception as e:
        print(f"{WARN}扫码流程失败（{e}），转手动模式")
    return None


_DECRYPT_SNIPPET = """\
import base64, json, sys
d = json.load(sys.stdin)
raw, key = base64.b64decode(d["ct"]), base64.b64decode(d["key"])
iv, body = raw[:12], raw[12:]
try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM
    out = AESGCM(key).decrypt(iv, body, None)
except ImportError:
    from Crypto.Cipher import AES
    c = AES.new(key, AES.MODE_GCM, nonce=iv)
    out = c.decrypt_and_verify(body[:-16], body[-16:])
sys.stdout.write(out.decode("utf-8"))
"""

def _aes_gcm_decrypt(b64ct, b64key):
    """AES-256-GCM 解密（IV12‖密文‖Tag16）。当前解释器缺库时借 venv 解
    （向导常跑在系统 python，pycryptodome 装在 venv 里）；密文/密钥走 stdin 不上命令行。"""
    import base64
    raw, key = base64.b64decode(b64ct), base64.b64decode(b64key)
    iv, body = raw[:12], raw[12:]
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        return AESGCM(key).decrypt(iv, body, None).decode("utf-8")
    except ImportError:
        pass
    try:
        from Crypto.Cipher import AES  # pycryptodome
        c = AES.new(key, AES.MODE_GCM, nonce=iv)
        return c.decrypt_and_verify(body[:-16], body[-16:]).decode("utf-8")
    except ImportError:
        pass
    import json as _json
    r = subprocess.run([venv_python(), "-c", _DECRYPT_SNIPPET],
                       input=_json.dumps({"ct": b64ct, "key": b64key}),
                       capture_output=True, text=True)
    if r.returncode == 0 and r.stdout:
        return r.stdout
    raise RuntimeError("AES 解密失败：当前 Python 与 venv 都缺 pycryptodome/cryptography"
                       f"（venv 报错: {(r.stderr or '').strip()[-80:]}）")


def qq_qr():
    """QQ 开放平台扫码绑定：create_bind_task 出码→手机 QQ 扫码→点「连接」→poll 取回凭证
    （client_secret 以本地生成的 AES-256-GCM 密钥加密传回，仅本机可解）。
    返回 (app_id, app_secret) 或 None。
    状态机（对齐 Hermes BindStatus）：0=等待扫码 1=已扫码待确认 2=绑定成功 3=二维码过期。
    每次状态变化都打到终端 —— 上一版黑盒 poll 让「点了连接没反应」无从排查（2026-06-12）。"""
    import base64, platform, requests
    host = os.environ.get("QQ_PORTAL_HOST", "q.qq.com")
    # UA 对齐 Hermes 实测可用的格式；q.qq.com 缺 Accept: application/json 会回反爬 JS 页
    pyv = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    hdr = {"Content-Type": "application/json", "Accept": "application/json",
           "User-Agent": f"QQBotAdapter/1.1.0 (Python/{pyv}; {platform.system().lower()}; Penglai/0.1)"}
    key = base64.b64encode(os.urandom(32)).decode()
    _ST = {0: "等待扫码", 1: "已扫码，请在手机上点「连接」", 2: "绑定成功", 3: "二维码已过期"}
    try:
        r = requests.post(f"https://{host}/lite/create_bind_task", json={"key": key},
                          headers=hdr, timeout=30)
        r.raise_for_status(); d = r.json()
        if d.get("retcode") != 0:
            raise RuntimeError(f"create_bind_task: {d.get('msg', '失败')} (retcode={d.get('retcode')})")
        task = d.get("data", {}).get("task_id", "")
        if not task:
            raise RuntimeError("create_bind_task 响应缺 task_id")
        from urllib.parse import quote
        url = f"https://{host}/qqbot/openclaw/connect.html?task_id={quote(task)}&_wv=2&source=penglai"
        print("\n  用【手机 QQ】扫码 → 选择/创建机器人 → 点「连接」：")
        _qr_print(url)
        last, deadline = -1, time.monotonic() + 600
        while time.monotonic() < deadline:
            time.sleep(2)
            try:
                r = requests.post(f"https://{host}/lite/poll_bind_result", json={"task_id": task},
                                  headers=hdr, timeout=30)
                r.raise_for_status(); d = r.json()
            except Exception as e:
                print(f"\n  {WARN}poll 请求异常（{e}），2 秒后重试"); continue
            if d.get("retcode") != 0:
                raise RuntimeError(f"poll_bind_result: {d.get('msg', '失败')} (retcode={d.get('retcode')})")
            data = d.get("data", {})
            s = int(data.get("status", 0))
            if s != last:
                print(("\n" if last >= 0 else "") + f"  ⏳ {_ST.get(s, f'未知状态 {s}')}", end="", flush=True)
                last = s
            else:
                print(".", end="", flush=True)
            if s == 2:
                print()
                appid = str(data.get("bot_appid", ""))
                enc = data.get("bot_encrypt_secret", "")
                if not (appid and enc):
                    raise RuntimeError(f"绑定成功但凭证为空（bot_appid={appid!r}）")
                try:
                    sec = _aes_gcm_decrypt(enc, key)
                except Exception as e:
                    raise RuntimeError(f"凭证解密失败：{e}。机器人已在 QQ 侧创建成功，"
                                       f"可到 q.qq.com 管理页拿 AppID/Secret 走手动模式")
                print(f"{OK} 扫码成功，已自动取得凭证（App ID: {appid}）")
                return appid, sec
            if s == 3:
                raise RuntimeError("二维码已过期，重新运行 penglai enable qq 再试")
        print(f"\n{WARN}扫码超时（10 分钟）。最后状态：{_ST.get(last, '未知')}")
    except Exception as e:
        print(f"{WARN}扫码流程失败：{e}")
        print(f"  {WARN}转手动模式。提示：若手机上已创建过机器人（如 機器人19xxx），"
              f"到 q.qq.com → 开发设置 即可拿到 AppID/AppSecret，无需重建")
    return None


# ---------- mykey 写入（先备份；已有键原位替换，新键追加块）----------

def mykey_set(pairs):
    path = os.path.join(ROOT, "mykey.py")
    txt = open(path, encoding="utf-8").read() if os.path.exists(path) else ""
    if txt:
        open(path + ".bak", "w", encoding="utf-8").write(txt)
    lines, done = txt.splitlines(), set()
    for i, l in enumerate(lines):
        m = re.match(r"^(\w+)\s*=", l)
        if m and m.group(1) in pairs:
            lines[i] = f"{m.group(1)} = {pairs[m.group(1)]!r}"
            done.add(m.group(1))
    rest = [k for k in pairs if k not in done]
    if rest:
        lines += ["", "# —— 蓬莱渠道配置（penglai enable 写入）——"]
        lines += [f"{k} = {pairs[k]!r}" for k in rest]
    open(path, "w", encoding="utf-8").write("\n".join(lines) + "\n")


def mykey_get(key):
    r = sh([venv_python(), "-c",
            f"import mykey;v=getattr(mykey,{key!r},None);print('SET' if v else '')"], cwd=ROOT)
    return (r.stdout or "").strip() == "SET"


# ---------- 进程/服务管理（generic 版，非 systemd 用 nohup + pgrep）----------

def proc_pids(script):
    r = sh(["pgrep", "-f", f"frontends/{script}"])
    return [int(x) for x in r.stdout.split()] if r.returncode == 0 else []


def logfile(ch):
    # 渠道 app 自己 redirect_log 到 temp/<name>.log（chatapp_common 约定）
    return os.path.join(ROOT, "temp", CHANNELS[ch]["script"].replace(".py", ".log"))


def log_tail(ch, n=6):
    lf = logfile(ch)
    if not os.path.exists(lf):
        return []
    return open(lf, encoding="utf-8", errors="replace").read().splitlines()[-n:]


def unit_install(ch):
    c = CHANNELS[ch]
    env_sh = os.path.join(ROOT, "env.sh")
    if not os.path.exists(env_sh):
        open(env_sh, "w").write(f'export PATH="{ROOT}/.venv/bin:$PATH"\n')
    work = os.path.expanduser("~/penglai-work"); os.makedirs(work, exist_ok=True)
    guard = (f"ExecStartPre=/bin/bash -lc 'source {env_sh} && "
             f"python {ROOT}/penglai _guardcheck'\n")
    cmd = f"python {ROOT}/frontends/{c['script']}"
    unit = (f"[Unit]\nDescription=Penglai {c['label']} channel\nAfter=network-online.target\n\n"
            f"[Service]\nType=simple\nUser={os.environ.get('USER', 'root')}\n"
            f"WorkingDirectory={ROOT}\nEnvironment=HOME={os.path.expanduser('~')}\n"
            f"Environment=GA_WORKSPACE_ROOT={work}\n{guard}"
            f"ExecStart=/bin/bash -lc 'source {env_sh} && exec {cmd}'\n"
            f"Restart=always\nRestartSec=20\n\n[Install]\nWantedBy=multi-user.target\n")
    try:
        subprocess.run(["sudo", "tee", f"/etc/systemd/system/{c['service']}.service"],
                       input=unit, text=True, check=True, stdout=subprocess.DEVNULL)
        subprocess.run(["sudo", "systemctl", "daemon-reload"], check=True)
        subprocess.run(["sudo", "systemctl", "enable", "--now", c["service"]], check=True)
        return True
    except subprocess.CalledProcessError:
        print(f"{BAD} 服务安装失败（sudo 权限？），可手动前台运行: "
              f".venv/bin/python frontends/{c['script']}")
        return False


def proc_start(ch):
    c = CHANNELS[ch]
    if pids := proc_pids(c["script"]):
        print(f"{OK} {c['label']} 进程已在运行（PID {pids[0]}）"); return True
    os.makedirs(os.path.join(ROOT, "temp"), exist_ok=True)
    # app 自己 redirect_log；这里只兜启动初期的 stdout
    lf = open(logfile(ch), "ab")
    p = subprocess.Popen([venv_python(), os.path.join(ROOT, "frontends", c["script"])],
                         cwd=ROOT, stdout=lf, stderr=subprocess.STDOUT,
                         stdin=subprocess.DEVNULL, start_new_session=True)
    time.sleep(8)
    if p.poll() is not None:
        print(f"{BAD} 进程启动后退出（码 {p.returncode}），最近日志：")
        for l in log_tail(ch):
            print("   " + l[:160])
        return False
    print(f"{WARN}进程已启动（PID {p.pid}）。注意：这只代表进程在跑，"
          f"平台是否连通请在 {c['label']} 里给机器人发条消息实测；"
          f"日志: penglai logs {ch}")
    return True


def proc_stop(ch):
    import signal
    c = CHANNELS[ch]
    pids = proc_pids(c["script"])
    for pid in pids:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
    print(f"{OK} {c['label']}: " + (f"已停止（PID {' '.join(map(str, pids))}）" if pids else "本就未在运行"))


# ---------- enable / disable / channels ----------

def enable(ch):
    if ch in ("feishu", "wechat"):
        print(f"飞书/微信请走完整向导（含连接验证闭环）：penglai setup"); return 0
    if ch not in EXTRA:
        print(f"未知渠道 {ch}，可选：{' '.join(EXTRA)}"); return 1
    c = CHANNELS[ch]
    print(f"\n—— 启用 {c['label']} 渠道（内核 frontends/{c['script']}，蓬莱层封装）——")
    if not c["tested"]:
        print(f"{WARN}此渠道蓬莱尚未真机实测（内核为 GA 上游自带），启用后请实测并反馈\n")

    # 1) 依赖
    for pkg, mod in c["pip"].items():
        if sh([venv_python(), "-c", f"import {mod}"]).returncode == 0:
            continue
        print(f"  安装依赖 {pkg} ...")
        r = subprocess.run(["uv", "pip", "install", "--python", venv_python(), pkg]) \
            if sh(["uv", "--version"]).returncode == 0 else \
            subprocess.run([venv_python(), "-m", "pip", "install", "-q", pkg])
        if r.returncode != 0 or sh([venv_python(), "-c", f"import {mod}"]).returncode != 0:
            print(f"{BAD} 依赖 {pkg} 安装失败，中止"); return 1

    # 2) 凭证（扫码优先，失败/拒绝转手动）
    if all(mykey_get(k) for k in c["keys"]):
        if not ask(f"  {c['label']} 凭证已存在，重新配置？(y/N)", "n").lower().startswith("y"):
            print("  沿用现有凭证")
            return _finish(ch)
    creds = None
    if c.get("qr") and ask("  扫码自动创建机器人应用？(Y/n)", "y").lower() != "n":
        creds = dingtalk_qr() if c["qr"] == "dingtalk" else qq_qr()
    if creds is None:
        print("\n  手动获取凭证：")
        for g in c["guide"]:
            print(f"   · {g}")
        vals = []
        for k in c["keys"]:
            v = ask(f"  {k} =")
            if not v:
                print(f"{BAD} 缺少 {k}，中止"); return 1
            vals.append(v)
        creds = tuple(vals)
    pairs = dict(zip(c["keys"], creds))

    # 3) 白名单（空 = 对所有人开放，上游 public_access 语义，必须警告）
    if c["allow"]:
        uid = ask(f"  你的 {c['label']} 用户 ID（强烈建议填，回车跳过=对所有人开放）:")
        if uid:
            pairs[c["allow"]] = [int(uid)] if c.get("allow_int") and uid.isdigit() else [uid]
        else:
            print(f"{WARN}白名单为空：任何能找到机器人的用户都能驱动本机 agent！"
                  f"实测拿到自己 ID 后，把 {c['allow']} = ['你的ID'] 写进 mykey.py")
    mykey_set(pairs)
    print(f"{OK} 凭证已写入 mykey.py（旧文件备份为 mykey.py.bak）")
    return _finish(ch)


def _finish(ch):
    c = CHANNELS[ch]
    if has_systemd():
        if unit_install(ch):
            time.sleep(5)
            st = sh(["systemctl", "is-active", c["service"]]).stdout.strip()
            print(f"{OK if st == 'active' else BAD} 服务 {c['service']}: {st}")
            print(f"   连通与否请在 {c['label']} 里发条消息实测；"
                  f"日志: journalctl -u {c['service']} -f")
            return 0 if st == "active" else 1
        return 1
    return 0 if proc_start(ch) else 1


def disable(ch):
    if ch not in CHANNELS or ch in ("feishu",):
        print(f"可停用渠道：wechat {' '.join(EXTRA)}"); return 1
    c = CHANNELS[ch]
    if has_systemd():
        sh(["sudo", "systemctl", "disable", "--now", c["service"]])
        sh(["sudo", "rm", "-f", f"/etc/systemd/system/{c['service']}.service"])
        sh(["sudo", "systemctl", "daemon-reload"])
        print(f"{OK} 服务 {c['service']} 已停用并移除（mykey 凭证保留，enable 可复用）")
    else:
        proc_stop(ch)
    return 0


def status():
    print("🏮 蓬莱渠道矩阵（内核 GA 自带 7 渠道，蓬莱层统一封装）\n")
    print(f"  {'渠道':<10}{'凭证':<6}{'依赖':<6}{'运行':<10}实测状态")
    for ch, c in CHANNELS.items():
        creds = "✔" if (not c["keys"] or all(mykey_get(k) for k in c["keys"])) else "—"
        deps = "✔" if all(sh([venv_python(), "-c", f"import {m}"]).returncode == 0
                          for m in c["pip"].values()) else "—"
        if has_systemd():
            st = sh(["systemctl", "is-active", c["service"]]).stdout.strip() or "—"
            run = st if st != "unknown" else "未安装"
        else:
            run = f"PID {proc_pids(c['script'])[0]}" if proc_pids(c["script"]) else "—"
        tested = "✅ 已实测" if c["tested"] else "⚠️ 待实测"
        print(f"  {c['label']:<9}{creds:<7}{deps:<7}{run:<10}{tested}")
    print(f"\n  启用渠道: penglai enable <{('|'.join(EXTRA))}>")
    print("  飞书/微信: penglai setup（含扫码与连接验证闭环）")
    print(f"  {WARN}文件外发白名单护栏当前仅覆盖飞书渠道（其余渠道为上游原生行为，蓬莱层适配中）")
    return 0
