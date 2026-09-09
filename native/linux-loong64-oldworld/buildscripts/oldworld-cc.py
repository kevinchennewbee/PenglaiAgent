#!/usr/bin/env python3
"""gcc-compatible compiler wrapper around Zig build-obj/build-lib + Loongson
gcc 8.3 old-world sysroot. Zig cannot provide loongarch64-linux-gnu.2.28 libc
(only gnu.2.36 new-world); never use the default new-world loader.
"""
from __future__ import annotations

import os
import shlex
import subprocess
import sys
from pathlib import Path

WORK = Path(os.environ.get("WORK", "/tmp/penglai-uos20-oldworld-build"))
if not os.environ.get("ZIG"):
    raise RuntimeError("ZIG must be set to a Zig 0.16 binary")
ZIG = os.environ["ZIG"]
TARGET = os.environ.get("ZIG_TARGET", "loongarch64-linux-gnu.2.28")
_zig_lib = os.environ.get("ZIG_LIB_DIR")
ZIG_INCLUDE = Path(_zig_lib) / "include" if _zig_lib else Path(ZIG).resolve().parent.parent / "lib" / "zig" / "include"
SYSROOT = Path(os.environ.get("SYSROOT", WORK / "inputs/toolchain/sysroot"))
GCCLIB = Path(os.environ.get("GCCLIB", WORK / "inputs/toolchain/gcc-lib"))
LINKROOT = Path(os.environ.get("LINKROOT", WORK / "work/linkroot"))
LIBC_TXT = Path(os.environ.get("LIBC_TXT", WORK / "work/libc.txt"))
MODE = Path(sys.argv[0]).name  # oldworld-cc / oldworld-c++ / oldworld-ar

CXX = "c++" in MODE or MODE.endswith("++")


def is_src(p: str) -> bool:
    return Path(p).suffix.lower() in {".c", ".cc", ".cpp", ".cxx", ".s", ".S"}


def is_obj(p: str) -> bool:
    return Path(p).suffix.lower() in {".o", ".obj"}


def is_libfile(p: str) -> bool:
    name = Path(p).name
    return name.endswith(".a") or ".so" in name


def parse(argv: list[str]) -> dict:
    compile_only = False
    shared = False
    output = None
    includes: list[str] = []
    isystem: list[str] = []
    defines: list[str] = []
    libdirs: list[str] = []
    libs: list[str] = []
    cflags: list[str] = []
    sources: list[str] = []
    objects: list[str] = []
    libfiles: list[str] = []
    other: list[str] = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "-c":
            compile_only = True
        elif a == "-shared":
            shared = True
        elif a == "-o":
            i += 1
            output = argv[i]
        elif a.startswith("-o") and len(a) > 2:
            output = a[2:]
        elif a == "-I":
            i += 1
            includes.append(argv[i])
        elif a.startswith("-I"):
            includes.append(a[2:])
        elif a in {"-MD", "-MMD", "-MP", "-MG"}:
            pass
        elif a in {"-MT", "-MF", "-MQ"}:
            i += 1
        elif a == "-isystem":
            i += 1
            isystem.append(argv[i])
        elif a == "-D":
            i += 1
            defines.append(argv[i])
        elif a.startswith("-D"):
            defines.append(a[2:])
        elif a == "-L":
            i += 1
            libdirs.append(argv[i])
        elif a.startswith("-L"):
            libdirs.append(a[2:])
        elif a.startswith("-l"):
            libs.append(a[2:])
        elif a in {"-fPIC", "-fpic", "-fPIE"}:
            cflags.append("-fPIC")
        elif a.startswith("-Wl,") or a.startswith("-soname"):
            # Must run before the -W* cflag catch: otherwise -Wl,-soname and
            # -Wl,--no-undefined are swallowed and Zig never sees them.
            other.append(a)
        elif a == "-z":
            other.append(a)
            if i + 1 < len(argv):
                i += 1
                other.append(argv[i])
        elif a.startswith("-std=") or a.startswith("-O") or a.startswith("-W") or a.startswith("-f") or a.startswith("-m"):
            if a not in {"-fPIC", "-fpic"}:
                cflags.append(a)
        elif a in {"-pthread", "-pthreads"}:
            libs.append("pthread")
        elif a in {"-g", "-ggdb", "-pipe", "-pthread"}:
            pass
        elif a in {"-static", "-rdynamic", "-s", "-shared"}:
            other.append(a)
        elif a.startswith("-"):
            # keep unknown flags as cflags so meson feature tests still see them
            cflags.append(a)
        elif is_src(a):
            sources.append(a)
        elif is_obj(a):
            objects.append(a)
        elif is_libfile(a):
            libfiles.append(a)
        else:
            other.append(a)
        i += 1
    return {
        "compile_only": compile_only,
        "shared": shared,
        "output": output,
        "includes": includes,
        "isystem": isystem,
        "defines": defines,
        "libdirs": libdirs,
        "libs": libs,
        "cflags": cflags,
        "sources": sources,
        "objects": objects,
        "libfiles": libfiles,
        "other": other,
    }


