# -*- coding: utf-8 -*-
"""penglai_im_launch 三家 IM 语音 patch 的回归测试（mock 模块/消息对象，无需真机/SDK）。
直跑：python tests/test_im_voice.py    或    pytest tests/test_im_voice.py
"""
import asyncio
import builtins
import os
import sys
import tempfile
import types
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import penglai_im_launch as L


def test_dingtalk_audio_recognition():
    """钉钉 audio 消息：从 extensions.content.recognition 取文本，调 on_message，不落原逻辑。"""
    calls = {}

    class FakeCM:
        message_type = "audio"
        extensions = {"content": {"recognition": "明天下午三点开会"}}
        sender_staff_id = "u1"; sender_nick = "老王"

    class FakeApp:
        async def on_message(self, text, sid, sname, ct, ci): calls["dt"] = (text, sid)

    class H:
        app = FakeApp()
        async def process(self, message): calls["orig"] = True

    m = types.SimpleNamespace(
        _DingTalkHandler=H,
        ChatbotMessage=types.SimpleNamespace(from_dict=lambda d: FakeCM()),
        AckMessage=types.SimpleNamespace(STATUS_OK="OK"))
    L.patch_dingtalk(m)
    asyncio.run(H().process(types.SimpleNamespace(data={})))
    assert calls.get("dt") == ("[语音] 明天下午三点开会", "u1"), calls
    assert "orig" not in calls, "audio 应被语音分支拦截，不落原文字逻辑"


def test_wecom_voice_content():
    """企微 voice 消息：body.voice.content 已是服务端转写文本，直接喂 run_agent。"""
    wc = {}

    class WeComApp:
        def _accept(self, frame): return ({"voice": {"content": "帮我查天气"}}, "u2", "c2")
        async def run_agent(self, chat_id, text): wc["r"] = (chat_id, text)
        async def start(self, client=None): wc["started"] = client

    m = types.SimpleNamespace(WeComApp=WeComApp, WSClient=lambda *a, **k: "CLIENT",
                              BOT_ID="b", SECRET="s")
    L.patch_wecom(m)
    asyncio.run(WeComApp().on_voice("frame"))
    assert wc.get("r") == ("c2", "[语音] 帮我查天气"), wc


def test_qq_attachment_voice_fallback():
    """QQ voice 附件：无可下载直链时回退 asr_refer_text，写回 data.content。"""
    qq = {}

    class Att:
        content_type = "voice"; voice_wav_url = None; url = None
        asr_refer_text = "周末一起爬山"

    class Data:
        content = ""; attachments = [Att()]; id = "m1"
        class author: user_openid = "u3"

    class QQApp:
        async def on_message(self, data, is_group=False): qq["c"] = data.content

    m = types.SimpleNamespace(QQApp=QQApp, public_access=lambda a: True, ALLOWED=set())
    L.patch_qq(m)
    asyncio.run(QQApp().on_message(Data()))
    assert qq.get("c") == "[语音] 周末一起爬山", qq


def test_wechat_no_token_exits_before_frontend_import():
    old_home = os.environ.get("HOME")
    old_argv = list(sys.argv)
    orig_import = builtins.__import__
    td = tempfile.mkdtemp()

    def guarded_import(name, *args, **kwargs):
        if name == "frontends.wechatapp":
            raise AssertionError("wechat frontend should not import before token check")
        return orig_import(name, *args, **kwargs)

    try:
        os.environ["HOME"] = td
        sys.argv = ["penglai_im_launch.py", "wechat"]
        builtins.__import__ = guarded_import
        assert L.launch_wechat() == 1
    finally:
        builtins.__import__ = orig_import
        sys.argv = old_argv
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home


def test_voice_redirect_revalidates_target(monkeypatch):
    class FakeRedirectOpener:
        def open(self, request, timeout):
            raise urllib.error.HTTPError(
                request.full_url,
                302,
                "Found",
                {"Location": "http://127.0.0.1/private"},
                None,
            )

    monkeypatch.setattr(L.socket, "getaddrinfo", lambda *args: [(2, 1, 6, "", ("93.184.216.34", 443))])
    monkeypatch.setattr("urllib.request.build_opener", lambda *args: FakeRedirectOpener())
    try:
        L._open_voice_url("https://public.example/audio.wav")
        raise AssertionError("private redirect must be rejected")
    except ValueError as error:
        assert "HTTPS" in str(error) or "private" in str(error)


def test_voice_url_rejects_private_dns(monkeypatch):
    monkeypatch.setattr(L.socket, "getaddrinfo", lambda *args: [(2, 1, 6, "", ("169.254.169.254", 443))])
    try:
        L._validate_voice_url("https://media.example/audio.wav")
        raise AssertionError("private DNS result must be rejected")
    except ValueError as error:
        assert "private" in str(error)


if __name__ == "__main__":
    test_dingtalk_audio_recognition()
    test_wecom_voice_content()
    test_qq_attachment_voice_fallback()
    test_wechat_no_token_exits_before_frontend_import()
    print("✅ test_im_voice: 钉钉/企微/QQ 语音 patch 全部通过")
