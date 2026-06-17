# -*- coding: utf-8 -*-
"""F-004：出站文件门禁——只拦 .py/.env/.key/.sh/.pem 后缀，不按目录拦。"""
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _harness import install_fakes, fresh_import, run_tests, REPO


def _fileguard():
    install_fakes()
    fresh_import("plugins.penglai_redline")
    return fresh_import("plugins.penglai_fileguard")


def _clear_fileguard_env():
    pass


def test_allowed_inside_workspace():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    p = os.path.join(td, "report.pdf")
    open(p, "w").write("x")
    ok, why, rp = fg._is_outbound_allowed(p)
    assert ok, f"工作目录内文件应允许外发，却被拦：{why}"
    assert rp == os.path.realpath(p), "应返回 realpath 解析后的路径（供发送时使用，堵 TOCTOU）"


def test_blocked_repo_secret_path():
    _clear_fileguard_env()
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    # 仓库根下的文件（非 temp/）—— 模拟 [FILE:/.../mykey.py] 外发，必须拒
    secret = os.path.join(REPO, "mykey_template.py")
    assert os.path.exists(secret)
    ok, why, rp = fg._is_outbound_allowed(secret)
    assert not ok, "仓库根下的敏感文件不应被外发"


def test_blocked_symlink_escape():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    # 工作目录里放一个软链接指向 .py，realpath 后按目标后缀拦截。
    link = os.path.join(td, "innocent.txt")
    try:
        os.symlink(os.path.join(REPO, "mykey_template.py"), link)
    except (OSError, NotImplementedError):
        return  # 平台不支持软链接则跳过
    ok, why, rp = fg._is_outbound_allowed(link)
    assert not ok, "软链接指向 .py 目标时必须被拦（realpath 解析）"


def test_blocked_missing_file():
    _clear_fileguard_env()
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    ok, why, rp = fg._is_outbound_allowed("/nonexistent/path/x.bin")
    assert not ok, "不存在的文件不应放行"


def test_safe_artifact_outside_workspace_is_allowed_by_default():
    _clear_fileguard_env()
    fg = _fileguard()
    os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
    td = tempfile.mkdtemp(prefix="penglai-artifact-", dir=os.path.dirname(REPO))
    try:
        p = os.path.join(td, "report.pdf")
        open(p, "w").write("x")
        ok, why, rp = fg._is_outbound_allowed(p)
        assert ok, f"安全产物默认不应因目录被拦：{why}"
        assert rp == os.path.realpath(p)
    finally:
        shutil.rmtree(td, ignore_errors=True)


def test_blocked_code_or_key_suffix_even_inside_workspace():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    for name in ("script.py", "run.sh", "secret.pem", "file.key", "config.env", ".env"):
        p = os.path.join(td, name)
        open(p, "w").write("x")
        ok, why, rp = fg._is_outbound_allowed(p)
        assert not ok, f"{name} 不应自动外发"
        assert "敏感后缀" in why


def test_sensitive_name_txt_is_allowed_by_suffix_only_policy():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    p = os.path.join(td, "api_token.txt")
    open(p, "w").write("x")
    ok, why, rp = fg._is_outbound_allowed(p)
    assert ok, f"只按后缀拦截时 .txt 不应因文件名被拦：{why}"


def _fake_fsapp_main():
    """模拟生产形态：python frontends/fsapp.py → 模块名 __main__。"""
    import types
    fake = types.ModuleType("__main__")
    fake.__file__ = os.path.join(REPO, "frontends", "fsapp.py")
    fake.TEMP_DIR = os.path.join(REPO, "temp")
    fake._send_local_file = lambda *a, **k: "SENT"
    fake._send_generated_files = lambda *a, **k: "ORIG_BATCH"
    fake._extract_files = lambda text: __import__("re").findall(r"\[FILE:([^\]]+)\]", text or "")
    fake.sent = []
    fake.sent_messages = []
    fake.send_message = lambda rid, msg, **k: fake.sent_messages.append((rid, msg, k)) or fake.sent.append(msg)
    fake._upload_file_sync = lambda fp: "file_key_" + os.path.basename(fp)
    return fake


