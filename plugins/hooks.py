import os
import sys
import importlib
import importlib.util
import re

# 模块级注册表: event_name -> [callback, ...]
_registry = {}
_PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def register(event):
    def decorator(fn):
        _registry.setdefault(event, []).append(fn)
        return fn
    return decorator


def trigger(event, ctx: dict):
    for fn in _registry.get(event, []):
        try:
            r = fn(ctx)
            if isinstance(r, dict):
                ctx = r
        except Exception as e:
            sys.stderr.write(f"[hooks] {event} callback error: {e}\n")
    return ctx


def unregister(event, fn):
    try:
        _registry[event] = [f for f in _registry[event] if f is not fn]
    except KeyError:
        pass


def clear(event=None):
    if event:
        _registry.pop(event, None)
    else:
        _registry.clear()


def has(event):
    return bool(_registry.get(event))


class PluginLoadError(RuntimeError):
    """聚合一个或多个插件加载失败。strict 模式下由 discover_and_load 抛出。"""


def discover_and_load(plugin_dir=None, strict=False):
    """发现并加载 plugin_dir 下所有插件。

    strict=False（历史行为，仍 fail-open）：每个插件独立 try/except，失败只写
    stderr 并继续。返回按插件名索引的 {name: True|False} 结果。

    strict=True（0.3.5 发布门禁）：聚合所有失败插件，只要有任一加载失败就抛
    PluginLoadError，错误信息列出全部失败插件及原因。agentmain / _guardcheck
    的默认启动路径应使用 strict=True，让坏插件阻断启动而不是静默 fail-open。
    """
    if plugin_dir is None:
        plugin_dir = os.path.join(_PROJECT_ROOT, 'plugins')
    results = {}
    plugin_dir = os.path.abspath(plugin_dir)
    if not os.path.isdir(plugin_dir):
        return results
    parent = os.path.dirname(plugin_dir)
    pkg_name = os.path.basename(plugin_dir)
    if parent not in sys.path:
        sys.path.insert(0, parent)
    failures = {}
    for fn in sorted(os.listdir(plugin_dir)):
        if fn.startswith('_') or not fn.endswith('.py'):
            continue
        name = fn[:-3]
        ok, err = _load_module(f"{pkg_name}.{name}", plugin_root=plugin_dir, expected_package=pkg_name)
        results[name] = ok
        if not ok:
            failures[name] = err
    if strict and failures:
        names = ", ".join(sorted(failures))
        details = "; ".join(f"{n}: {e}" for n, e in sorted(failures.items()))
        raise PluginLoadError(
            f"refusing to load with broken plugins [{names}]: {details}. "
            f"Set PENGLAI_ALLOW_UNGUARDED=1 only for explicit emergency/debug bypass."
        )
    return results


def load(name):
    """向后兼容：返回 True/False，失败只写 stderr。新代码应改用 strict 路径。

    保留 `plugins.{name}` 写法以兼容现有调用方（guardcheck 等）。
    """
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", str(name or "")):
        sys.stderr.write(f"[hooks] invalid plugin name: {name!r}\n")
        return False
    ok, err = _load_module(f'plugins.{name}')
    if not ok:
        sys.stderr.write(f"[hooks] plugin '{name}' load failed: {err}\n")
    return ok


def _load_module(full_module_name, plugin_root=None, expected_package="plugins"):
    """加载指定全限定模块名，返回 (ok, error_or_None)。"""
    try:
        prefix = f"{expected_package}."
        name = full_module_name[len(prefix):] if full_module_name.startswith(prefix) else ""
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]{0,63}", name):
            raise ValueError("plugin module must be one direct child of the selected plugin package")
        spec = importlib.util.find_spec(full_module_name)
        origin = os.path.realpath(spec.origin or "") if spec else ""
        allowed_root = os.path.realpath(plugin_root or os.path.join(_PROJECT_ROOT, "plugins"))
        if not origin or os.path.commonpath((allowed_root, origin)) != allowed_root:
            raise ValueError("plugin module resolves outside the repository plugins directory")
        importlib.import_module(full_module_name)
        return True, None
    except Exception as e:
        return False, str(e)
