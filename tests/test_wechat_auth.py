# -*- coding: utf-8 -*-
import os


def test_wechat_channel_declares_allowlist_key():
    import penglai_channels

    assert penglai_channels.CHANNELS["wechat"]["allow"] == "wechat_allowed_users"


def test_wechat_template_documents_fail_closed_allowlist():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    text = open(os.path.join(root, "mykey_template.py"), encoding="utf-8").read()

    assert "wechat_allowed_users" in text
    assert "必填" in text