def _fake_fsapp_module():
    """模拟 0.2.8 包装器形态：penglai_feishu_app.py import frontends.fsapp。"""
    import types
    fake = types.ModuleType("frontends.fsapp")
    fake.__file__ = os.path.join(REPO, "frontends", "fsapp.py")
    fake.TEMP_DIR = os.path.join(REPO, "temp")
    fake._send_local_file = lambda *a, **k: "SENT"
    fake._send_generated_files = lambda *a, **k: "ORIG_BATCH"
    fake._extract_files = lambda text: __import__("re").findall(r"\[FILE:([^\]]+)\]", text or "")
    fake.sent = []
    fake.sent_messages = []
    fake.send_message = lambda rid, msg, **k: fake.sent_messages.append((rid, msg, k)) or fake.sent.append(msg)
    fake._upload_file_sync = lambda fp: "file_key_" + os.path.basename(fp)
    return fake


def test_mount_in_script_mode():
    """生产部署（systemd/docker）跑 `python frontends/fsapp.py`，fsapp 的模块名是
    __main__ —— 只查 frontends.fsapp 会静默 fail-open（2026-06-11 真机事故）。"""
    _clear_fileguard_env()
    fg = _fileguard()
    fake = _fake_fsapp_main()
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式（__main__=fsapp.py）必须能挂载"
        assert fake._send_local_file is fg._guarded_send_local_file, "包装未生效"
        # 敏感文件走包装后必须被拦，且通过模块对象回话（不重新 import fsapp）
        os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
        r = fake._send_local_file("u1", os.path.join(REPO, "mykey_template.py"))
        assert r is False, "敏感文件外发未被拦截"
        assert fake.sent and "蓬莱安全策略" in fake.sent[0], "未通知用户拦截原因"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


def test_mount_in_module_mode():
    """0.2.8 起飞书由 penglai_feishu_app.py 包装导入 frontends.fsapp，fileguard
    必须在模块形态下同样挂载。"""
    _clear_fileguard_env()
    fg = _fileguard()
    fake = _fake_fsapp_module()
    saved = sys.modules.get("frontends.fsapp")
    try:
        sys.modules["frontends.fsapp"] = fake
        assert fg._try_patch(), "frontends.fsapp 模块形态必须能挂载"
        assert fake._send_local_file is fg._guarded_send_local_file, "包装未生效"
        os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
        r = fake._send_local_file("u1", os.path.join(REPO, "mykey_template.py"))
        assert r is False, "模块形态下敏感文件外发未被拦截"
        assert fake.sent and "蓬莱安全策略" in fake.sent[0], "未通知用户拦截原因"
    finally:
        if saved is not None:
            sys.modules["frontends.fsapp"] = saved
        else:
            sys.modules.pop("frontends.fsapp", None)


def test_no_mount_in_foreign_main():
    """scheduler/wechat 等其他进程的 __main__ 不是 fsapp —— 绝不能误挂。"""
    import types
    _clear_fileguard_env()
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
    _clear_fileguard_env()
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


def test_generated_files_batch_preflight_sends_valid_and_summarizes_blocked():
    """多个 [FILE:] 先批量预检：合法文件照常发；不存在/敏感文件只汇总一条提示，
    不再刷屏多条「拒绝外发该文件」。"""
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    valid = os.path.join(td, "ok.png")
    open(valid, "w").write("x")
    missing = os.path.join(td, "missing.png")
    secret = os.path.join(REPO, "mykey_template.py")
    fake = _fake_fsapp_main()
    sent_paths = []
    fake._send_local_file = lambda rid, fp, *a, **k: sent_paths.append(fp) or True
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式必须能挂载"
        fake._send_generated_files("u1", f"[FILE:{valid}]\n[FILE:{missing}]\n[FILE:{secret}]")
        assert sent_paths == [os.path.realpath(valid)], sent_paths
        assert len(fake.sent) == 1, f"应只发一条汇总拦截消息，实际：{fake.sent}"
        assert "2 个文件未外发" in fake.sent[0]
        assert "文件不存在" in fake.sent[0]
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


