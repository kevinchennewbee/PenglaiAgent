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
    ok, why, rp = fg._is_outbound_allowed(p)
    assert ok, f"工作目录内文件应允许外发，却被拦：{why}"
    assert rp == os.path.realpath(p), "应返回 realpath 解析后的路径（供发送时使用，堵 TOCTOU）"


def test_blocked_repo_secret_path():
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    # 仓库根下的文件（非 temp/）—— 模拟 [FILE:/.../mykey.py] 外发，必须拒
    secret = os.path.join(REPO, "mykey_template.py")
    assert os.path.exists(secret)
    ok, why, rp = fg._is_outbound_allowed(secret)
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
    ok, why, rp = fg._is_outbound_allowed(link)
    assert not ok, "软链接逃逸到工作目录外必须被拦（realpath 解析）"


def test_blocked_missing_file():
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    ok, why, rp = fg._is_outbound_allowed("/nonexistent/path/x.bin")
    assert not ok, "不存在的文件不应放行"


def _fake_fsapp_main():
    """模拟生产形态：python frontends/fsapp.py → 模块名 __main__。"""
    import types
    fake = types.ModuleType("__main__")
    fake.__file__ = os.path.join(REPO, "frontends", "fsapp.py")
    fake._send_local_file = lambda *a, **k: "SENT"
    fake.sent = []
    fake.send_message = lambda rid, msg, **k: fake.sent.append(msg)
    return fake


def test_mount_in_script_mode():
    """生产部署（systemd/docker）跑 `python frontends/fsapp.py`，fsapp 的模块名是
    __main__ —— 只查 frontends.fsapp 会静默 fail-open（2026-06-11 真机事故）。"""
    fg = _fileguard()
    fake = _fake_fsapp_main()
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式（__main__=fsapp.py）必须能挂载"
        assert fake._send_local_file is fg._guarded_send_local_file, "包装未生效"
        # 越界文件走包装后必须被拦，且通过模块对象回话（不重新 import fsapp）
        os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
        r = fake._send_local_file("u1", os.path.join(REPO, "mykey_template.py"))
        assert r is False, "越界外发未被拦截"
        assert fake.sent and "蓬莱安全策略" in fake.sent[0], "未通知用户拦截原因"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


def test_no_mount_in_foreign_main():
    """scheduler/wechat 等其他进程的 __main__ 不是 fsapp —— 绝不能误挂。"""
    import types
    fg = _fileguard()
    fake = types.ModuleType("__main__")
    fake.__file__ = os.path.join(REPO, "agentmain.py")
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert not fg._try_patch(), "非 fsapp 进程不应挂载 fileguard"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


def test_send_forwards_realpath_not_symlink():
    """TOCTOU 修复：放行后实际发送的必须是 realpath 解析后的路径（=校验时确认的
    那条），而不是原始（可能被 swap 的软链）路径。"""
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    real = os.path.join(td, "real_report.pdf")
    open(real, "w").write("x")
    link = os.path.join(td, "alias.pdf")
    try:
        os.symlink(real, link)
    except (OSError, NotImplementedError):
        return  # 平台不支持软链接则跳过
    fake = _fake_fsapp_main()
    got = {}

    def rec(rid, fp, *a, **k):
        got["path"] = fp
        return "SENT"

    fake._send_local_file = rec   # 必须在 _try_patch 前设好（挂载时捕获原始函数）
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式必须能挂载"
        fake._send_local_file("u1", link)   # 走包装后的 _guarded_send_local_file
        assert got.get("path") == os.path.realpath(link), \
            f"发送应用 realpath（{os.path.realpath(link)}），实际：{got.get('path')}"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
