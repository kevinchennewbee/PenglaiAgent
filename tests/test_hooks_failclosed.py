# -*- coding: utf-8 -*-
"""Phase 0 发布阻断：插件 strict fail-closed 加载测试。

验证：
1. 正常插件能通过 strict load。
2. 坏插件在 strict 模式下阻断（抛 PluginLoadError）。
3. 非 strict 模式保持历史 fail-open 兼容。
4. PluginLoadError 是 RuntimeError 子类，可被 agentmain 的 except Exception 捕获。

注意：conftest.py 的 autouse fixture 会在每个测试后把 sys.modules['plugins.hooks']
还原。为了让真实 plugins.hooks 可被 import，本测试文件在模块级把项目根加入 sys.path。
"""
import importlib
import os
import sys

import pytest

# 确保项目根在 sys.path，这样真实的 plugins.hooks 可被 import
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _PROJECT_ROOT not in sys.path:
    sys.path.insert(0, _PROJECT_ROOT)


def _make_pkg(tmp_path, name="test_plugs"):
    """在 tmp_path/name 下造一个插件包目录（带 __init__.py）。"""
    pkg = tmp_path / name
    pkg.mkdir()
    (pkg / "__init__.py").write_text("")
    return pkg


def test_strict_load_raises_on_broken_plugin(tmp_path, monkeypatch):
    pkg = _make_pkg(tmp_path, "plugs_mixed")
    (pkg / "good_plugin.py").write_text("VALUE = 42\n")
    (pkg / "broken_plugin.py").write_text(
        "raise RuntimeError('intentional broken plugin for test')\n"
    )
    # 让 plugs_mixed 包可被 import（discover_and_load 会把 parent 加入 sys.path）
    monkeypatch.syspath_prepend(str(tmp_path))

    import plugins.hooks as h

    with pytest.raises(h.PluginLoadError) as exc_info:
        h.discover_and_load(plugin_dir=str(pkg), strict=True)

    msg = str(exc_info.value)
    assert "broken_plugin" in msg
    assert "intentional broken plugin" in msg


def test_non_strict_load_keeps_fail_open_compat(tmp_path, monkeypatch):
    pkg = _make_pkg(tmp_path, "plugs_compat")
    (pkg / "good_plugin.py").write_text("VALUE = 42\n")
    (pkg / "broken_plugin.py").write_text(
        "raise RuntimeError('intentional broken plugin for test')\n"
    )
    monkeypatch.syspath_prepend(str(tmp_path))

    import plugins.hooks as h

    results = h.discover_and_load(plugin_dir=str(pkg), strict=False)
    assert results.get("good_plugin") is True
    assert results.get("broken_plugin") is False


def test_strict_load_passes_when_all_good(tmp_path, monkeypatch):
    pkg = _make_pkg(tmp_path, "plugs_good")
    (pkg / "alpha.py").write_text("X = 1\n")
    (pkg / "beta.py").write_text("Y = 2\n")

    import plugins.hooks as h

    results = h.discover_and_load(plugin_dir=str(pkg), strict=True)
    assert results.get("alpha") is True
    assert results.get("beta") is True


def test_load_returns_bool_and_writes_stderr(tmp_path, monkeypatch):
    # load() 保留 plugins.{name} 写法兼容现有调用方。
    # 用一个确定不存在的插件名验证 False 返回和 stderr 写入。
    import plugins.hooks as h

    assert h.load("good_plugin") in (True, False)  # 真实环境可能无此插件
    assert h.load("definitely_missing_plugin_xyz") is False
    # 捕获 stderr 验证写入
    import io
    old = sys.stderr
    sys.stderr = io.StringIO()
    try:
        h.load("definitely_missing_plugin_xyz")
        err_out = sys.stderr.getvalue()
    finally:
        sys.stderr = old
    assert "definitely_missing_plugin_xyz" in err_out


def test_plugin_load_error_is_runtime_error_subclass():
    import plugins.hooks as h

    assert issubclass(h.PluginLoadError, RuntimeError)
