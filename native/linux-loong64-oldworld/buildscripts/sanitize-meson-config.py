#!/usr/bin/env python3
"""Undef meson has_function false positives that glibc 2.28 does not provide.

Meson compile-only tests against Zig/clang succeed for BSD/Windows symbols
that are absent from the Loongson gcc 8.3 / glibc 2.28 sysroot.
"""
from __future__ import annotations

import sys
from pathlib import Path

UNDEF = [
    "HAVE_GETPROGNAME",
    "HAVE_GETEXECNAME",
    "HAVE__MKTEMP_S",
    "HAVE__VSNPRINTF_L",
    "HAVE_VASPRINTF_L",
    "HAVE_ARC4RANDOM",
    "HAVE_ARC4RANDOM_BUF",
    "HAVE_ISSETUGID",
    "HAVE_STRLCAT",
    "HAVE_STRLCPY",
    "HAVE_CLOSEFROM",
    "HAVE__ALIGNED_MALLOC",
    "HAVE__FSEEKI64",
    "HAVE_LCHFLAGS",
    "HAVE_CYGWIN_CONV_PATH",
    "HAVE_FREE_SIZED",
    "HAVE_FREE_ALIGNED_SIZED",
    "G_HAVE_FREE_SIZED",
    "HAVE_STATX",
    "HAVE_PIDFD_OPEN",
    "HAVE_CLOSE_RANGE",
]


def sanitize(path: Path) -> int:
    if not path.is_file():
        return 0
    text = path.read_text()
    orig = text
    for name in UNDEF:
        text = text.replace(f"#define {name} 1", f"#undef {name}")
        text = text.replace(f"#define {name} TRUE", f"#undef {name}")
        text = text.replace(f"#define {name}\n", f"#undef {name}\n")
    if text != orig:
        path.write_text(text)
        print(f"sanitized {path}")
        return 1
    return 0


def main() -> int:
    root = Path(sys.argv[1])
    n = 0
    for name in ("meson-config.h", "config.h", "include/config.h", "glib/glibconfig.h"):
        n += sanitize(root / name)
    for p in root.rglob("meson-config.h"):
        n += sanitize(p)
    for p in root.rglob("config.h"):
        n += sanitize(p)
    for p in root.rglob("glibconfig.h"):
        n += sanitize(p)
    print(f"sanitize-meson-config touched={n} under {root}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
