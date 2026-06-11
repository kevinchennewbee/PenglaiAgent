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


def test_nonempty_allowlist_is_respected():
    ps, path = _setup_mykey("fs_allowed_users = ['ou_existing']\n")
    changed = ps._patch_allowlist("ou_other")
    assert changed is False, "已非空的白名单不应被覆盖"
    ns = {}
    exec(open(path, encoding="utf-8").read(), ns)
    assert ns["fs_allowed_users"] == ["ou_existing"], "原白名单应原样保留"


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
