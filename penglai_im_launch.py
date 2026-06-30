# -*- coding: utf-8 -*-
"""蓬莱 IM 语音与运行时接入 — 钉钉/QQ/企微/微信的包装启动入口。

上游 frontends/{dingtalkapp,qqapp,wecomapp}.py 只解析文字/图片，**丢弃语音消息**。
本包装在 import 前端模块（触发其类定义）后、启动前 monkeypatch 其消息处理，再重建
启动序列。新架构把真实渠道入口收口到这个包装层；GA 执行核心保持 upstream-first。

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


def _cancel_wechat_runtime_session(uid, runtime, hub_service, agent, pending_permissions=None, task_aborted=None):
    """Cancel the WeChat user's Runtime Hub session and abort the active GA turn."""
    import uuid

    runtime_event, session = runtime.event(
        event_id=f"wechat_cancel_{uid}_{uuid.uuid4().hex}",
        user_id=uid,
        chat_id=uid,
        text="/stop",
    )
    data = hub_service.cancel_session(session.session_id, drop_pending=True)
    abort = getattr(agent, "abort", None)
    if callable(abort):
        abort()
    if isinstance(task_aborted, dict):
        task_aborted[uid] = True
    if pending_permissions is not None:
        pending_permissions.pop(uid, None)
    return session.session_id, data


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

    # 安全加固：上游 _save_media 直接用 result["filename"] 拼路径，无 basename 清洗，
    # 构造恶意文件名（含 ../）可路径穿越覆盖任意文件。在 Penglai 包装层修复，不动上游。
    # （上游 PR 候选；白名单生效前是真实漏洞）
    if hasattr(WeComApp, "_save_media"):
        async def _safe_save_media(self, url, aes_key, default_name):
            os.makedirs(m.MEDIA_DIR, exist_ok=True)
            result = await self.client.download_file(url, aes_key or None)
            buf = result["buffer"]
            raw_name = result.get("filename") or default_name
            fname = os.path.basename(str(raw_name or ""))
            if not fname or fname in (".", ".."):
                fname = os.path.basename(str(default_name or "")) or "media.bin"
            path = os.path.join(m.MEDIA_DIR, fname)
            with open(path, "wb") as f:
                f.write(buf)
            return path
        WeComApp._save_media = _safe_save_media

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
    try:
        from penglai_runtime.channel_runtime import install_channel_runtime_adapter
        if install_channel_runtime_adapter(app, channel=channel):
            print(f"[im_voice] {label} Runtime Hub 主链路已挂载")
    except Exception as e:
        sys.stderr.write(f"[im_voice] {label} Runtime Hub 挂载失败（{e}）；以原主链路继续\n")
    try:
        from penglai_runtime.text_interaction import install_text_interaction_adapter
        if install_text_interaction_adapter(app):
            print(f"[im_voice] {label} 统一交互文字降级已挂载")
    except Exception as e:
        sys.stderr.write(f"[im_voice] {label} 统一交互挂载失败（{e}）；以原交互模式继续\n")
    if channel == "wecom":
        threading.Thread(target=app._terminal_loop, daemon=True).start()
    asyncio.run(app.start())


