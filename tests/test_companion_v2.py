# -*- coding: utf-8 -*-
"""主动陪伴 v2 门禁/触发源回归测试（纯本地，不联网、不发消息、不碰真实 mykey）。

直接调用 reflect/penglai_companion 的 _decide()（纯函数，依赖全部可注入），
天气 HTTP 用假函数替身，用户活跃信号/微信文件探测用 lambda 替身。
运行: python tests/test_companion_v2.py  （或 pytest）
"""
import os
import sys
import time
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO not in sys.path:
    sys.path.insert(0, REPO)

import importlib
cp = importlib.import_module("reflect.penglai_companion")

# ---- 全局替身：默认用户不活跃、无微信、天气接口禁用（单测绝不联网）----
cp._last_user_activity_min = lambda: 1e9
# 状态读写重定向到测试文件，避免污染真实 companion_state.json
os.makedirs(os.path.join(REPO, "temp"), exist_ok=True)
cp._STATE = os.path.join(REPO, "temp", "_test_companion_state.json")


def _cfg(**kw):
    base = {"enabled": True, "open_id": "ou_test", "app_id": "cli_x", "app_secret": "s",
            "quiet": [22, 8], "cooldown_h": 4, "idle_min": 15, "anchor_idle_min": 2,
            "city": "", "channels": ["feishu", "wechat"]}
    base.update(kw)
    return base


def _now(h, m=30):
    return datetime(2026, 6, 13, h, m)


PASS = []
def check(name, cond):
    PASS.append((name, bool(cond)))
    print(("✅" if cond else "❌"), name)


# 1. 总开关与硬门禁
d, why = cp._decide(_cfg(enabled=False), {}, _now(9))
check("关闭开关→不触发", d is None and why == "disabled")
d, why = cp._decide(_cfg(open_id="", app_id=""), {}, _now(9))
check("无任何投递目标→不触发", d is None and why == "no_target")
d, why = cp._decide(_cfg(), {}, _now(23))
check("安静时段(23点)→不触发", d is None and why == "quiet_hours")
d, why = cp._decide(_cfg(), {}, _now(7))
check("安静时段(7点,跨夜区间)→不触发", d is None and why == "quiet_hours")

# 2. 天气触发：恶劣天气→触发且必须开口；当天只查一次；晴天沉默
_calls = []
def _fake_http_severe(url, timeout=15):
    _calls.append(url)
    if "geocoding" in url:
        return {"results": [{"latitude": 39.9, "longitude": 116.4}]}
    return {"daily": {"weather_code": [95], "temperature_2m_max": [30.0],
                      "temperature_2m_min": [22.0], "precipitation_sum": [40.0],
                      "wind_speed_10m_max": [20.0]}}
cp._http_json = _fake_http_severe
st = {"last_reach": time.time()}          # 冷却未过，但天气不该被冷却挡
d, why = cp._decide(_cfg(city="北京"), st, _now(8))
check("恶劣天气→weather触发(无视冷却)", d and d[0] == "weather" and "雷暴" in d[1] and "40" in d[1])
d2, _ = cp._decide(_cfg(city="北京"), st, _now(9))
check("同日二次心跳→天气不重复触发", (d2 is None) or d2[0] != "weather")

def _fake_http_calm(url, timeout=15):
    if "geocoding" in url:
        return {"results": [{"latitude": 39.9, "longitude": 116.4}]}
    return {"daily": {"weather_code": [1], "temperature_2m_max": [25.0],
                      "temperature_2m_min": [15.0], "precipitation_sum": [0.0],
                      "wind_speed_10m_max": [10.0]}}
cp._http_json = _fake_http_calm
st2 = {"last_reach": time.time()}
d, _ = cp._decide(_cfg(city="北京"), st2, _now(8))
check("晴天→天气不触发", (d is None) or d[0] != "weather")

# 3. 情绪承接：负面信号触发一次，承接后不重复
os.makedirs(os.path.join(REPO, "temp"), exist_ok=True)
cp._SIGNALS = os.path.join(REPO, "temp", "_test_signals.json")
import json
json.dump({"emotions": [{"e": "悲伤", "ts": time.time() - 3600}]},
          open(cp._SIGNALS, "w", encoding="utf-8"))