def zig_base() -> list[str]:
    cmd = [
        ZIG,
        "build-obj" if True else "build-lib",
        "-fPIC",
        "-OReleaseSmall",
        "-target",
        TARGET,
        "--libc",
        str(LIBC_TXT),
        "-isystem",
        str(SYSROOT / "usr/include/c++/8.3.0"),
        "-isystem",
        str(GCCLIB / "include"),
        "-isystem",
        str(GCCLIB / "include-fixed"),
        "-isystem",
        str(SYSROOT / "usr/include"),
    ]
    return cmd


def resolve_lib(name: str, libdirs: list[str]) -> str | None:
    search = [Path(d) for d in libdirs] + [LINKROOT / "usr/lib64", LINKROOT / "lib64", SYSROOT / "usr/lib64", SYSROOT / "lib64"]
    candidates = [
        f"lib{name}.so",
        f"lib{name}.so.6",
        f"lib{name}.so.1",
        f"lib{name}.so.2",
        f"lib{name}.so.0",
        f"lib{name}.a",
    ]
    for d in search:
        for c in candidates:
            p = d / c
            if p.exists():
                return str(p)
    return None


def run(cmd: list[str]) -> int:
    env = os.environ.copy()
    env.setdefault("ZIG_GLOBAL_CACHE_DIR", str(WORK / "cache/zig-global"))
    env.setdefault("ZIG_LOCAL_CACHE_DIR", str(WORK / "cache/zig-local"))
    print("+", shlex.join(cmd), file=sys.stderr)
    return subprocess.call(cmd, env=env)


def compile_to(src: str, output: str, p: dict) -> int:
    cmd = [
        ZIG,
        "build-obj",
        "-fPIC",
        "-OReleaseSmall",
        "-target",
        TARGET,
        "--libc",
        str(LIBC_TXT),
        "-isystem",
        str(ZIG_INCLUDE),
        "-isystem",
        str(WORK / "work/include-stubs"),
        "-isystem",
        str(SYSROOT / "usr/include/c++/8.3.0"),
        "-isystem",
        str(SYSROOT / "usr/include"),
        f"-femit-bin={output}",
    ]
    for d in p["isystem"]:
        cmd += ["-isystem", d]
    for d in p["includes"]:
        cmd += ["-I", d]
    for d in p["defines"]:
        cmd += [f"-D{d}"]
    extra = list(p["cflags"])
    extra.append("-D_POSIX_HOST_NAME_MAX=255")
    extra.append("-Wno-unused-but-set-variable")
    extra.append("-Wno-error=unused-but-set-variable")
    if CXX and not any(x.startswith("-std=") for x in extra):
        extra.append("-std=c++17")
    if extra:
        cmd += ["-cflags", *extra, "--"]
    cmd.append(src)
    return run(cmd)


