#!/usr/bin/env python3
"""
shots/render_terminal.py — 把真实 CLI 输出渲染成 macOS 终端窗口风格 PNG。

用法：
  python3 render_terminal.py <input.txt> <out.png> [--from N] [--to N] [--drop-last K] [--title T]

- 输入是产品真实输出（可带行号区间裁剪 scrollback，不改字）；
- 深色墨底、红黄绿窗钮、Menlo（西文/框线）+ Noto Sans SC（中文）+ Apple Color Emoji；
- 2x 超采样渲染后 LANCZOS 缩回，保证清晰；
- 行级语义着色：节标题金色、✓ 验证绿、› 对话青、注释灰。
"""

import argparse
import os
import re
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

MENLO = "/System/Library/Fonts/Menlo.ttc"
EMOJI = "/System/Library/Fonts/Apple Color Emoji.ttc"


def first_font(env_name, candidates):
    configured = os.environ.get(env_name)
    paths = ([configured] if configured else []) + candidates
    for candidate in paths:
        if candidate and Path(candidate).is_file():
            return candidate
    raise SystemExit(
        f"No usable CJK font found. Set {env_name} to an installed TTF/TTC/OTF file."
    )


NOTO_SC = first_font(
    "PENGLAI_CJK_FONT",
    [
        str(Path.home() / "Library/Fonts/NotoSansSC-Regular.ttf"),
        "/Library/Fonts/NotoSansSC-Regular.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Light.ttc",
    ],
)
NOTO_SC_BOLD = first_font(
    "PENGLAI_CJK_BOLD_FONT",
    [
        str(Path.home() / "Library/Fonts/NotoSansSC-Bold.ttf"),
        "/Library/Fonts/NotoSansSC-Bold.ttf",
        "/System/Library/Fonts/PingFang.ttc",
        "/System/Library/Fonts/Hiragino Sans GB.ttc",
        "/System/Library/Fonts/STHeiti Medium.ttc",
        NOTO_SC,
    ],
)

SCALE = 2
FONT_PX = 15 * SCALE
LINE_H = int(FONT_PX * 1.55)
PAD_X = 18 * SCALE
PAD_Y = 14 * SCALE
TITLE_H = 30 * SCALE
MAX_W = 1180 * SCALE

BG = (23, 24, 28)
TITLEBAR = (31, 32, 38)
INK = (216, 213, 204)      # 纸白
DIM = (138, 138, 130)      # 灰
GOLD = (201, 162, 90)      # 金（节标题）
GREEN = (126, 168, 110)    # 验证绿
CYAN = (127, 179, 200)     # 对话青
VERMIL = (196, 69, 49)     # 朱砂

_fonts = {}
def font(kind):
    if kind not in _fonts:
        if kind == "menlo":
            _fonts[kind] = ImageFont.truetype(MENLO, FONT_PX)
        elif kind == "cjk":
            _fonts[kind] = ImageFont.truetype(NOTO_SC, FONT_PX)
        elif kind == "cjk-bold":
            _fonts[kind] = ImageFont.truetype(NOTO_SC_BOLD, FONT_PX)
        elif kind == "emoji":
            _fonts[kind] = ImageFont.truetype(EMOJI, 160)  # 固定 strike，绘制后缩放
    return _fonts[kind]


def is_cjk(ch):
    o = ord(ch)
    return (
        0x2E80 <= o <= 0x9FFF
        or 0xF900 <= o <= 0xFAFF
        or 0xFF00 <= o <= 0xFFEF
        or 0x3000 <= o <= 0x303F
        or o in (0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026)
    )


def is_emoji(ch):
    return ord(ch) >= 0x1F000


def char_font(ch, bold=False):
    if is_emoji(ch):
        return "emoji"
    if is_cjk(ch):
        return "cjk-bold" if bold else "cjk"
    return "menlo"


def line_width(line, bold=False):
    w = 0.0
    for ch in line:
        k = char_font(ch, bold)
        if k == "emoji":
            w += LINE_H * 0.92
        else:
            w += font(k).getlength(ch)
    return w


def draw_line(img, draw, x, y, line, color, bold=False):
    for ch in line:
        k = char_font(ch, bold)
        if k == "emoji":
            f = font("emoji")
            tmp = Image.new("RGBA", (200, 200), (0, 0, 0, 0))
            ImageDraw.Draw(tmp).text((10, 10), ch, font=f, embedded_color=True)
            bbox = tmp.getbbox()
            if bbox:
                tmp = tmp.crop(bbox)
                h = LINE_H - int(3 * SCALE)
                w = int(tmp.width * h / tmp.height)
                tmp = tmp.resize((w, h), Image.LANCZOS)
                img.paste(tmp, (int(x), int(y + (LINE_H - h) // 2)), tmp)
                x += w + 1 * SCALE
            continue
        f = font(k)
        draw.text((x, y), ch, font=f, fill=color)
        x += f.getlength(ch)
    return x


def style_of(line):
    s = line.strip()
    if s.startswith("──") or s.startswith("🏮"):
        return GOLD, True
    if s.startswith("✓") or s.startswith("  ✓"):
        return GREEN, False
    if s.startswith("›"):
        return CYAN, False
    if s.startswith("==="):
        return DIM, False
    if "（隔离目录" in s or s.startswith("隔离数据目录"):
        return DIM, False
    return INK, False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("out")
    ap.add_argument("--from", dest="start", type=int, default=1)
    ap.add_argument("--to", dest="end", type=int, default=None)
    ap.add_argument("--drop-last", type=int, default=0)
    ap.add_argument("--title", default="penglai — zsh")
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    lines = lines[args.start - 1 : args.end]
    if args.drop_last:
        lines = lines[: -args.drop_last]
    # 去掉 ANSI 转义（真实 tty 输出可能带色）
    lines = [re.sub(r"\x1b\[[0-9;]*m", "", ln).rstrip() for ln in lines]

    max_w = max((line_width(ln) for ln in lines), default=0)
    w = min(int(max_w + PAD_X * 2), MAX_W)
    h = TITLE_H + PAD_Y * 2 + LINE_H * len(lines)

    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    # 标题栏
    draw.rectangle([0, 0, w, TITLE_H], fill=TITLEBAR)
    for i, c in enumerate(((255, 95, 87), (254, 188, 46), (40, 200, 100))):
        cx = 18 * SCALE + i * 22 * SCALE
        cy = TITLE_H // 2
        r = 6 * SCALE
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)
    tf = font("cjk")
    tw = tf.getlength(args.title)
    draw.text(((w - tw) / 2, (TITLE_H - LINE_H * 0.72) / 2), args.title, font=tf, fill=DIM)

    y = TITLE_H + PAD_Y
    for ln in lines:
        color, bold = style_of(ln)
        if line_width(ln, bold) > w - PAD_X * 2:
            # 超宽行截断（真实终端同样不换行裁剪）
            while ln and line_width(ln + "…", bold) > w - PAD_X * 2:
                ln = ln[:-1]
            ln = ln + "…" if ln else ln
        draw_line(img, draw, PAD_X, y, ln, color, bold)
        y += LINE_H

    # 圆角遮罩
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=10 * SCALE, fill=255)
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.paste(img, (0, 0), mask)

    canvas = canvas.resize((w // SCALE, h // SCALE), Image.LANCZOS)
    canvas.save(args.out)
    print(f"[shots] {args.out} {canvas.size} lines={len(lines)}")


if __name__ == "__main__":
    main()