def test_generated_files_ignores_placeholder_marker_without_warning():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    valid = os.path.join(td, "ok.md")
    open(valid, "w").write("# ok")
    fake = _fake_fsapp_main()
    sent_paths = []
    fake._send_local_file = lambda rid, fp, *a, **k: sent_paths.append(fp) or True
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式必须能挂载"
        fake._send_generated_files("u1", f"旧机制是 [FILE:...]，真正文件是 [FILE:{valid}]")
        assert sent_paths == [os.path.realpath(valid)]
        assert not fake.sent, f"占位符不应触发安全警告：{fake.sent}"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


def test_download_video_artifact_sends_directly_by_default():
    _clear_fileguard_env()
    fg = _fileguard()
    home = tempfile.mkdtemp(prefix="penglai-test-home-", dir=os.path.dirname(REPO))
    old_home = os.environ.get("HOME")
    old_ws = os.environ.get("GA_WORKSPACE_ROOT")
    try:
        os.environ["HOME"] = home
        os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
        downloads = os.path.join(home, "Downloads")
        os.makedirs(downloads)
        video = os.path.join(downloads, "jarvis.mp4")
        open(video, "wb").write(b"video")
        fake = _fake_fsapp_main()
        uploaded = []
        fake._upload_file_sync = lambda fp: uploaded.append(fp) or "file_key_" + os.path.basename(fp)
        saved = sys.modules.get("__main__")
        try:
            sys.modules["__main__"] = fake
            assert fg._try_patch(), "脚本模式必须能挂载"
            assert fake._send_local_file("u1", video) is True
            assert uploaded == [os.path.realpath(video)]
        finally:
            if saved is not None:
                sys.modules["__main__"] = saved
    finally:
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        if old_ws is None:
            os.environ.pop("GA_WORKSPACE_ROOT", None)
        else:
            os.environ["GA_WORKSPACE_ROOT"] = old_ws
        shutil.rmtree(home, ignore_errors=True)


def test_sensitive_download_filename_txt_sends_by_suffix_only_policy():
    _clear_fileguard_env()
    fg = _fileguard()
    home = tempfile.mkdtemp(prefix="penglai-test-home-", dir=os.path.dirname(REPO))
    old_home = os.environ.get("HOME")
    old_ws = os.environ.get("GA_WORKSPACE_ROOT")
    try:
        os.environ["HOME"] = home
        os.environ["GA_WORKSPACE_ROOT"] = tempfile.mkdtemp()
        downloads = os.path.join(home, "Downloads")
        os.makedirs(downloads)
        path = os.path.join(downloads, "api_token.txt")
        open(path, "wb").write(b"secret")
        fake = _fake_fsapp_main()
        saved = sys.modules.get("__main__")
        try:
            sys.modules["__main__"] = fake
            assert fg._try_patch(), "脚本模式必须能挂载"
            assert fake._send_local_file("u1", path) == "SENT"
            assert not fake.sent
        finally:
            if saved is not None:
                sys.modules["__main__"] = saved
    finally:
        if old_home is None:
            os.environ.pop("HOME", None)
        else:
            os.environ["HOME"] = old_home
        if old_ws is None:
            os.environ.pop("GA_WORKSPACE_ROOT", None)
        else:
            os.environ["GA_WORKSPACE_ROOT"] = old_ws
        shutil.rmtree(home, ignore_errors=True)


def test_video_files_are_sent_as_feishu_media_messages():
    _clear_fileguard_env()
    fg = _fileguard()
    td = tempfile.mkdtemp()
    os.environ["GA_WORKSPACE_ROOT"] = td
    video = os.path.join(td, "ok.mp4")
    open(video, "wb").write(b"video")
    fake = _fake_fsapp_main()
    fake._send_local_file = lambda *a, **k: "SHOULD_NOT_USE_MEDIA_PATH"
    saved = sys.modules.get("__main__")
    try:
        sys.modules["__main__"] = fake
        assert fg._try_patch(), "脚本模式必须能挂载"
        assert fake._send_local_file("u1", video) is True
        assert fake.sent_messages, "应通过 send_message 发送文件消息"
        rid, content, kwargs = fake.sent_messages[0]
        assert rid == "u1"
        assert '"file_key": "file_key_ok.mp4"' in content
        assert kwargs.get("msg_type") == "media"
    finally:
        if saved is not None:
            sys.modules["__main__"] = saved


if __name__ == "__main__":
    raise SystemExit(run_tests(dict(globals())))
