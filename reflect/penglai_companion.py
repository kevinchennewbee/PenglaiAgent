# -*- coding: utf-8 -*-
"""蓬莱 reflect 心跳：主动陪伴 v2（多触发源 + 飞书/微信双渠道投递）。默认关闭，opt-in。

第一性原理：GA 的 reflect 机制(INTERVAL + check())就是为主动性设计的；陪伴忠于它，
不改 GA、独立进程、上游零冲突。LLM 不能自触发，心跳定期给它"睁眼的机会"，
说不说、说什么由门禁和模型自己决定。门禁硬编码，宁可沉默也不打扰。

v2 触发源（优先级从高到低，借鉴麦麦 HeartFlow / 沐雪定时问候的设计理念，代码全自写）：
  1. weather  天气预警（Open-Meteo 免费免Key；只在恶劣天气说话，每天最多一次，不占冷却）
  2. emotion  情绪承接（penglai_voice 落的负面情绪信号，18h 内主动关心一次——蓬莱独有）
  3. morning  晨间锚点（8-10 点，每天一次）
  4. evening  晚间锚点（20-22 点，每天一次）
  5. free     自由陪伴（v1 行为：冷却+静默门禁后由 LLM 判断值不值得说）

投递：agent 只产出"要说的话"(或 [SILENT])；on_done 经飞书官方 API 和/或微信 iLink API
直发主人（飞书=fs_allowed_users[0]，微信=temp/wx_master.json 记录的首位对话者）。
与 fsapp/wechatapp 进程完全解耦（自带最小发送实现，不 import 前端避免双开 agent）。

启用：mykey.py 设 companion_enabled = True；companion_city = "北京" 开天气预警（可选）。
不设=永不触发=零成本零打扰。
"""
import os, sys, json, time, socket, urllib.request, urllib.parse
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
_ROOT = os.path.join(_dir, "..")
_STATE = os.path.join(_ROOT, "temp", "companion_state.json")
_SIGNALS = os.path.join(_ROOT, "temp", "companion_signals.json")
_WX_MASTER = os.path.join(_ROOT, "temp", "wx_master.json")
_RESP_DIR = os.path.join(_ROOT, "temp", "model_responses")
_WX_TOKEN = os.path.expanduser("~/.wxbot/token.json")

_NEG_EMOTIONS = {"悲伤", "生气", "害怕", "厌恶"}

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
        "cooldown_h": g("companion_cooldown_hours", 4),   # 自由陪伴两次至少间隔
        "idle_min": g("companion_user_idle_min", 15),     # 用户近 N 分钟活跃则闭嘴
        "city": g("companion_city", ""),                  # 设了才开天气预警
        "channels": g("companion_channels", ["feishu", "wechat"]),
    }

def _load_json(path):
    try: return json.load(open(path, encoding="utf-8"))
    except Exception: return {}

def _save_state(s):
    try:
        os.makedirs(os.path.dirname(_STATE), exist_ok=True)
        json.dump(s, open(_STATE, "w", encoding="utf-8"), ensure_ascii=False)
    except Exception: pass

def _http_json(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "penglai-companion"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))

def _last_user_activity_min():
    """读 fsapp 写的 model_responses 最新 mtime 推断用户近期是否活跃（跨进程代理信号）。"""
    try:
        files = [os.path.join(_RESP_DIR, f) for f in os.listdir(_RESP_DIR)] if os.path.isdir(_RESP_DIR) else []
        if not files: return 1e9
        return (time.time() - max(os.path.getmtime(f) for f in files)) / 60
    except Exception:
        return 1e9

