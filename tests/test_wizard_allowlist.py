# -*- coding: utf-8 -*-
"""F-003：向导实测捕获主人 open_id 后，把空的 fs_allowed_users 收紧为 [open_id]；
已非空时尊重现状不覆盖。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import fresh_import, run_tests


def _setup_mykey(body):
    td = tempfile.mkdtemp()
    with open(os.path.join(td, "mykey.py"), "w", encoding="utf-8") as f:
        f.write(body)
    ps = fresh_import("penglai_setup")   # 纯标准库，无需伪 GA
    ps.ROOT = td
    return ps, os.path.join(td, "mykey.py")


def test_empty_allowlist_gets_locked():
    ps, path = _setup_mykey(
        "fs_app_id = 'cli_x'\n"
        "fs_allowed_users = []   # 留空=对所有可见用户开放（不安全）；向导实测时会自动收紧为你本人\n")
    changed = ps._patch_allowlist("ou_owner123")
    assert changed is True
    ns = {}
    exec(open(path, encoding="utf-8").read(), ns)
    assert ns["fs_allowed_users"] == ["ou_owner123"], "空白名单应被收紧为主人 open_id"
    assert ns["fs_owner_open_id"] == "ou_owner123", "主人通知目标也应写入"


def test_nonempty_allowlist_is_respected():
    ps, path = _setup_mykey("fs_allowed_users = ['ou_existing']\n")
    changed = ps._patch_allowlist("ou_other")
    assert changed is False, "已非空的白名单不应被覆盖"
    ns = {}
    exec(open(path, encoding="utf-8").read(), ns)
    assert ns["fs_allowed_users"] == ["ou_existing"], "原白名单应原样保留"
    assert ns["fs_owner_open_id"] == "ou_other", "不覆盖白名单也应补主人通知目标"


def test_manual_feishu_setup_mentions_card_action_trigger():
    src = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "penglai_setup.py"),
               encoding="utf-8").read()
    assert "im.message.receive_v1" in src
    assert "card.action.trigger" in src


def test_setup_command_hint_explains_path_not_current_directory():
    src = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "penglai_setup.py"),
               encoding="utf-8").read()
    assert "说明 PATH 没有包含 ~/.local/bin" in src
    assert "不要在家目录使用 ./penglai" in src
    assert "重开终端，或先用 ./penglai" not in src


def test_no_autostart_manual_mode_covers_wechat_and_scheduler():
    src = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "penglai_setup.py"),
               encoding="utf-8").read()
    assert "不安装系统服务：现在临时后台启动已配置渠道并验证" in src
    assert "_spawn_wechat(py)" in src
    assert '_spawn_reflect(py, "scheduler", "reflect/scheduler.py"' in src


def test_setup_abilities_offer_optional_tts_without_forcing_big_download():
    src = open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "penglai_setup.py"),
               encoding="utf-8").read()
    assert "语音输出嘴巴" in src
    assert "MOSS-TTS-Nano" in src
    assert "约下载 728MB ONNX 权重" in src
    assert 'ask(T("现在启用语音输出？(y/n)"), "n")' in src
    assert '"penglai"), "enable", "tts"' in src


def test_manual_start_commands_use_absolute_install_dir():
    ps, _ = _setup_mykey("")
    ps.ROOT = "/opt/penglai"
    cmds = ps._manual_start_commands("/opt/penglai/.venv/bin/python",
                                     with_feishu=True, with_companion=True,
                                     with_wechat=True)
    text = "\n".join(line for _label, line in cmds)
    assert "cd /opt/penglai && /opt/penglai/.venv/bin/python /opt/penglai/penglai_im_launch.py wechat" in text
    assert "cd /opt/penglai && /opt/penglai/.venv/bin/python /opt/penglai/agentmain.py --reflect /opt/penglai/reflect/scheduler.py" in text


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