st3 = {"last_reach": time.time()}          # 冷却未过，情绪也不该被挡
d, _ = cp._decide(_cfg(), st3, _now(11))
check("负面语音情绪→emotion触发", d and d[0] == "emotion" and d[1]["e"] == "悲伤")
st3["emotion_followed_ts"] = d[1]["ts"]   # 模拟 on_done 成功承接后落终态（旧版在 _decide 内写，现迁出）
d, _ = cp._decide(_cfg(), st3, _now(11, 50))
check("承接成功后→同一信号不重复", (d is None) or d[0] != "emotion")
json.dump({"emotions": [{"e": "高兴", "ts": time.time()}]},
          open(cp._SIGNALS, "w", encoding="utf-8"))
d, _ = cp._decide(_cfg(), {"last_reach": time.time()}, _now(11))
check("正面情绪→不触发承接", (d is None) or d[0] != "emotion")
os.remove(cp._SIGNALS)

# 4. 锚点：早/晚窗口每天一次
st4 = {"last_reach": time.time()}
d, _ = cp._decide(_cfg(), st4, _now(9))
check("晨间窗口→morning触发", d and d[0] == "morning")
st4["anchor_morning"] = "2026-06-13"      # 模拟 on_done 成功投递后落终态（旧版在 _decide 内写，现迁出）
d, _ = cp._decide(_cfg(), st4, _now(9, 50))
check("投递成功后→晨间同日不重复", (d is None) or d[0] != "morning")
d, _ = cp._decide(_cfg(), st4, _now(21))
check("晚间窗口→evening触发", d and d[0] == "evening")

# 5. 自由陪伴：冷却过了才触发
d, _ = cp._decide(_cfg(), {"last_reach": time.time() - 5 * 3600,
                           "anchor_morning": "2026-06-13", "anchor_evening": "2026-06-13"},
                  _now(15))
check("冷却已过→free触发", d and d[0] == "free")
d, why = cp._decide(_cfg(), {"last_reach": time.time() - 600,
                             "anchor_morning": "2026-06-13", "anchor_evening": "2026-06-13"},
                    _now(15))
check("冷却未过→不触发", d is None)

# 6. 用户活跃时：锚点/情绪/自由都让路（天气除外）
cp._last_user_activity_min = lambda: 1.0
d, why = cp._decide(_cfg(), {"last_reach": 0}, _now(9))
check("用户正活跃→晨间/自由让路", d is None)
cp._http_json = _fake_http_severe
d, _ = cp._decide(_cfg(city="北京"), {"last_reach": 0}, _now(8))
check("用户正活跃→天气仍触发(时效优先)", d and d[0] == "weather")
cp._last_user_activity_min = lambda: 1e9

# 7. on_done 的 [SILENT] 纪律（替身发送器，确保一字不发）
_sent = []
cp._feishu_send = lambda cfg, t: _sent.append(("fs", t)) or True
cp._wechat_send = lambda t: _sent.append(("wx", t)) or True
cp.on_done("[SILENT]")
cp.on_done("")
check("[SILENT]/空输出→零投递", _sent == [])

# ---- v2 加固：原子写/句柄、A1/A2/A3/A4 租约竞态、B 锚点放宽、护栏、[SILENT] 清租约 ----
def _write_state(d): json.dump(d, open(cp._STATE, "w", encoding="utf-8"))
def _read_state():
    try: return json.load(open(cp._STATE, encoding="utf-8"))
    except Exception: return {}

# 原子写 + 句柄
cp._save_state({"k": 1})
check("原子写:回读一致", cp._load_json(cp._STATE).get("k") == 1)
check("原子写:无 .tmp 残留", not os.path.exists(cp._STATE + ".tmp"))
check("句柄:不存在路径返回{}", cp._load_json("/nonexistent/xyz/none.json") == {})

