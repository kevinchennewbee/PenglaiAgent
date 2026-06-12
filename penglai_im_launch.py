# -*- coding: utf-8 -*-
"""蓬莱 IM 语音接入 — 钉钉/QQ/企微前端语音消息补全的薄包装（内核零改动）。

上游 frontends/{dingtalkapp,qqapp,wecomapp}.py 只解析文字/图片，**丢弃语音消息**。
本包装在 import 前端模块（触发其类定义）后、启动前 monkeypatch 其消息处理，再重建
启动序列。上游前端文件零改动，上游更新零冲突（同 penglai_tui.py 的包装思路）。

各平台语音差异（2026-06-12 调研官方文档/SDK 源码）：
  · 钉钉  msgtype=audio，extensions.content.recognition 自带服务端转写文本（直接用）
  · QQ    attachments[*].content_type=='voice'，voice_wav_url 是 wav 直链 + asr_refer_text；
          但 botpy 的 _Attachments 白名单丢了这俩字段 → 先补字段，再下 wav 走本地 SenseVoice
  · 企微  body.voice.content 已是服务端转写文本（仅单聊，无原始音频，拿不到情绪）

诚实纪律：三平台均**待真机实测**。本地 SenseVoice 转写失败时回退平台自带 ASR 文本。
由 penglai_channels 以 `python penglai_im_launch.py <dingtalk|qq|wecom>` 启动。
"""
import os
import sys

ROOT = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, ROOT)
# 上游前端以 `python frontends/xxx.py` 直跑为前提，对同目录模块用裸 import；
# 包装器走 frontends.xxx 包路径，须补 frontends/ 入 path（同 penglai_tui.py）
sys.path.insert(1, os.path.join(ROOT, "frontends"))
os.chdir(ROOT)


# ---------- 公共：下载语音直链 → 本地 SenseVoice 转写 ----------
def _transcribe_url(url, suffix=".wav"):
    """下载语音直链 → SenseVoice 转写 → (text, emotion)。任何失败返回 (None, "")，
    调用方自行回退到平台自带 ASR 文本。"""
    if not url:
        return None, ""
    import tempfile
    import urllib.request
    try:
        from plugins.penglai_voice import transcribe_file
    except Exception as e:
        sys.stderr.write(f"[im_voice] 转写引擎不可用（{e}）；回退平台 ASR\n")
        return None, ""
    path = None
    try:
        os.makedirs(os.path.join(ROOT, "temp"), exist_ok=True)
        fd, path = tempfile.mkstemp(suffix=suffix, dir=os.path.join(ROOT, "temp"))
        os.close(fd)
        req = urllib.request.Request(url, headers={"User-Agent": "penglai-im-voice"})
        with urllib.request.urlopen(req, timeout=60) as r, open(path, "wb") as f:
            f.write(r.read())
        res = transcribe_file(path)
        if "error" in res:
            sys.stderr.write(f"[im_voice] 转写失败：{res['error'][:80]}\n")
            return None, ""
        return (res.get("text") or "").strip(), res.get("emotion") or ""
    except Exception as e:
        sys.stderr.write(f"[im_voice] 转写异常（{e}）；回退平台 ASR\n")
        return None, ""
    finally:
        if path and os.path.exists(path):
            try: os.remove(path)
            except OSError: pass


def _fmt(text, emotion):
    """统一成给 agent 的文本：标注是语音 + 可选情绪。"""
    return f"[语音] {text}" + (f"（语气：{emotion}）" if emotion else "")


# ---------- 钉钉：recognition 自带文本（音频原文件需 access_token，暂用 recognition）----------
def patch_dingtalk(m):
    H = getattr(m, "_DingTalkHandler", None)
    if H is None:
        return
    _orig = H.process

    async def process(self, message):
        try:
            cm = m.ChatbotMessage.from_dict(message.data)
            if str(getattr(cm, "message_type", "") or "").lower() == "audio":
                ext = getattr(cm, "extensions", {}) or {}
                audio = (ext.get("content") if isinstance(ext, dict) else None) or {}
                text = (audio.get("recognition") or "").strip()
                if text:
                    sid = str(getattr(cm, "sender_staff_id", None)
                              or getattr(cm, "sender_id", None) or "unknown")
                    sname = getattr(cm, "sender_nick", None) or "Unknown"
                    d = message.data
                    await self.app.on_message(_fmt(text, ""), sid, sname,
                                              d.get("conversationType"),
                                              d.get("conversationId") or d.get("openConversationId"))
                    return m.AckMessage.STATUS_OK, "OK"
                # recognition 为空（静音/识别失败）→ 落回原处理，至少不丢事件
        except Exception as e:
            sys.stderr.write(f"[im_voice] 钉钉语音处理异常（{e}）；回退原逻辑\n")
        return await _orig(self, message)

    H.process = process


# ---------- QQ：补 botpy 丢失的语音字段 + 下 wav 转写 ----------
def _prepatch_botpy():
    """botpy 的 _Attachments 只白名单了 7 个字段，丢弃 voice_wav_url/asr_refer_text。
    在 import 前端（→import botpy）后补回这两个字段。patch 类即可，顺序无关。"""
    try:
        import botpy.message as bm
    except Exception:
        return
    holder = getattr(bm, "BaseMessage", None)
    cls = getattr(holder, "_Attachments", None) or getattr(bm, "_Attachments", None)
    if cls is None or getattr(cls, "_penglai_patched", False):
        return
    _oi = cls.__init__

    def _init(self, data):
        _oi(self, data)
        try:
            self.voice_wav_url = data.get("voice_wav_url")
            self.asr_refer_text = data.get("asr_refer_text")
        except Exception:
            pass

    cls.__init__ = _init
    cls._penglai_patched = True


