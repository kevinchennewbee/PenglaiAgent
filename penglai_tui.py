# -*- coding: utf-8 -*-
"""蓬莱终端对话入口 — 上游 GA tuiapp_v2 的品牌化薄包装（内核零改动）。

上游 TUI 左上角身份角标与欢迎语写死 "GenericAgent"，发行版不改内核文件，
在这里 import 后运行时替换两处展示字符串，其余行为与上游完全一致。
由 `penglai` / `penglai tui` 调起；直接 `python penglai_tui.py` 也可。
"""
import os
import sys

ROOT = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, ROOT)
os.chdir(ROOT)

import frontends.tuiapp_v2 as t   # noqa: E402（需先定 ROOT/cwd 再 import）


def render_status_chip(busy, elapsed=0):
    chip = t.Text()
    chip.append("✦ ", style=t.C_GREEN if busy else t.C_DIM)
    chip.append("蓬莱 Penglai", style=f"bold {t.C_GREEN}" if busy else f"bold {t.C_FG}")
    return chip


t.render_status_chip = render_status_chip

_orig_on_mount = t.GenericAgentTUI.on_mount


def _on_mount(self):
    # 欢迎语烤在上游 on_mount 里，临时替换 self._system 改写那一句后即恢复
    orig_system = self._system

    def _system(msg, *a, **kw):
        if isinstance(msg, str) and "Welcome to GenericAgent TUI" in msg:
            msg = msg.replace("Welcome to GenericAgent TUI",
                              "欢迎来到蓬莱 · 你的个人管家")
        return orig_system(msg, *a, **kw)

    self._system = _system
    try:
        return _orig_on_mount(self)
    finally:
        del self._system   # 去掉实例属性，恢复类方法

t.GenericAgentTUI.on_mount = _on_mount


if __name__ == "__main__":
    raise SystemExit(t.main())
