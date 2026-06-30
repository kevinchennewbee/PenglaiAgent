# -*- coding: utf-8 -*-
import asyncio
import importlib
import os
import sys
import tempfile
import types


def test_wecom_save_media_sanitizes_empty_basename(monkeypatch):
    frontends_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontends")
    if frontends_dir not in sys.path:
        sys.path.insert(0, frontends_dir)
    fake_sdk = types.ModuleType("wecom_aibot_sdk")
    fake_sdk.WSClient = object
    fake_sdk.generate_req_id = lambda prefix: f"{prefix}-1"
    monkeypatch.setitem(sys.modules, "wecom_aibot_sdk", fake_sdk)

    mod = importlib.import_module("frontends.wecomapp")
    td = tempfile.mkdtemp()
    monkeypatch.setattr(mod, "MEDIA_DIR", td)

    class Client:
        async def download_file(self, _url, _aes_key):
            return {"buffer": b"x", "filename": "../../"}

    app = object.__new__(mod.WeComApp)
    app.client = Client()
    path = asyncio.run(app._save_media("u", "k", "fallback.bin"))

    assert os.path.dirname(path) == td
    assert os.path.basename(path) == "fallback.bin"
    assert os.path.isfile(path)


def test_wechat_safe_media_name_uses_basename_without_importing_runtime():
    src = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontends", "wechatapp.py"), encoding="utf-8").read()
    assert "def _safe_media_name" in src
    assert "os.path.basename" in src
    assert "fname = _safe_media_name(sub.get('file_name'), ext)" in src