def patch_qq(m):
    _prepatch_botpy()
    QQApp = getattr(m, "QQApp", None)
    if QQApp is None:
        return
    _orig = QQApp.on_message

    async def on_message(self, data, is_group=False):
        try:
            content = (getattr(data, "content", "") or "").strip()
            if not content:
                for att in (getattr(data, "attachments", None) or []):
                    if str(getattr(att, "content_type", "") or "").lower() == "voice":
                        url = getattr(att, "voice_wav_url", None) or getattr(att, "url", None)
                        text, emo = _transcribe_url(url, ".wav")
                        if not text:
                            text, emo = (getattr(att, "asr_refer_text", "") or "").strip(), ""
                        if text:
                            try:
                                data.content = _fmt(text, emo)   # 塞回让原逻辑统一处理
                            except Exception:
                                # 对象不可写 → 直接走 run_agent（绕过原 content 解析）
                                author = getattr(data, "author", None)
                                uid = str(getattr(author, "member_openid" if is_group else "user_openid", "")
                                          or getattr(author, "id", "") or "unknown")
                                cid = str(getattr(data, "group_openid", "") or uid) if is_group else uid
                                if m.public_access(m.ALLOWED) or uid in m.ALLOWED:
                                    import asyncio
                                    asyncio.create_task(self.run_agent(
                                        cid, _fmt(text, emo), msg_id=getattr(data, "id", None), is_group=is_group))
                                return
                        break
        except Exception as e:
            sys.stderr.write(f"[im_voice] QQ 语音处理异常（{e}）；回退原逻辑\n")
        return await _orig(self, data, is_group)

    QQApp.on_message = on_message


# ---------- 企微：body.voice.content 已是文本（无原始音频）----------
def patch_wecom(m):
    WeComApp = getattr(m, "WeComApp", None)
    if WeComApp is None:
        return

    async def on_voice(self, frame):
        try:
            parsed = self._accept(frame)
            if not parsed:
                return
            body, sender_id, chat_id = parsed
            text = str((body.get("voice", {}) or {}).get("content", "") or "").strip()
            if not text:
                return
            import asyncio
            asyncio.create_task(self.run_agent(chat_id, _fmt(text, "")))
        except Exception as e:
            sys.stderr.write(f"[im_voice] 企微语音处理异常（{e}）\n")

    WeComApp.on_voice = on_voice
    _orig_start = WeComApp.start

    async def start(self, client=None):
        # 原 start 接受外部 client：传入预注册了 voice 事件的 client，原逻辑再注册其余事件
        if client is None:
            client = m.WSClient(m.BOT_ID, m.SECRET, reconnect_interval=1000,
                                max_reconnect_attempts=-1, heartbeat_interval=30000)
        try:
            client.on("message.voice", self.on_voice)
        except Exception as e:
            sys.stderr.write(f"[im_voice] 企微 voice 事件注册失败（{e}）\n")
        return await _orig_start(self, client)

    WeComApp.start = start


# ---------- 启动（重建各前端 __main__ 序列，patch 后再跑）----------
def launch(channel):
    import importlib
    table = {
        "dingtalk": ("frontends.dingtalkapp", patch_dingtalk, 19530, "DingTalk", "dingtalkapp.log",
                     "DingTalkApp", lambda m: dict(dingtalk_client_id=m.CLIENT_ID, dingtalk_client_secret=m.CLIENT_SECRET)),
        "qq":       ("frontends.qqapp", patch_qq, 19528, "QQ", "qqapp.log",
                     "QQApp", lambda m: dict(qq_app_id=m.APP_ID, qq_app_secret=m.APP_SECRET)),
        "wecom":    ("frontends.wecomapp", patch_wecom, 19531, "WeCom", "wecomapp.log",
                     "WeComApp", lambda m: dict(wecom_bot_id=m.BOT_ID, wecom_secret=m.SECRET)),
    }
    if channel not in table:
        sys.stderr.write(f"[im_voice] 未知渠道 {channel}；可选 {list(table)}\n")
        return 2
    mod_name, patch_fn, port, label, logname, cls_name, creds = table[channel]
    m = importlib.import_module(mod_name)
    try:
        patch_fn(m)
        print(f"[im_voice] {label} 语音接收已挂载")
    except Exception as e:
        sys.stderr.write(f"[im_voice] {label} 语音挂载失败（{e}）；以无语音模式继续\n")

    import asyncio
    import threading
    # 重建上游 __main__ 启动序列（全部走 chatapp_common 稳定 helper；前端模块已 import 进来）
    agent = getattr(m, "agent", None) or m.GeneraticAgent()
    agent.verbose = False
    m.ensure_single_instance(port, label)
    m.require_runtime(agent, label, **creds(m))
    m.redirect_log(m.__file__, logname, label, m.ALLOWED)
    threading.Thread(target=agent.run, daemon=True).start()
    app = getattr(m, cls_name)(agent) if channel == "wecom" else getattr(m, cls_name)()
    if channel == "wecom":
        threading.Thread(target=app._terminal_loop, daemon=True).start()
    asyncio.run(app.start())


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("用法: python penglai_im_launch.py <dingtalk|qq|wecom>\n")
        raise SystemExit(2)
    raise SystemExit(launch(sys.argv[1]) or 0)
