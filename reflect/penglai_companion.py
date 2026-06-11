# -*- coding: utf-8 -*-
"""蓬莱 reflect 心跳：主动陪伴（M8 — 真主动，不是闹钟）。默认关闭，opt-in。

第一性原理：GA 的 reflect 机制(INTERVAL + check())就是为主动性设计的；陪伴忠于它，
不改 GA、独立进程、上游零冲突。LLM 不能自触发，所以心跳定期喂"时间+近况+人设"让它自己
决定"此刻要不要主动联系用户"。门禁硬编码,宁可沉默也不打扰。

投递：agent 只产出"要说的话"(或 [SILENT])；on_done 用飞书官方 API 发给用户的 open_id
(向导已收集 fs_allowed_users)。与 fsapp 完全解耦。

启用：mykey.py 设 companion_enabled = True（向导可选步骤写入）。不设=永不触发=零成本零打扰。
"""
import os, sys, json, time, socket
from datetime import datetime

# 端口锁：防止重复启动（与 scheduler 的 45762 错开）
try: _lock
except NameError:
    try:
        _lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        _lock.bind(("127.0.0.1", 45763)); _lock.listen(1)
    except OSError:
        print("[companion] 已有实例在跑，本进程退出心跳"); _lock = None

INTERVAL = 600          # 10 分钟醒一次查门禁（醒着很便宜，过门禁才花钱）
ONCE = False

_dir = os.path.dirname(os.path.abspath(__file__))
_CODE = os.path.join(_dir, "..")
_STATE = os.path.join(_dir, "..", "temp", "companion_state.json")
_RESP_DIR = os.path.join(_dir, "..", "temp", "model_responses")

# ---- 配置（默认保守，可被 mykey 覆盖）----
def _cfg():
    try: import mykey
    except Exception: mykey = None
    g = lambda k, d: getattr(mykey, k, d) if mykey else d
    users = g("fs_allowed_users", []) or []
    return {
        "enabled": bool(g("companion_enabled", False)),
        "open_id": users[0] if users else "",
        "app_id": g("fs_app_id", ""), "app_secret": g("fs_app_secret", ""),
        "quiet": g("companion_quiet_hours", [22, 8]),     # [起,止] 不打扰
        "cooldown_h": g("companion_cooldown_hours", 4),   # 两次主动至少间隔
        "idle_min": g("companion_user_idle_min", 15),     # 用户近 N 分钟活跃则闭嘴
    }

def _load_state():
    try: return json.load(open(_STATE, encoding="utf-8"))
    except Exception: return {}

def _save_state(s):
    try:
        os.makedirs(os.path.dirname(_STATE), exist_ok=True)
        json.dump(s, open(_STATE, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception: pass

def _last_user_activity_min():
    """读 fsapp 写的 model_responses 最新 mtime 推断用户近期是否活跃（跨进程代理信号）。
    陪伴自己的运行间隔 cooldown(默认4h) 远大于 idle 窗口，故自身污染不影响判断。"""
    try:
        files = [os.path.join(_RESP_DIR, f) for f in os.listdir(_RESP_DIR)] if os.path.isdir(_RESP_DIR) else []
        if not files: return 1e9
        return (time.time() - max(os.path.getmtime(f) for f in files)) / 60
    except Exception:
        return 1e9

# ---- 门禁（纯函数，先失败先返回）----
def _gate(cfg, state, now):
    if not cfg["enabled"]: return "disabled"
    if not cfg["open_id"] or not cfg["app_id"]: return "no_target"
    q0, q1 = cfg["quiet"]
    h = now.hour
    in_quiet = (q0 <= h or h < q1) if q0 > q1 else (q0 <= h < q1)
    if in_quiet: return "quiet_hours"
    last = state.get("last_reach", 0)
    if (time.time() - last) < cfg["cooldown_h"] * 3600: return "cooldown"
    if _last_user_activity_min() < cfg["idle_min"]: return "user_active"
    return "ok"

_PROMPT = """[主动陪伴心跳] 现在是 {ts}（{wd}）。你是用户的个人管家蓬莱。

回顾你对用户的了解（记忆 L1/L2）和最近的互动，判断：此刻是否真有值得主动联系用户的理由？
例如：该提醒的事、需要关心的状态（含此前从语音里感知到的情绪）、发现的有价值信息、或久未问候。

规则（重要）：
- 没有真正有价值的理由，就只回复一个词：[SILENT]。宁可沉默，绝不为了说话而打扰。
- 有理由，就直接写出要发给用户的那句话：简短、自然、像朋友，不要寒暄套话。
- 这是主动消息，不是回复指令，不要调用工具，直接给出结论。"""

def check():
    if _lock is None: return None
    cfg = _cfg()
    state = _load_state()
    now = datetime.now()
    g = _gate(cfg, state, now)
    if g != "ok":
        return None
    # 记录本次唤醒，避免门禁通过但 agent 卡住时下次重复
    state["last_wake"] = time.time()
    _save_state(state)
    wd = "一二三四五六日"[now.weekday()]
    return _PROMPT.format(ts=now.strftime("%Y-%m-%d %H:%M"), wd=f"周{wd}")

# ---- 投递：on_done 在 agent 产出后被 agentmain 调用 ----
def _feishu_send(cfg, text):
    import requests
    r = requests.post("https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal",
                      json={"app_id": cfg["app_id"], "app_secret": cfg["app_secret"]}, timeout=15)
    tok = r.json().get("tenant_access_token")
    if not tok: return False
    r = requests.post("https://open.feishu.cn/open-apis/im/v1/messages",
                      params={"receive_id_type": "open_id"},
                      json={"receive_id": cfg["open_id"], "msg_type": "text",
                            "content": json.dumps({"text": text}, ensure_ascii=False)},
                      headers={"Authorization": f"Bearer {tok}"}, timeout=15)
    return r.json().get("code") == 0

def on_done(result):
    text = (result or "").strip()
    # 取最后一段非空（agent 可能有思考前缀）；判 [SILENT]
    body = text.split("</summary>")[-1].strip() if "</summary>" in text else text
    if not body or "[SILENT]" in body.upper() or len(body) < 2:
        print("[companion] 沉默（无值得主动联系的理由）"); return
    cfg = _cfg()
    if _feishu_send(cfg, body):
        state = _load_state(); state["last_reach"] = time.time(); _save_state(state)
        print(f"[companion] 已主动发送: {body[:40]}")
    else:
        print("[companion] 飞书发送失败")