# A4 租约防重复 / 过期可再触发（直接 _decide）
cp._last_user_activity_min = lambda: 1e9
_nt = time.time()
d, _ = cp._decide(_cfg(), {"pending_kind": "morning", "pending_ts": _nt, "last_reach": _nt}, _now(9))
check("A4 活租约内 morning 让路(防重复)", (d is None) or d[0] != "morning")
d, _ = cp._decide(_cfg(), {"pending_kind": "morning", "pending_ts": _nt - cp.LEASE_TTL - 1,
                           "last_reach": _nt}, _now(9))
check("A4 租约过期 morning 可再触发(不哑火)", d and d[0] == "morning")

# B 锚点放宽 idle：5min<15 但≥2 → morning 触发；free 仍用 15min → 让路
cp._last_user_activity_min = lambda: 5.0
d, _ = cp._decide(_cfg(), {"last_reach": time.time()}, _now(9))
check("B 锚点放宽:idle 5min 仍 morning 触发", d and d[0] == "morning")
d, _ = cp._decide(_cfg(), {"last_reach": time.time() - 5 * 3600,
                           "anchor_morning": "2026-06-13", "anchor_evening": "2026-06-13"}, _now(15))
check("B free 不放宽:idle 5min<15→让路", d is None)
cp._last_user_activity_min = lambda: 1e9

# A1 投递失败：不落终态、清租约、不哑火
cp._cfg = lambda: _cfg()
cp._feishu_send = lambda c, t: False
cp._wechat_send = lambda t: False
_write_state({"pending_kind": "morning", "pending_ts": time.time()})
cp.on_done("早安呀")
s = _read_state()
check("A1 投递失败不落终态+清租约", s.get("anchor_morning") is None and s.get("pending_kind") == "")
d, _ = cp._decide(_cfg(), {"last_reach": 0}, _now(9))
check("A1 失败后同日不哑火(morning 可再触发)", d and d[0] == "morning")

# A2 投递成功：兑现终态、清租约、不重复
cp._feishu_send = lambda c, t: True
cp._wechat_send = lambda t: True
_write_state({"pending_kind": "morning", "pending_ts": time.time()})
cp.on_done("早安呀")
s = _read_state()
_today = datetime.now().strftime("%Y-%m-%d")
check("A2 投递成功兑现终态+清租约", s.get("anchor_morning") == _today and s.get("pending_kind") == "")
_t9 = datetime.now().replace(hour=9, minute=30, second=0, microsecond=0)
d, _ = cp._decide(_cfg(), s, _t9)
check("A2 成功后同日不重复", (d is None) or d[0] != "morning")

# A3 emotion 投递失败不消耗信号（emotion_followed_ts 不写）
cp._feishu_send = lambda c, t: False
cp._wechat_send = lambda t: False
_write_state({"pending_kind": "emotion", "pending_ts": time.time(), "pending_emotion_ts": 123.0})
cp.on_done("还好吗")
s = _read_state()
check("A3 emotion 失败不写 followed_ts", s.get("emotion_followed_ts") is None and s.get("pending_kind") == "")

# [SILENT] 清租约且不落终态
cp._feishu_send = lambda c, t: True
cp._wechat_send = lambda t: True
_write_state({"pending_kind": "morning", "pending_ts": time.time()})
cp.on_done("[SILENT]")
s = _read_state()
check("[SILENT] 清租约且不落终态", s.get("anchor_morning") is None and s.get("pending_kind") == "")

# 护栏 + 记忆开口：注入 _decide 返回 morning，验 check() 产出的 prompt 文本
cp._lock = object()
cp._cfg = lambda: _cfg()
cp._decide = lambda cfg, st, now: (("morning", None), "ok")
_prompt = cp.check()
check("prompt 含人设护栏", bool(_prompt) and "不是恋人" in _prompt and "点到为止" in _prompt)
check("prompt 含记忆开口理由", bool(_prompt) and "具体的事" in _prompt)

# 清理测试状态文件
try: os.remove(cp._STATE)
except Exception: pass

failed = [n for n, ok in PASS if not ok]
print(f"\n{len(PASS) - len(failed)}/{len(PASS)} 通过")
sys.exit(1 if failed else 0)
