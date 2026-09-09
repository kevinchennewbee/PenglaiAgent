#!/usr/bin/env python3
"""Architecture-proof ELF inspector for UOS 20 old-world linux-loong64.

Does not execute the binary. Shared objects often have no PT_INTERP;
absence is not old-world proof. Rejects new-world loader strings and
GLIBC symbols newer than 2.28.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

ELF_MAGIC = b"\x7fELF"
EM_LOONGARCH = 258
PT_INTERP = 3
PT_DYNAMIC = 2
PT_NOTE = 4
DT_NEEDED = 1
DT_STRTAB = 5
DT_STRSZ = 10
DT_SONAME = 14
DT_RPATH = 15
DT_RUNPATH = 29
DT_VERNEED = 0x6FFFFFFE
DT_VERNEEDNUM = 0x6FFFFFFF
OLD_INTERP = "/lib64/ld.so.1"
NEW_INTERP = "/lib64/ld-linux-loongarch-lp64d.so.1"
NEW_LOADER_SONAME = "ld-linux-loongarch-lp64d.so.1"
# LoongArch ELF e_flags: EF_LARCH_OBJABI_V1 = 0x40 is new-world object ABI.
EF_LARCH_OBJABI_V1 = 0x40
DT_SYMTAB = 6
DT_SYMENT = 11
DT_HASH = 4
DT_GNU_HASH = 0x6FFFFEF5
DT_FLAGS = 30
DT_FLAGS_1 = 0x6FFFFFFB
STB_WEAK = 2
HOST_PATH_NEEDLES = (
    b"/private/tmp/",
    b"/Users/",
    b"apple-darwin",
    b"/opt/homebrew",
    b"/Volumes/",
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def u16(b: bytes, off: int, le: bool) -> int:
    return int.from_bytes(b[off : off + 2], "little" if le else "big")


def u32(b: bytes, off: int, le: bool) -> int:
    return int.from_bytes(b[off : off + 4], "little" if le else "big")


def u64(b: bytes, off: int, le: bool) -> int:
    return int.from_bytes(b[off : off + 8], "little" if le else "big")


def cstr(b: bytes, off: int) -> str:
    end = b.find(b"\x00", off)
    if end < 0:
        return b[off:].decode("latin1", errors="replace")
    return b[off:end].decode("latin1", errors="replace")


def glibc_newer_than_228(versions: list[str]) -> list[str]:
    out = []
    for v in versions:
        if not v.startswith("GLIBC_"):
            continue
        parts = v.split("_", 1)[1].split(".")
        if len(parts) < 2:
            continue
        major, minor = int(parts[0]), int(parts[1])
        if major > 2 or (major == 2 and minor > 28):
            out.append(v)
    return sorted(set(out))


def inspect_bytes(data: bytes, label: str) -> dict:
    result = {
        "label": label,
        "size": len(data),
        "sha256": hashlib.sha256(data).hexdigest(),
        "elf": False,
    }
    if len(data) < 64 or data[:4] != ELF_MAGIC:
        result["reason"] = "not ELF"
        result["darwin"] = data[:4] in (b"\xcf\xfa\xed\xfe", b"\xfe\xed\xfa\xcf", b"\xca\xfe\xba\xbe")
        return result
    result["elf"] = True
    ei_class = data[4]
    ei_data = data[5]
    le = ei_data == 1
    result["class"] = {1: "ELF32", 2: "ELF64"}.get(ei_class, ei_class)
    result["data"] = "LE" if le else "BE"
    result["e_type"] = u16(data, 16, le)
    result["e_machine"] = u16(data, 18, le)
    result["e_flags"] = u32(data, 36, le)
    result["e_flags_hex"] = hex(result["e_flags"])
    result["objabi_v1_newworld_flag"] = bool(result["e_flags"] & EF_LARCH_OBJABI_V1)
    if ei_class != 2:
        result["reason"] = "not ELF64"
        return result
    phoff = u64(data, 32, le)
    phentsize = u16(data, 54, le)
    phnum = u16(data, 56, le)
    shoff = u64(data, 40, le)
    shentsize = u16(data, 58, le)
    shnum = u16(data, 60, le)
    shstrndx = u16(data, 62, le)
    interp = None
    dyn_off = None
    dyn_sz = None
    for i in range(phnum):
        off = phoff + i * phentsize
        if off + 56 > len(data):
            break
        p_type = u32(data, off, le)
        p_offset = u64(data, off + 8, le)
        p_filesz = u64(data, off + 32, le)
        if p_type == PT_INTERP:
            raw = data[p_offset : p_offset + p_filesz]
            interp = raw.split(b"\x00", 1)[0].decode("utf-8", errors="replace")
        elif p_type == PT_DYNAMIC:
            dyn_off, dyn_sz = p_offset, p_filesz
    result["pt_interp"] = interp
    result["shared_object_no_pt_interp"] = interp is None
    needed = []
    soname = None
    rpath = None
    runpath = None
    strtab_addr = None
    strsz = None
    dyn_entries = []
    if dyn_off is not None:
        for i in range(dyn_sz // 16):
            eoff = dyn_off + i * 16
            tag = int.from_bytes(data[eoff : eoff + 8], "little" if le else "big", signed=True)
            val = u64(data, eoff + 8, le)
            if tag == 0:
                break
            dyn_entries.append((tag, val))
            if tag == DT_STRTAB:
                strtab_addr = val
            elif tag == DT_STRSZ:
                strsz = val
        # Map virtual address of strtab to file offset via program headers
        def vaddr_to_off(addr: int) -> int | None:
            for i in range(phnum):
                off = phoff + i * phentsize
                p_type = u32(data, off, le)
                if p_type != 1 and p_type != PT_DYNAMIC:
                    # PT_LOAD = 1
                    continue
                p_offset = u64(data, off + 8, le)
                p_vaddr = u64(data, off + 16, le)
                p_filesz = u64(data, off + 32, le)
                p_type2 = u32(data, off, le)
                if p_type2 != 1:
                    continue
                if p_vaddr <= addr < p_vaddr + p_filesz:
                    return p_offset + (addr - p_vaddr)
            return None

        strtab = b""
        if strtab_addr is not None:
            soff = vaddr_to_off(strtab_addr)
            if soff is not None:
                n = strsz or 65536
                strtab = data[soff : soff + n]
        def dynstr(val: int) -> str:
            if not strtab or val >= len(strtab):
                return f"<str:{val}>"
            return cstr(strtab, val)

        tags = dict(dyn_entries)
        for tag, val in dyn_entries:
            if tag == DT_NEEDED:
                needed.append(dynstr(val))
            elif tag == DT_SONAME:
                soname = dynstr(val)
            elif tag == DT_RPATH:
                rpath = dynstr(val)
            elif tag == DT_RUNPATH:
                runpath = dynstr(val)
        result["dt_flags"] = tags.get(DT_FLAGS, 0)
        result["dt_flags_1"] = tags.get(DT_FLAGS_1, 0)
        result["bind_now"] = bool(result["dt_flags"] & 0x8) or bool(result["dt_flags_1"] & 0x1)
        und: list[dict] = []
        nsyms = 0
        gnu_hash = tags.get(DT_GNU_HASH)
        if gnu_hash is not None:
            ho = vaddr_to_off(gnu_hash)
            if ho is not None:
                nbuckets = u32(data, ho, le)
                symoffset = u32(data, ho + 4, le)
                bloom_size = u32(data, ho + 8, le)
                buckets_off = ho + 16 + bloom_size * 8
                max_sym = 0
                for i in range(nbuckets):
                    b = u32(data, buckets_off + i * 4, le)
                    if b == 0:
                        continue
                    chain_idx = b
                    while True:
                        chain_off = buckets_off + nbuckets * 4 + (chain_idx - symoffset) * 4
                        val = u32(data, chain_off, le)
                        if chain_idx > max_sym:
                            max_sym = chain_idx
                        chain_idx += 1
                        if val & 1:
                            break
                nsyms = max_sym + 1
        if nsyms == 0 and DT_HASH in tags:
            ho = vaddr_to_off(tags[DT_HASH])
            if ho is not None:
                nsyms = u32(data, ho + 4, le)
        symtab_addr = tags.get(DT_SYMTAB)
        syment = tags.get(DT_SYMENT, 24)
        if symtab_addr is not None and nsyms:
            so = vaddr_to_off(symtab_addr)
            if so is not None:
                for i in range(nsyms):
                    e = so + i * syment
                    st_name = u32(data, e, le)
                    st_info = data[e + 4]
                    st_shndx = u16(data, e + 6, le)
                    if st_shndx == 0 and st_name:
                        und.append(
                            {
                                "name": dynstr(st_name),
                                "bind": st_info >> 4,
                                "type": st_info & 0xF,
                            }
                        )
        result["dynsym_n"] = nsyms
        result["und"] = und
        result["und_strong"] = [s["name"] for s in und if s["bind"] != STB_WEAK]
        result["und_weak"] = [s["name"] for s in und if s["bind"] == STB_WEAK]
    result["dt_needed"] = needed
    result["dt_soname"] = soname
    result["dt_rpath"] = rpath
    result["dt_runpath"] = runpath
    result.setdefault("und", [])
    result.setdefault("und_strong", [])
    result.setdefault("und_weak", [])
    import re

    glibc = sorted(set(m.decode() for m in re.findall(rb"GLIBC_\d+\.\d+", data)))
    glibcxx = sorted(set(m.decode() for m in re.findall(rb"GLIBCXX_\d+\.\d+", data)))
    cxxabi = sorted(set(m.decode() for m in re.findall(rb"CXXABI_\d+\.\d+", data)))
    gcc = sorted(set(m.decode() for m in re.findall(rb"GCC_\d+\.\d+(?:\.\d+)?", data)))
    result["gnu_symbol_versions"] = {
        "GLIBC": glibc,
        "GLIBCXX": glibcxx,
        "CXXABI": cxxabi,
        "GCC": gcc,
    }
    result["glibc_newer_than_2.28"] = glibc_newer_than_228(glibc)
    result["contains_newworld_loader_string"] = NEW_LOADER_SONAME.encode() in data
    result["contains_oldworld_loader_string"] = OLD_INTERP.encode() in data
    result["host_path_needles"] = [
        n.decode("latin1") for n in HOST_PATH_NEEDLES if n in data
    ]
    gnu_linux = [m.decode() for m in re.findall(rb"for GNU/Linux [0-9.]+", data)]
    result["gnu_linux_notes"] = gnu_linux
    result["loongarch"] = result["e_machine"] == EM_LOONGARCH
    result["darwin_or_macho"] = False
    problems = []
    if result["e_machine"] != EM_LOONGARCH:
        problems.append(f"e_machine {result['e_machine']} is not LoongArch 258")
    if interp == NEW_INTERP or result["contains_newworld_loader_string"]:
        problems.append("new-world loader ld-linux-loongarch-lp64d.so.1")
    if interp is not None and interp != OLD_INTERP:
        problems.append(f"PT_INTERP {interp} is not {OLD_INTERP}")
    if result["objabi_v1_newworld_flag"]:
        problems.append("e_flags has EF_LARCH_OBJABI_V1 (0x40) new-world object ABI")
    if result["glibc_newer_than_2.28"]:
        problems.append("GLIBC newer than 2.28: " + ",".join(result["glibc_newer_than_2.28"]))
    result["problems"] = problems
    result["oldworld_arch_ok"] = len(problems) == 0
    result["native_execution"] = "UNRUN"
    return result


def _exported_names(path: Path) -> set[str]:
    data = path.read_bytes()
    le = data[5] == 1
    phoff = u64(data, 32, le)
    phentsize = u16(data, 54, le)
    phnum = u16(data, 56, le)
    loads = []
    dyn_off = dyn_sz = None
    for i in range(phnum):
        off = phoff + i * phentsize
        p_type = u32(data, off, le)
        p_offset = u64(data, off + 8, le)
        p_vaddr = u64(data, off + 16, le)
        p_filesz = u64(data, off + 32, le)
        if p_type == 1:
            loads.append((p_offset, p_vaddr, p_filesz))
        elif p_type == PT_DYNAMIC:
            dyn_off, dyn_sz = p_offset, p_filesz
    if dyn_off is None:
        return set()

    def v2o(addr: int) -> int | None:
        for off, va, fs in loads:
            if va <= addr < va + fs:
                return off + (addr - va)
        return None

    tags: dict[int, int] = {}
    for i in range(dyn_sz // 16):
        tag = int.from_bytes(data[dyn_off + i * 16 : dyn_off + i * 16 + 8], "little" if le else "big", signed=True)
        val = u64(data, dyn_off + i * 16 + 8, le)
        if tag == 0:
            break
        tags[tag] = val
    strtab_addr = tags.get(DT_STRTAB)
    strsz = tags.get(DT_STRSZ, 0)
    if strtab_addr is None:
        return set()
    so = v2o(strtab_addr)
    if so is None:
        return set()
    strtab = data[so : so + strsz]
    gnu_hash = tags.get(DT_GNU_HASH)
    nsyms = 0
    if gnu_hash is not None:
        ho = v2o(gnu_hash)
        if ho is not None:
            nbuckets = u32(data, ho, le)
            symoffset = u32(data, ho + 4, le)
            bloom_size = u32(data, ho + 8, le)
            buckets_off = ho + 16 + bloom_size * 8
            max_sym = 0
            for i in range(nbuckets):
                b = u32(data, buckets_off + i * 4, le)
                if b == 0:
                    continue
                chain_idx = b
                while True:
                    chain_off = buckets_off + nbuckets * 4 + (chain_idx - symoffset) * 4
                    val = u32(data, chain_off, le)
                    if chain_idx > max_sym:
                        max_sym = chain_idx
                    chain_idx += 1
                    if val & 1:
                        break
            nsyms = max_sym + 1
    if nsyms == 0 and DT_HASH in tags:
        ho = v2o(tags[DT_HASH])
        if ho is not None:
            nsyms = u32(data, ho + 4, le)
    symtab_addr = tags.get(DT_SYMTAB)
    syment = tags.get(DT_SYMENT, 24)
    names: set[str] = set()
    if symtab_addr is None or not nsyms:
        return names
    so = v2o(symtab_addr)
    if so is None:
        return names
    for i in range(nsyms):
        e = so + i * syment
        st_name = u32(data, e, le)
        st_info = data[e + 4]
        st_shndx = u16(data, e + 6, le)
        bind = st_info >> 4
        if st_shndx != 0 and bind in (1, 2, 10) and st_name:
            names.add(cstr(strtab, st_name))
    return names


def resolve_needed(sysroot: Path, name: str) -> Path | None:
    for d in (sysroot / "lib64", sysroot / "usr/lib64", sysroot / "lib", sysroot / "usr/lib"):
        cand = d / name
        if cand.exists():
            return cand
    return None


def classify_und_against_sysroot(rec: dict, sysroot: Path) -> list[str]:
    needed = list(rec.get("dt_needed") or [])
    if "ld.so.1" not in needed:
        needed.append("ld.so.1")
    providers: dict[str, str] = {}
    for name in needed:
        path = resolve_needed(sysroot, name)
        if path is None:
            continue
        for sym in _exported_names(path):
            providers.setdefault(sym, name)
    unresolved = []
    for s in rec.get("und") or []:
        if s.get("bind") == STB_WEAK:
            continue
        if s.get("name") not in providers:
            unresolved.append(s["name"])
    return unresolved


def inspect_path(path: Path) -> dict:
    data = path.read_bytes()
    rec = inspect_bytes(data, str(path))
    rec["path"] = str(path)
    rec["file_sha256"] = rec["sha256"]
    return rec


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--require-ok", action="store_true")
    ap.add_argument("--sysroot", type=Path, default=None, help="old-world linkroot; classify strong UND against DT_NEEDED + ld.so.1")
    ap.add_argument("--expect-soname", default=None)
    ap.add_argument("--forbid-host-paths", action="store_true")
    args = ap.parse_args()
    rows = [inspect_path(Path(p)) for p in args.paths]
    for rec in rows:
        extra = rec.setdefault("problems", [])
        if args.expect_soname and rec.get("dt_soname") != args.expect_soname:
            extra.append(f"DT_SONAME {rec.get('dt_soname')!r} != {args.expect_soname!r}")
        if args.forbid_host_paths and rec.get("host_path_needles"):
            extra.append("host path needles: " + ",".join(rec["host_path_needles"]))
        if args.sysroot:
            unresolved = classify_und_against_sysroot(rec, args.sysroot)
            rec["und_strong_unresolved"] = unresolved
            if unresolved:
                extra.append("strong UND not in DT_NEEDED+ld.so.1: " + ",".join(unresolved[:20]))
        rec["oldworld_arch_ok"] = len(rec.get("problems") or []) == 0
    if args.json:
        json.dump(rows if len(rows) > 1 else rows[0], sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        for rec in rows:
            print(f"{rec.get('path')}")
            print(f"  elf={rec.get('elf')} machine={rec.get('e_machine')} flags={rec.get('e_flags_hex')}")
            print(f"  PT_INTERP={rec.get('pt_interp')} (shared_no_interp={rec.get('shared_object_no_pt_interp')})")
            print(f"  DT_SONAME={rec.get('dt_soname')} DT_NEEDED={rec.get('dt_needed')}")
            print(f"  BIND_NOW={rec.get('bind_now')} und_strong={len(rec.get('und_strong') or [])} und_weak={rec.get('und_weak')}")
            if rec.get("und_strong_unresolved") is not None:
                print(f"  und_strong_unresolved={rec.get('und_strong_unresolved')}")
            print(f"  GLIBC={rec.get('gnu_symbol_versions', {}).get('GLIBC')}")
            print(f"  problems={rec.get('problems')}")
            print(f"  oldworld_arch_ok={rec.get('oldworld_arch_ok')} sha256={rec.get('sha256')}")
    if args.require_ok and any(not r.get("oldworld_arch_ok") for r in rows):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