def parse_soname(other: list[str], output: str) -> str:
    for a in other:
        if a.startswith("-Wl,"):
            parts = a.split(",")[1:]
            i = 0
            while i < len(parts):
                p = parts[i]
                if p == "-soname" and i + 1 < len(parts):
                    return parts[i + 1]
                if p.startswith("-soname="):
                    return p.split("=", 1)[1]
                if p.startswith("-soname"):
                    return p[len("-soname") :]
                i += 1
        if a == "-rdynamic":
            continue
    return Path(output).name


def always_syslibs() -> list[str]:
    names = [
        "m",
        "pthread",
        "dl",
        "resolv",
        "atomic",
        "rt",
        "gcc_s",
    ]
    out: list[str] = []
    seen: set[str] = set()
    for name in names:
        resolved = resolve_lib(name, [])
        if resolved and resolved not in seen:
            seen.add(resolved)
            out.append(resolved)
    return out


def link_shared(output: str, p: dict) -> int:
    soname = parse_soname(p["other"], output)
    # Zig 0.16 `build-lib` rejects `-Wl,--no-undefined`. `-fno-allow-shlib-undefined`
    # still emits strong UND. `-z defs` is the lld class guard. TLS objects need
    # `ld.so.1` on the link line or `__tls_get_addr` fails that guard.
    cmd = [
        ZIG,
        "build-lib",
        "-dynamic",
        "-fPIC",
        "-OReleaseSmall",
        "-target",
        TARGET,
        "--libc",
        str(LIBC_TXT),
        "--gc-sections",
        f"-femit-bin={output}",
        f"-fsoname={soname}",
        "-z",
        "defs",
        str(LINKROOT / "lib64/libc.so.6"),
        str(LINKROOT / "lib64/ld.so.1"),
    ]
    rpaths: list[str] = []
    for a in p["other"]:
        parts = a.split(",")[1:] if a.startswith("-Wl,") else ([a] if a in {"-z", "defs", "--no-undefined"} else [])
        if a == "-z":
            continue
        for part in parts:
            if part.startswith("-rpath=") or part.startswith("-rpath,"):
                rpaths.append(part.split("=", 1)[-1].split(",", 1)[-1])
            elif part == "-rpath":
                continue
            elif part.startswith("$ORIGIN") or part.startswith("/"):
                rpaths.append(part)
            elif part in {"--no-undefined", "-zdefs", "-z", "defs"}:
                # already passed as `-z defs` above; Zig rejects `-Wl,--no-undefined`
                continue
    for rp in rpaths:
        if rp:
            cmd += ["-rpath", rp]
    for o in p["objects"]:
        cmd.append(o)
    for src in p["sources"]:
        cmd.append(src)
    for lf in p["libfiles"]:
        cmd.append(lf)
    for name in p["libs"]:
        if name in {"c", "gcc", "gcc_s", "compiler-rt", "stdc++fs"}:
            continue
        if name.startswith(":"):
            # gcc -l:libvips-cpp.so.8.18.6
            raw = name[1:]
            found = None
            for d in [Path(x) for x in p["libdirs"]] + [LINKROOT / "usr/lib64", Path(str(WORK / "work/vips-prefix/lib"))]:
                cand = d / raw
                if cand.exists():
                    found = str(cand)
                    break
            if found:
                cmd.append(found)
            else:
                print(f"warning: unresolved -l:{raw}", file=sys.stderr)
            continue
        resolved = resolve_lib(name, p["libdirs"])
        if resolved:
            cmd.append(resolved)
        else:
            print(f"warning: unresolved -l{name}", file=sys.stderr)
    cmd += always_syslibs()
    # C++ runtime: add when invoked as c++ or any C++ source is present.
    if CXX or any(Path(s).suffix.lower() in {".cc", ".cpp", ".cxx"} for s in p["sources"]):
        cmd.append(str(LINKROOT / "usr/lib64/libstdc++.so.6"))
        cmd.append(str(LINKROOT / "usr/lib64/libgcc_s.so.1"))
    return run(cmd)