def launch_wechat():
    """微信：包装 on_message 持久化主人 uid 到 temp/wx_master.json（首位对话者=主人，
    写后不覆盖），供主动陪伴(reflect/penglai_companion)跨进程投递。
    其余完全复刻 frontends/wechatapp.py 的 __main__ 序列（含 systemd 关心的退出码：
    1=单例冲突/无token不可交互，2=AuthExpired 需重扫码）。"""
    do_relogin = "--relogin" in sys.argv
    token_path = os.path.expanduser("~/.wxbot/token.json")
    if not do_relogin and not os.path.exists(token_path) and not sys.stdout.isatty():
        print("[微信] 未找到 token，且当前不是交互终端。请运行 `penglai setup`，或提供 ~/.wxbot/token.json。")
        return 1

    import copy, json, queue, re, time, socket, threading, uuid
    import frontends.wechatapp as wx
    from penglai_runtime.channel_runtime import ChannelRuntimeBridge
    from penglai_runtime.contracts import RunStatus
    from penglai_runtime.delivery import DeliveryService
    from penglai_runtime.permissions import render_permission_text, resolve_permission_choice

    # ── 微信 iLink 健壮性加固（借鉴 Hermes weixin.py，Penglai 包装层注入，不动上游）──
    # 1) 二维码过期自动刷新（最多 3 次），不直接 raise 让用户重跑
    # 2) 识别 errcode=-2 stale-session（不只 -14），同样触发重扫码
    # 3) get_updates 连续失败退避（MAX_CONSECUTIVE_FAILURES=3 → 30s backoff），防死亡螺旋
    _WEC_MAX_QR_REFRESH = 3
    _orig_login_qr = wx.WxBotClient.login_qr
    def _robust_login_qr(self, poll_interval=2):
        for _ in range(_WEC_MAX_QR_REFRESH):
            try:
                return _orig_login_qr(self, poll_interval)
            except RuntimeError as e:
                if "过期" in str(e):
                    print(f"[QR登录] 二维码过期，自动刷新重试...")
                    continue
                raise
        raise RuntimeError(f"二维码连续 {_WEC_MAX_QR_REFRESH} 次过期，请检查网络或稍后重试")
    wx.WxBotClient.login_qr = _robust_login_qr

    _WEC_MAX_FAILURES = 3
    _WEC_BACKOFF_SEC = 30
    _orig_get_updates = wx.WxBotClient.get_updates
    _wec_fail_count = 0
    def _robust_get_updates(self, timeout=30):
        nonlocal _wec_fail_count
        try:
            result = _orig_get_updates(self, timeout)
            _wec_fail_count = 0
            return result
        except wx.AuthExpired:
            _wec_fail_count = 0
            raise  # AuthExpired 直接抛，由上层处理重扫码
        except Exception as e:
            _wec_fail_count += 1
            if _wec_fail_count >= _WEC_MAX_FAILURES:
                print(f"[getUpdates] 连续 {_wec_fail_count} 次失败（{e}），退避 {_WEC_BACKOFF_SEC}s...")
                time.sleep(_WEC_BACKOFF_SEC)
                _wec_fail_count = 0
            return []
    wx.WxBotClient.get_updates = _robust_get_updates

    # 识别 errcode=-2 stale-session：上游只认 -14，-2（unknown error）也应清 token 重扫
    _orig_post = wx.WxBotClient._post
    def _robust_post(self, ep, body, timeout=15):
        resp = _orig_post(self, ep, body, timeout)
        if isinstance(resp, dict) and resp.get("errcode") == -2:
            print(f"[ilink] errcode=-2 stale-session，清 token 触发重扫码")
            self._buf = ""; self.token = ""; self.bot_id = ""
            self._save(bot_token="", ilink_bot_id="")
            raise wx.AuthExpired(resp.get("errmsg", "stale session (-2)"))
        return resp
    wx.WxBotClient._post = _robust_post

    from penglai_runtime.port import GenericAgentInstancePort
    from penglai_runtime.service import RuntimeHubService

    _master = os.path.join(ROOT, "temp", "wx_master.json")
    _wechat_lock_port = 19532

    def _is_cmd(text, name):
        s = (text or "").strip()
        return s == name or s.startswith(name + " ") or s.startswith(name + "\t")

    def _help_text():
        return "\n".join([
            "Commands:",
            "/status - show runtime status",
            "/doctor - run diagnostics",
            "/install-check - run install preflight",
            "/update-check - check updates without applying them",
            "/runtime-audit - audit legacy runtime entrypoints",
            "/privacy-audit - audit privacy/release blockers",
            "/new - clear current context",
            "/restore - restore the latest conversation summary",
            "/continue - list recoverable sessions",
            "/continue N - restore a session",
            "/btw <question> - side question without interrupting the main task",
            "/review [scope] - in-session code review",
            "/llm [N] - list or switch model",
            "/stop - stop the current task",
        ])

    def _send(bot, uid, text, ctx):
        try:
            bot.send_text(uid, text, context_token=ctx)
        except Exception as e:
            print(f"[WX] command send err: {type(e).__name__}: {e}", file=sys.__stdout__)

    def _text_msg(msg, text):
        clone = copy.deepcopy(msg)
        clone["item_list"] = [{"type": wx.ITEM_TEXT, "text_item": {"text": text}}]
        return clone

    def _handle_restore():
        from frontends.chatapp_common import format_restore

        restored_info, err = format_restore()
        if err:
            return err
        restored, fname, count = restored_info
        wx.agent.abort()
        wx.agent.history.extend(restored)
        return f"✅ 已恢复 {count} 轮对话\n来源: {fname}\n(仅恢复上下文，请输入新问题继续)"

    def _handle_review(bot, msg, uid, ctx, text):
        from frontends import review_cmd

        body = text[len("/review"):].strip()
        out = queue.Queue()
        prompt = review_cmd.handle(wx.agent, body, out)
        if prompt is None:
            try:
                item = out.get_nowait()
                if "done" in item:
                    _send(bot, uid, item["done"], ctx)
            except queue.Empty:
                pass
            return
        wx.on_message(bot, _text_msg(msg, prompt))

    def _handle_ops_command(op):
        from frontends.chatapp_common import run_read_only_ops_command

        return run_read_only_ops_command(op)

    def _dispatch_command(bot, msg, text, uid, ctx):
        if text == "/help":
            _send(bot, uid, _help_text(), ctx)
            return True
        if _is_cmd(text, "/status"):
            llm = wx.agent.get_llm_name() if getattr(wx.agent, "llmclient", None) else "未配置"
            _send(bot, uid, f"状态: {'🔴 运行中' if wx.agent.is_running else '🟢 空闲'}\nLLM: [{wx.agent.llm_no}] {llm}", ctx)
            return True
        op = (text or "").split()[0].lower() if (text or "").strip() else ""
        if op in {"/doctor", "/install-check", "/update-check", "/runtime-audit", "/privacy-audit"}:
            def worker():
                _send(bot, uid, _handle_ops_command(op), ctx)

            threading.Thread(target=worker, daemon=True, name="wechat-ops-command").start()
            return True
        if op == "/update":
            _send(bot, uid, "升级需要显式确认。请先发送 /update-check 查看当前版本与可更新内容；确认后在本机或服务器运行 penglai update --apply。", ctx)
            return True
        if text in ("/stop", "/abort"):
            session_id, data = _cancel_wechat_runtime_session(
                uid,
                _runtime,
                _hub_service,
                wx.agent,
                pending_permissions=_pending_permissions,
                task_aborted=wx._task_aborted,
            )
            print(
                f"[WX] /stop runtime_cancel session={session_id} "
                f"next={data.get('next_event_id') or '-'}",
                file=sys.__stdout__,
            )
            _send(bot, uid, f"[已请求停止] session={session_id}", ctx)
            return True
        if _is_cmd(text, "/new"):
            from frontends.continue_cmd import reset_conversation

            _send(bot, uid, reset_conversation(wx.agent), ctx)
            return True
        if _is_cmd(text, "/restore"):
            _send(bot, uid, _handle_restore(), ctx)
            return True
        if text == "/continue" or re.fullmatch(r"/continue\s+\d+\s*", text or ""):
            from frontends.continue_cmd import handle_frontend_command

            _send(bot, uid, handle_frontend_command(wx.agent, text, exclude_pid=os.getpid()), ctx)
            return True
        if (text or "").startswith("/continue"):
            _send(bot, uid, "用法: /continue 或 /continue N", ctx)
            return True
        if _is_cmd(text, "/btw"):
            from frontends.btw_cmd import handle_frontend_command

            def worker():
                _send(bot, uid, handle_frontend_command(wx.agent, text), ctx)

            threading.Thread(target=worker, daemon=True, name="wechat-btw").start()
            return True
        if _is_cmd(text, "/review"):
            _handle_review(bot, msg, uid, ctx, text)
            return True
        if _is_cmd(text, "/llm"):
            parts = text.split()
            if len(parts) > 1:
                try:
                    n = int(parts[1])
                    wx.agent.next_llm(n)
                    _send(bot, uid, f"切换到 [{wx.agent.llm_no}] {wx.agent.get_llm_name()}", ctx)
                except Exception:
                    _send(bot, uid, f"用法: /llm <0-{len(wx.agent.list_llms()) - 1}>", ctx)
            else:
                lines = [f"{'→' if cur else '  '} [{i}] {name}" for i, name, cur in wx.agent.list_llms()]
                _send(bot, uid, "LLMs:\n" + "\n".join(lines), ctx)
            return True
        if (text or "").startswith("/llm") and not _is_cmd(text, "/llm"):
            _send(bot, uid, "用法: /llm 或 /llm N", ctx)
            return True
        return False

    _pending_permissions = {}
    _runtime = ChannelRuntimeBridge(
        channel="wechat",
        file_hint=(
            "If you need to show files to user, use [FILE:filepath] in your response. "
            "If the user sent images, use the attached local image path and memory/penglai_im_vision_sop.md; "
            "do not answer image-content questions from filenames, EXIF, OCR-only guesses, or model-name assumptions."
        ),
    )
    _hub_service = RuntimeHubService(owner_user_ids=getattr(_runtime.router, "owner_user_ids", set()))
    print("[蓬莱中枢] 微信消息已接入 RuntimeHubService -> GenericAgentInstancePort -> TaskRun", file=sys.__stdout__)

    def _compose_wechat_prompt(text):
        return _runtime.prompt(text)

    def _run_wechat_agent(bot, uid, ctx, text, media_paths):
        runtime_event, session = _runtime.event(
            event_id=f"wechat_{uid}_{uuid.uuid4().hex}",
            user_id=uid,
            chat_id=uid,
            text=text,
            images=tuple(media_paths or ()),
            files=tuple(media_paths or ()),
        )
        def _wx_send(body):
            s = (body or "").strip()
            if not s:
                return False
            t0 = time.time()
            try:
                bot.send_text(uid, s[:3000], context_token=ctx)
                print(f"[WX] send ok len={len(s[:3000])} dt={time.time()-t0:.1f}s", file=sys.__stdout__)
                return True
            except Exception as e:
                print(f"[WX] send err len={len(s[:3000])} dt={time.time()-t0:.1f}s {type(e).__name__}: {e}", file=sys.__stdout__)
                return False

        _typing_stop = threading.Event()

        def _keep_typing():
            try:
                ticket = bot.get_typing_ticket(uid, ctx)
            except Exception:
                ticket = ""
            if not ticket:
                return
            while not _typing_stop.is_set():
                try:
                    bot.send_typing(uid, ticket)
                except Exception:
                    pass
                _typing_stop.wait(2.0)

        def _deliver_result(run_result):
            if run_result is None:
                _wx_send("❌ 错误: 微信运行时中枢调用失败")
                return
            if run_result.status == RunStatus.WAITING_PERMISSION and run_result.permission is not None:
                _pending_permissions[uid] = run_result.permission
                _wx_send(render_permission_text(run_result.permission))
                return
            if run_result.status == RunStatus.FAILED:
                _wx_send(f"❌ 错误: {run_result.task_run.error}")
                return
            if run_result.status == RunStatus.CANCELLED:
                _wx_send("[已停止]")
                return

            raw = run_result.raw_output or run_result.cleaned_output or run_result.task_run.result_text
            _runtime.record_memory(raw, context={"channel": "wechat", "session_id": session.session_id})
            _runtime.record_shadow(
                raw,
                receive_id=uid,
                receive_id_type="wechat_user",
                base_dir=wx._TEMP_DIR,
                exclude_paths=media_paths,
                production_text=raw,
            )
            aborted = wx._task_aborted.pop(uid, False)
            tag = "[已停止]" if aborted else "[任务已完成]"
            body = wx._clean(f"{raw}\n\n{tag}")
            if body:
                _wx_send(body[-3000:])

            def _send_file(fpath):
                try:
                    kind = wx.artifact_kind(fpath)
                    sender = bot.send_video if kind == "video" else bot.send_image if kind == "image" else bot.send_file
                    sender(uid, fpath, context_token=ctx)
                    print(f"[WX] sent media: {fpath}", file=sys.__stdout__)
                    return True
                except Exception as e:
                    print(f"[WX] send media err: {e}", file=sys.__stdout__)
                    return False

            DeliveryService(send_text=_wx_send, send_file=_send_file, send_audio=_send_file).deliver(
                raw,
                base_dir=wx._TEMP_DIR,
                exclude_paths=media_paths,
                send_body=False,
            )

        try:
            threading.Thread(target=_keep_typing, daemon=True).start()
            port = GenericAgentInstancePort(
                agent=wx.agent,
                prompt_builder=lambda incoming: (
                    incoming.text if incoming.text.startswith("/") else _compose_wechat_prompt(incoming.text)
                ),
                source="wechat",
                timeout=getattr(wx, "AGENT_TIMEOUT_SEC", 1200),
            )
            # Unified中枢 submit (non-blocking).  When the session is busy the
            # hub queues the event; we tell the user and return.  When it starts
            # now, we wait for THIS event's completion.
            done_evt = threading.Event()
            holder = {}
            queued_delivery = {"enabled": False, "delivered": False}

            def _deliver_queued(result):
                if queued_delivery["delivered"]:
                    return
                queued_delivery["delivered"] = True
                _deliver_result(result)

            def _on_complete(result):
                holder["result"] = result
                if queued_delivery["enabled"]:
                    _deliver_queued(result)
                done_evt.set()

            decision = _hub_service.submit(
                runtime_event,
                port=port,
                on_complete=_on_complete,
                base_dir=wx._TEMP_DIR,
                exclude_paths=media_paths,
                send_body=False,
                send_notice=False,
            )
            if not decision.started_now:
                queued_delivery["enabled"] = True
                if "result" in holder:
                    _deliver_queued(holder["result"])
                _typing_stop.set()
                _wx_send(f"已收到，当前还有任务在运行；这条已排队 #{decision.queue_no}，当前任务结束后自动处理。")
                return
            while not done_evt.wait(timeout=0.5):
                if wx._task_aborted.get(uid):
                    break
            run_result = holder.get("result")
        except Exception as e:
            print(f"[WX] penglai wrapper run err: {type(e).__name__}: {e}", file=sys.__stdout__)
            run_result = None
        finally:
            _typing_stop.set()

        _deliver_result(run_result)

    def on_message(bot, msg):
        try:
            uid = msg.get("from_user_id", "")
            if uid and not os.path.exists(_master):
                os.makedirs(os.path.dirname(_master), exist_ok=True)
                json.dump({"uid": uid, "ts": time.time()},
                          open(_master, "w", encoding="utf-8"))
                print(f"[wx_master] 已记录主人 uid（首位对话者）", file=sys.__stdout__)
        except Exception:
            pass
        text = bot.extract_text(msg).strip()
        uid = msg.get("from_user_id", "")
        ctx = msg.get("context_token", "")
        media_paths = wx._dl_media(msg.get("item_list", []))
        if media_paths:
            text = (text + "\n" if text else "") + "\n".join(f"[用户发送文件: {p}]" for p in media_paths)
        if not text and not media_paths:
            return
        if text and _dispatch_command(bot, msg, text, uid, ctx):
            return
        waiting = _pending_permissions.get(uid)
        if waiting and text:
            chosen = resolve_permission_choice(text, waiting)
            if chosen is None:
                _send(bot, uid, render_permission_text(waiting), ctx)
                return
            _pending_permissions.pop(uid, None)
            text = chosen
        threading.Thread(
            target=_run_wechat_agent,
            args=(bot, uid, ctx, text, media_paths),
            daemon=True,
            name="wechat-penglai-agent",
        ).start()

    try:
        lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock.bind(("127.0.0.1", _wechat_lock_port))
    except OSError:
        print("[微信] 已有一个实例在运行，退出。"); return 1
    logf = open(os.path.join(ROOT, "temp", "wechatapp.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = sys.stderr = logf
    print(f'[NEW] Process starting {time.strftime("%m-%d %H:%M")} (penglai_im_launch)')
    bot = wx.WxBotClient()
    if do_relogin or not bot.token:
        if not sys.stdout.isatty():
            msg = "[微信] 未找到 token，且当前不是交互终端。请运行 `penglai setup`，或提供 ~/.wxbot/token.json。"
            print(msg)
            print(msg, file=sys.__stdout__)
            return 1
        sys.stdout = sys.stderr = sys.__stdout__  # restore for QR display
        bot.login_qr()
        sys.stdout = sys.stderr = logf
    threading.Thread(target=wx.agent.run, daemon=True).start()
    print(f"微信机器人已启动（bot_id={bot.bot_id}）", file=sys.__stdout__)
    try:
        bot.run_loop(on_message)
    except wx.AuthExpired:
        print("[微信] token 已过期，退出。", file=sys.__stdout__)
        return 2
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.stderr.write("用法: python penglai_im_launch.py <dingtalk|qq|wecom|wechat>\n")
        raise SystemExit(2)
    if sys.argv[1] == "wechat":
        raise SystemExit(launch_wechat() or 0)
    raise SystemExit(launch(sys.argv[1]) or 0)
