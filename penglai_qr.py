# -*- coding: utf-8 -*-
"""penglai_qr — 统一的终端 ASCII 二维码输出模块（无头服务器友好）。

设计目标（031rootv2 §5.4 CLI 二维码方案 A）：
  · 飞书/微信扫码配置在 CLI 中可完成，不依赖桌面 GUI
  · qrcode 库可用时输出 ASCII QR；缺失时降级为可点击 URL
  · 纯标准库实现，venv 建立之前也能运行（会借 venv 的 qrcode）

用法：
  from penglai_qr import print_ascii_qr
  if not print_ascii_qr(url):
      print("（请复制链接到手机浏览器打开）")
"""
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))


def _venv_python():
    p = os.path.join(ROOT, ".venv", "bin", "python")
    return p if os.path.exists(p) else None


def _try_print_local(url, invert=True):
    """在当前解释器里直接用 qrcode 库出码。成功返回 True。"""
    try:
        import qrcode  # noqa: F401
    except Exception:
        return False
    q = qrcode.QRCode(border=1)
    q.add_data(url)
    q.make(fit=True)
    q.print_ascii(invert=invert)
    return True


def _try_print_subprocess(url, invert=True):
    """当前解释器没有 qrcode 时，借 venv 的 python 子进程出码。"""
    py = _venv_python()
    if not py or py == sys.executable:
        return False
    code = ("import qrcode\n"
            "q=qrcode.QRCode(border=1)\n"
            "q.add_data(%r)\n"
            "q.make(fit=True)\n"
            "q.print_ascii(invert=%s)" % (url, invert))
    try:
        r = subprocess.run([py, "-c", code])
        return r.returncode == 0
    except Exception:
        return False


def print_ascii_qr(url, *, invert=True, fallback=True):
    """终端输出 ASCII 二维码。

    返回 True 表示二维码已成功渲染；False 表示不可用（已降级打印 URL，除非
    fallback=False）。无头服务器只要有 qrcode 库（venv 或系统）即可扫码，
    不依赖任何桌面 GUI。
    """
    if not url:
        return False
    if _try_print_local(url, invert=invert):
        return True
    if _try_print_subprocess(url, invert=invert):
        return True
    if fallback:
        print(f"  （终端二维码不可用，请用手机浏览器打开此链接确认）\n  {url}")
    return False


if __name__ == "__main__":
    # 自检：penglai_qr <url>
    if len(sys.argv) < 2:
        print("usage: penglai_qr <url>")
        sys.exit(1)
    ok = print_ascii_qr(sys.argv[1])
    sys.exit(0 if ok else 1)