def main() -> int:
    argv = sys.argv[1:]
    if MODE.endswith("ar") or MODE == "oldworld-ar":
        return run([ZIG, "ar", "--format=gnu", *argv])
    if not argv:
        return 0
    if any(a in {"-Wl,--version", "-Wl,-v"} for a in argv) and not any(is_src(a) or is_obj(a) for a in argv):
        sys.stdout.write("LLD 21.1.8 (compatible with GNU linkers)\n")
        return 0
    if argv == ["-dumpmachine"]:
        sys.stdout.write("loongarch64-linux-gnu\n")
        return 0
    if argv and argv[0] in {"-dumpversion", "-V", "-qversion", "-version"}:
        sys.stdout.write("8.3.0\n")
        return 0
    if argv and argv[0] in {"--version", "-v"} and len(argv) == 1:
        # Meson identifies compilers from this banner.
        sys.stdout.write(
            "clang version 21.1.8\n"
            "Target: loongarch64-unknown-linux-gnu\n"
            "Thread model: posix\n"
            f"InstalledDir: {WORK / 'work'}\n"
        )
        return 0
    if "-E" in argv or "-dM" in argv:
        # Preprocess only. Meson gperf rules pass `-E -P -xc ... -c file`;
        # `-c` must not win or gperf `%{` directives are compiled as C.
        filt = [a for a in argv if a != "-c"]
        cmd = [
            ZIG,
            "c++" if CXX else "cc",
            "-target",
            TARGET,
            "-isystem",
            str(SYSROOT / "usr/include/c++/8.3.0"),
            "-isystem",
            str(GCCLIB / "include"),
            "-isystem",
            str(GCCLIB / "include-fixed"),
            "-isystem",
            str(SYSROOT / "usr/include"),
            *filt,
        ]
        return run(cmd)
    p = parse(argv)
    if p["compile_only"]:
        if not p["sources"]:
            print("oldworld-cc: -c without source", file=sys.stderr)
            return 1
        out = p["output"] or str(Path(p["sources"][0]).with_suffix(".o"))
        if len(p["sources"]) != 1:
            print("oldworld-cc: one source per -c", file=sys.stderr)
            return 1
        return compile_to(p["sources"][0], out, p)
    if p["shared"] or (p["output"] and str(p["output"]).endswith(".so")) or (
        p["output"] and ".so." in str(p["output"])
    ):
        if not p["output"]:
            print("oldworld-cc: shared link missing -o", file=sys.stderr)
            return 1
        return link_shared(p["output"], p)
    # default to shared if objects+sources and output is .node
    if p["output"] and str(p["output"]).endswith(".node"):
        return link_shared(p["output"], p)
    # executable / autotools conftest (default a.out)
    if not p["output"] and (p["sources"] or p["objects"]) and not p["compile_only"]:
        p["output"] = "a.out"
    if p["output"] and (p["sources"] or p["objects"]):
        cmd = [
            ZIG,
            "build-exe",
            "-fPIC",
            "-OReleaseSmall",
            "-target",
            TARGET,
            "--libc",
            str(LIBC_TXT),
            "-isystem",
            str(SYSROOT / "usr/include/c++/8.3.0"),
            "-isystem",
            str(GCCLIB / "include"),
            "-isystem",
            str(GCCLIB / "include-fixed"),
            "-isystem",
            str(SYSROOT / "usr/include"),
            f"-femit-bin={p['output']}",
            str(LINKROOT / "lib64/libc.so.6"),
            # TLS resolver lives in old-world ld.so.1 (GLIBC_2.27), not libc.
            str(LINKROOT / "lib64/ld.so.1"),
        ]
        for d in p["isystem"]:
            cmd += ["-isystem", d]
        for d in p["includes"]:
            cmd += ["-I", d]
        for d in p["defines"]:
            cmd += [f"-D{d}"]
        extra = list(p["cflags"])
        if extra:
            cmd += ["-cflags", *extra, "--"]
        cmd += p["objects"] + p["sources"] + p["libfiles"]
        for name in p["libs"]:
            if name in {"c", "gcc", "gcc_s", "compiler-rt"}:
                continue
            resolved = resolve_lib(name, p["libdirs"])
            if resolved:
                cmd.append(resolved)
        return run(cmd)
    print("oldworld-cc: unhandled invocation:", argv, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
