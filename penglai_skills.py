# -*- coding: utf-8 -*-
"""蓬莱技能集市（T1 · 本地 apt 模式）：skills/ 放出厂精选技能，penglai skill list/install/installed/remove。

- 技能 = 纯指导 SOP（markdown + frontmatter）。装 = 拷进 memory/penglai_skill_<name>_sop.md（L3，按需读）
  + 把「触发词→该 SOP」记进 memory/penglai_skills_index.md（L3 技能库索引，按需读）。
- L1（global_mem_insight.txt，每轮注入系统提示，≤30 行硬约束）只留【一行常量指针】指向索引——
  不随技能数膨胀，守住 GA「极简索引层」第一性原理（依据 memory/memory_management_sop.md）。
- 本地装、不联网、不从网上拉（出厂技能随发行版精选投放；T2 社区投稿是后话）。
- 安装前过 memguard 威胁扫描（纵深防御：出厂技能已审，装时再扫一道，命中即拒）。
- GA 内核零改动；纯标准库。
"""
import os, re, sys

ROOT = os.path.dirname(os.path.realpath(__file__))
SKILLS_DIR = os.path.join(ROOT, "skills")
MEM_DIR = os.path.join(ROOT, "memory")
INSIGHT = os.path.join(MEM_DIR, "global_mem_insight.txt")
INDEX_FILE = "penglai_skills_index.md"
TAG = "[蓬莱技能]"
# L1 只放这一行常量指针（不随技能数增长）；触发词全表在 L3 索引文件按需读。
# ★措辞刻意不含 "penglai_skill_" 子串，确保老格式迁移检测不会把指针行误判成旧全表（保幂等）。
L1_POINTER = (TAG + " 已装集市技能的触发词索引在 ../memory/penglai_skills_index.md"
              "（专项需求先 file_read 它匹配触发词→再读对应 SOP 执行）")
INDEX_HEADER = ("# 蓬莱技能库索引（专项任务触发词 → SOP 文件）\n"
                "# 用法：用户请求命中某触发词 → file_read 对应 penglai_skill_<name>_sop.md 提取要点执行。\n"
                "# 本文件由 `penglai skill install/remove` 自动维护，勿手改。\n\n")
OK, BAD = "✅", "❌"


_NAME_RE = re.compile(r"[a-zA-Z0-9_-]{1,64}")
_INDEX_LINE_RE = re.compile(r"^-\s*(.*?)\s*→\s*penglai_skill_([\w-]+)_sop")


def _valid_name(name):
    """技能名只允许 字母/数字/_/-（≤64）——堵死 ../、/、. 等路径穿越字符。"""
    return bool(name) and bool(_NAME_RE.fullmatch(name))


def _within(path, container):
    """realpath 后确认 path 落在 container 内（纵深防御：防软链/.. 逃逸）。"""
    try:
        rp = os.path.realpath(path)
        rc = os.path.realpath(container)
    except Exception:
        return False
    return rp == rc or rp.startswith(rc + os.sep)


def _parse_skill(path):
    """解析 skills/<name>.md：frontmatter(--- ... ---) → meta dict，其余 → body。"""
    text = open(path, encoding="utf-8", errors="replace").read()
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        return {}, text.strip()
    meta = {}
    for line in m.group(1).splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            meta[k.strip()] = v.strip()
    return meta, m.group(2).strip()


def _available():
    """skills/ 下所有技能（.md，除 README）。返回 [(name, meta)]。"""
    out = []
    if os.path.isdir(SKILLS_DIR):
        for fn in sorted(os.listdir(SKILLS_DIR)):
            if fn.endswith(".md") and fn.lower() != "readme.md":
                meta, _ = _parse_skill(os.path.join(SKILLS_DIR, fn))
                out.append((fn[:-3], meta))
    return out


def _installed_path(name):
    return os.path.join(MEM_DIR, f"penglai_skill_{name}_sop.md")


def _is_installed(name):
    return os.path.exists(_installed_path(name))


def _scan_threat(body):
    """复用 memguard 威胁扫描（纵深防御，**fail-closed**：扫描器不可用也拒装）。
    返回 (ok, why)：(True, None)=干净；(False, 原因)=命中威胁；(False, None)=扫描器不可用。"""
    try:
        sys.path.insert(0, ROOT)
        from plugins.penglai_memguard import _scan
    except Exception:
        return False, None          # 扫描器加载失败 → fail-closed，拒装
    why = _scan(body)
    return (why is None), why


def _index_path():
    return os.path.join(MEM_DIR, INDEX_FILE)