# ---- 触发源 ----
_SEVERE_CODES = {65: "大雨", 66: "冻雨", 67: "强冻雨", 75: "大雪", 82: "暴雨",
                 86: "暴雪", 95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴冰雹"}

def _weather_alert(cfg, state, now):
    """恶劣天气返回事实串，否则 None。每天最多查一次/报一次；接口失败静默跳过。"""
    if not cfg["city"] or not (7 <= now.hour < 10): return None
    today = now.strftime("%Y-%m-%d")
    if state.get("weather_checked_date") == today: return None
    state["weather_checked_date"] = today  # 无论结果如何今天不再查（含失败,明天再试）
    try:
        geo = state.get("geo") or {}
        if geo.get("city") != cfg["city"]:
            j = _http_json("https://geocoding-api.open-meteo.com/v1/search?count=1&language=zh&name="
                           + urllib.parse.quote(cfg["city"]))
            r0 = (j.get("results") or [None])[0]
            if not r0: return None
            geo = {"city": cfg["city"], "lat": r0["latitude"], "lon": r0["longitude"]}
            state["geo"] = geo
        j = _http_json("https://api.open-meteo.com/v1/forecast?timezone=auto&forecast_days=1"
                       "&daily=weather_code,temperature_2m_max,temperature_2m_min,"
                       "precipitation_sum,wind_speed_10m_max"
                       f"&latitude={geo['lat']}&longitude={geo['lon']}")
        d = j.get("daily") or {}
        code = (d.get("weather_code") or [0])[0]
        tmax = (d.get("temperature_2m_max") or [0])[0]
        tmin = (d.get("temperature_2m_min") or [0])[0]
        rain = (d.get("precipitation_sum") or [0])[0]
        wind = (d.get("wind_speed_10m_max") or [0])[0]
        facts = []
        if code in _SEVERE_CODES: facts.append(_SEVERE_CODES[code])
        if rain >= 25: facts.append(f"日降水量约{rain}毫米")
        if tmax >= 37: facts.append(f"最高气温{tmax}°C高温")
        if tmin <= -10: facts.append(f"最低气温{tmin}°C严寒")
        if wind >= 60: facts.append(f"最大风速{wind}km/h大风")
        if not facts: return None
        return f"{cfg['city']}今天预报: " + "、".join(facts) + f"（{tmin}~{tmax}°C）"
    except Exception as e:
        print(f"[companion] 天气查询失败(跳过): {e}"); return None

def _emotion_signal(state):
    """penglai_voice 落的负面情绪信号：18h 内、未承接过的最新一条。"""
    emos = _load_json(_SIGNALS).get("emotions", [])
    recent = [e for e in emos if time.time() - e.get("ts", 0) < 18 * 3600
              and e.get("e") in _NEG_EMOTIONS]
    if not recent: return None
    latest = recent[-1]
    if state.get("emotion_followed_ts", 0) >= latest["ts"]: return None
    return latest

# ---- 门禁与触发判定（先硬门禁，再按优先级选触发源）----
def _decide(cfg, state, now):
    if not cfg["enabled"]: return None, "disabled"
    has_fs = bool(cfg["open_id"] and cfg["app_id"]) and "feishu" in cfg["channels"]
    has_wx = (os.path.isfile(_WX_TOKEN) and _load_json(_WX_MASTER).get("uid")
              and "wechat" in cfg["channels"])
    if not (has_fs or has_wx): return None, "no_target"
    q0, q1 = cfg["quiet"]; h = now.hour
    in_quiet = (q0 <= h or h < q1) if q0 > q1 else (q0 <= h < q1)
    if in_quiet: return None, "quiet_hours"

    today = now.strftime("%Y-%m-%d")
    idle_ok = _last_user_activity_min() >= cfg["idle_min"]

    w = _weather_alert(cfg, state, now)          # 时效信息：不占冷却、不看静默
    if w: return ("weather", w), "ok"
    e = _emotion_signal(state)
    if e and idle_ok:
        state["emotion_followed_ts"] = e["ts"]   # 触发即记，防 agent 卡住重复
        return ("emotion", e), "ok"
    if 8 <= now.hour < 10 and state.get("anchor_morning") != today and idle_ok:
        state["anchor_morning"] = today
        return ("morning", None), "ok"
    if 20 <= now.hour < 22 and state.get("anchor_evening") != today and idle_ok:
        state["anchor_evening"] = today
        return ("evening", None), "ok"
    if (time.time() - state.get("last_reach", 0)) >= cfg["cooldown_h"] * 3600 and idle_ok:
        silent_h = (time.time() - max(state.get("last_reach", 0), 1)) / 3600
        return ("free", round(silent_h)), "ok"
    return None, "cooldown_or_active"

_BASE = """[主动陪伴心跳·{kind}] 现在是 {ts}（{wd}）。你是用户的个人管家蓬莱。
{body}
规则（重要）：
- 输出就是要直发给用户的那句话：简短、自然、像朋友，不要寒暄套话，不要解释你为什么说话。
- 这是主动消息，不是回复指令，不要调用工具，直接给出结论。
- {silent_rule}"""

_KIND_BODY = {
    "weather": "天气情报：{x}。把它变成一句对用户有用的提醒（出行/穿衣/防护建议），口吻自然。",
    "emotion": "此前用户语音里的情绪是「{x}」（{ago}前感知）。结合记忆 L1/L2 主动关心一句，"
               "自然不刻意，绝不要复述情绪标签本身。",
    "morning": "晨间问候时刻。结合记忆里用户的近况，给一句简短的早安/今日关照；有具体内容最好。",
    "evening": "晚间时刻。结合今天或近期的互动，给一句晚间问候/关心；有具体内容最好。",
    "free":    "回顾你对用户的了解（记忆 L1/L2）和最近互动（已约 {x} 小时没有联系），判断：此刻是否"
               "真有值得主动联系用户的理由？例如该提醒的事、需要关心的状态、发现的有价值信息。",
}
_MUST_SPEAK = {"weather"}   # 天气预警是事实提醒，必须开口；其余允许 [SILENT]

def check():
    if _lock is None: return None
    cfg = _cfg(); state = _load_json(_STATE); now = datetime.now()
    decision, why = _decide(cfg, state, now)
    if not decision:
        return None
    kind, extra = decision
    state["last_wake"] = time.time(); state["pending_kind"] = kind
    _save_state(state)
    if kind == "emotion":
        ago_h = max(1, int((time.time() - extra["ts"]) / 3600))
        body = _KIND_BODY[kind].format(x=extra["e"], ago=f"约{ago_h}小时")
    else:
        body = _KIND_BODY[kind].format(x=extra)
    silent_rule = ("这是天气安全提醒，请务必给出那句话。" if kind in _MUST_SPEAK else
                   "没有真正有价值的理由，就只回复一个词：[SILENT]。宁可沉默，绝不为了说话而打扰。")
    wd = "一二三四五六日"[now.weekday()]
    print(f"[companion] 触发: {kind}")
    return _BASE.format(kind=kind, ts=now.strftime("%Y-%m-%d %H:%M"), wd=f"周{wd}",
                        body=body, silent_rule=silent_rule)

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

def _wechat_send(text):
    """最小 iLink 发送（镜像 frontends/wechatapp.py 的 _post/send_text 协议；
    不 import 前端：其模块级会构造完整 agent 且可能双开长连接）。"""
    import requests, uuid, struct, base64
    tok = _load_json(_WX_TOKEN).get("bot_token", "")
    uid = _load_json(_WX_MASTER).get("uid", "")
    if not (tok and uid): return False
    msg = {"from_user_id": "", "to_user_id": uid,
           "client_id": f"pyclient-{uuid.uuid4().hex[:16]}",
           "message_type": 2, "message_state": 2,
           "item_list": [{"type": 1, "text_item": {"text": text}}]}
    body = json.dumps({"msg": msg, "base_info": {"channel_version": "2.1.10"}},
                      ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    h = {"Content-Type": "application/json", "AuthorizationType": "ilink_bot_token",
         "X-WECHAT-UIN": base64.b64encode(str(struct.unpack(">I", os.urandom(4))[0]).encode()).decode(),
         "iLink-App-Id": "bot", "iLink-App-ClientVersion": str((2 << 16) | (1 << 8) | 10),
         "User-Agent": "openclaw-weixin/2.1.10", "Authorization": f"Bearer {tok}"}
    try:
        r = requests.post("https://ilinkai.weixin.qq.com/ilink/bot/sendmessage",
                          data=body, headers=h, timeout=15)
        return r.json().get("errcode", r.json().get("code", -1)) in (0, None)
    except Exception as e:
        print(f"[companion] 微信发送异常: {e}"); return False

def on_done(result):
    text = (result or "").strip()
    body = text.split("</summary>")[-1].strip() if "</summary>" in text else text
    if not body or "[SILENT]" in body.upper() or len(body) < 2:
        print("[companion] 沉默（无值得主动联系的理由）"); return
    cfg = _cfg(); sent = []
    if cfg["open_id"] and cfg["app_id"] and "feishu" in cfg["channels"]:
        if _feishu_send(cfg, body): sent.append("飞书")
    if os.path.isfile(_WX_TOKEN) and "wechat" in cfg["channels"]:
        if _wechat_send(body): sent.append("微信")
    if sent:
        state = _load_json(_STATE); state["last_reach"] = time.time(); _save_state(state)
        print(f"[companion] 已主动发送({'+'.join(sent)}): {body[:40]}")
    else:
        print("[companion] 所有渠道发送失败或无可用渠道")
