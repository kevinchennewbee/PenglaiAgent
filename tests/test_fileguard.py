# -*- coding: utf-8 -*-
"""F-004：出站文件白名单——只允许外发工作目录/临时目录内的文件，
绝对路径、越界、软链接逃逸、密钥目录一律拒绝。"""
import os
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import install_fakes, fresh_import, run_tests, REPO


def _fileguard():
    install_fakes()
    fresh_import("plugins.penglai_redline")
    return fresh_import("plugins.penglai_fileguard")


def test_allowed_inside_workspace():
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    p = os.path.join(td, "report.pdf")
    open(p, "w").write("x")
    ok, why = fg._is_outbound_allowed(p)
    assert ok, f"工作目录内文件应允许外发，却被拦：{why}"


def test_blocked_repo_secret_path():
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    # 仓库根下的文件（非 temp/）—— 模拟 [FILE:/.../mykey.py] 外发，必须拒
    secret = os.path.join(REPO, "mykey_template.py")
    assert os.path.exists(secret)
    ok, why = fg._is_outbound_allowed(secret)
    assert not ok, "仓库根下的敏感文件不应被外发"


def test_blocked_symlink_escape():
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    # 工作目录里放一个软链接指向仓库外的真实文件，realpath 解析后越界 → 拒
    link = os.path.join(td, "innocent.txt")
    try:
        os.symlink(os.path.join(REPO, "mykey_template.py"), link)
    except (OSError, NotImplementedError):
        return  # 平台不支持软链接则跳过
    ok, why = fg._is_outbound_allowed(link)
    assert not ok, "软链接逃逸到工作目录外必须被拦（realpath 解析）"


def test_blocked_missing_file():
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    ok, why = fg._is_outbound_allowed("/nonexistent/path/x.bin")
    assert not ok, "不存在的文件不应放行"


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