def _save_index(entries):
    """只写 L3 技能索引文件（不碰 L1）。空则删文件。"""
    p = _index_path()
    if entries:
        os.makedirs(MEM_DIR, exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            f.write(INDEX_HEADER)
            for n in sorted(entries):
                f.write(f"- {entries[n]} → penglai_skill_{n}_sop\n")
    elif os.path.exists(p):
        os.remove(p)


def _sync_l1(has_entries):
    """L1 只保留那一行常量指针：有技能→插在 [身份] 行后，无技能→删除。幂等；绝不动用户其它记忆行。"""
    if not has_entries and not os.path.exists(INSIGHT):
        return                                       # 不凭空创建空 L1
    cur = open(INSIGHT, encoding="utf-8", errors="replace").read() if os.path.exists(INSIGHT) else ""
    lines = [l for l in cur.splitlines() if not l.startswith(TAG)]
    if has_entries:
        pos = 0
        for i, l in enumerate(lines):
            if l.startswith("[身份]"):
                pos = i + 1
                break
            if l.startswith("#"):
                pos = i + 1
        lines.insert(pos, L1_POINTER)
    os.makedirs(MEM_DIR, exist_ok=True)
    with open(INSIGHT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + ("\n" if lines else ""))


def _migrate_legacy_l1():
    """老版本把「触发词→文件」全表种在 L1 的 [蓬莱技能] 行。迁移：抽出全表 → 并进 L3 索引 → L1 换成常量指针。
    幂等：新指针行不含 →penglai_skill_ 模式，故不会被重复迁移。"""
    if not os.path.exists(INSIGHT):
        return
    legacy = {}
    for l in open(INSIGHT, encoding="utf-8", errors="replace").read().splitlines():
        if l.startswith(TAG):
            for part in l[len(TAG):].split("|"):
                m = re.search(r"^(.*?)→penglai_skill_([\w-]+)_sop", part.strip())
                if m:
                    legacy[m.group(2)] = m.group(1).strip()
    if not legacy:
        return                                       # 无老全表（没装过 / 已是新指针格式）
    cur = {}
    p = _index_path()
    if os.path.exists(p):
        for l in open(p, encoding="utf-8", errors="replace"):
            m = _INDEX_LINE_RE.search(l.strip())
            if m:
                cur[m.group(2)] = m.group(1).strip()
    for k, v in legacy.items():
        cur.setdefault(k, v)                         # 不覆盖索引里已有的
    _save_index(cur)
    _sync_l1(bool(cur))


def _current_entries():
    """读 L3 技能索引 penglai_skills_index.md → {name: trigger}。先做一次幂等的老 L1 全表迁移。"""
    _migrate_legacy_l1()
    entries = {}
    p = _index_path()
    if os.path.exists(p):
        for l in open(p, encoding="utf-8", errors="replace"):
            m = _INDEX_LINE_RE.search(l.strip())
            if m:
                entries[m.group(2)] = m.group(1).strip()
    return entries


def _set_entries(entries):
    """技能全表写 L3 索引文件；L1 只同步那一行常量指针（有技能则在，空则删）。"""
    _save_index(entries)
    _sync_l1(bool(entries))


def cmd_list():
    av = _available()
    if not av:
        print("技能集市暂无出厂技能（skills/ 为空）——后续版本随发行版精选投放。")
        return 0
    print(f"🏪 蓬莱技能集市（{len(av)} 个出厂精选）：")
    for name, meta in av:
        mark = OK if _is_installed(name) else "  "
        print(f"  {mark} {name:<24} {meta.get('desc', '')}")
    print("\n  启用：penglai skill install <名字>　·　已启用：penglai skill installed")
    return 0


def cmd_installed():
    ents = _current_entries()
    if not ents:
        print("尚未启用任何集市技能。penglai skill list 看可用的。")
        return 0
    print(f"已启用 {len(ents)} 个集市技能（触发词索引 memory/{INDEX_FILE}）：")
    for n, trig in sorted(ents.items()):
        flag = OK if _is_installed(n) else "⚠️ 文件缺失"
        print(f"  {flag} {n:<24} 触发：{trig}")
    return 0


def cmd_install(name):
    if not _valid_name(name):
        print(f"{BAD} 技能名非法（仅允许 字母/数字/_/-，≤64 字符）：{name!r}")
        return 1
    path = os.path.join(SKILLS_DIR, f"{name}.md")
    if not (_within(path, SKILLS_DIR) and os.path.exists(path)):
        print(f"{BAD} 没有这个技能：{name}（penglai skill list 看可用）")
        return 1
    meta, body = _parse_skill(path)
    ok, why = _scan_threat(body)
    if not ok:
        print(f"{BAD} 安全扫描{'拦截' if why else '不可用'}（{why or 'memguard 未就绪'}），该技能未安装。")
        return 1
    dst = _installed_path(name)
    if not _within(dst, MEM_DIR):
        print(f"{BAD} 落点越界，拒绝安装。")
        return 1
    os.makedirs(MEM_DIR, exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        f.write(body + "\n")
    ents = _current_entries()
    ents[name] = meta.get("trigger", f"用户要用 {name}")
    _set_entries(ents)
    print(f"{OK} 已启用技能「{name}」：{meta.get('desc', '')}")
    print(f"   触发词已记入技能库索引 {INDEX_FILE}（L1 只留一行指针，每轮注入不膨胀）：遇到「{ents[name]}」管家会查库用它。")
    return 0


def cmd_remove(name):
    if not _valid_name(name):
        print(f"{BAD} 技能名非法：{name!r}")
        return 1
    p = _installed_path(name)
    if not _within(p, MEM_DIR):
        print(f"{BAD} 路径越界，拒绝。")
        return 1
    if os.path.exists(p):
        os.remove(p)
    ents = _current_entries()
    if name in ents:
        del ents[name]
        _set_entries(ents)
    print(f"{OK} 已停用技能「{name}」。")
    return 0


def run(argv):
    sub = argv[0] if argv else "list"
    arg = argv[1] if len(argv) > 1 else ""
    table = {"list": lambda: cmd_list(), "install": lambda: cmd_install(arg),
             "installed": lambda: cmd_installed(), "remove": lambda: cmd_remove(arg),
             "uninstall": lambda: cmd_remove(arg)}
    if sub not in table:
        print(f"未知子命令：{sub}（可用：list / install <名> / installed / remove <名>）")
        return 1
    return table[sub]()


if __name__ == "__main__":
    raise SystemExit(run(sys.argv[1:]))
