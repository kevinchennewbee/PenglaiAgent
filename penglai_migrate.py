# -*- coding: utf-8 -*-
"""蓬莱发行层：penglai migrate —— 从 Hermes / OpenClaw 搬家（内核零改动，纯标准库）。

照搬 Hermes 官方 openclaw_to_hermes.py 的 parse/merge/rebrand/report 算法，
删掉 Hermes 专有 40+ 迁移项，只留蓬莱能干净落的四件：模型/L2记忆/渠道凭证/人设。
Hindsight 召回 + state.db 会话历史 = 探测到则只在 preview/report 诚实标「待支持」，不假装搬。

铁律（实现层落实）：
- apply 前必 _backup()：时间戳备份 mykey.py + memory/，出错可还原。
- 记忆只 merge 不 overwrite：写 global_mem.txt 只动目标 section，绝不整体覆盖已有用户记忆。
- secret 默认不搬明文：--with-secrets 未给时 apikey/secret 落 '' 占位 + report 标 skipped，preview 用 redact() 脱敏。
- 白名单安全默认：源端 ALLOW_ALL → preview 红字警告建议收紧。
- dry-run 默认不写任何文件。
- 纯标准库（yaml 仅用于读 penglai_providers.yaml）；零行触碰上游无 penglai_ 前缀文件。
"""
import os, re, json, time, shutil

ROOT = os.path.dirname(os.path.realpath(__file__))
ENTRY_DELIMITER = "\n§\n"          # 与蓬莱/Hermes 记忆条目同构
DEFAULT_MEMORY_CHAR_LIMIT = 4000   # L2 是膨胀层（memory_management_sop 允许），放宽于 Hermes 的 2200
DEFAULT_USER_CHAR_LIMIT   = 2000

OK, WARN, BAD, NOTE = "✅", "⚠️ ", "🔴", "🟡"

# 探测目标：v1 只覆盖有设计依据的两家（Hermes 真机验证过；OpenClaw 同构待实测）。
# ClawdBot/MoltBot 等 OpenClaw 变体待有真实用例再加，不预先铺摊子（极简）。
SOURCES = {
    "hermes":   {"home": "~/.hermes",   "label": "Hermes Agent"},
    "openclaw": {"home": "~/.openclaw", "label": "OpenClaw"},
}

# Hermes/.env KEY → 蓬莱 mykey 键（白名单单独处理，见 map_channels）
_ENV_MAP = {
    "FEISHU_APP_ID":          "fs_app_id",
    "FEISHU_APP_SECRET":      "fs_app_secret",
    "DINGTALK_CLIENT_ID":     "dingtalk_client_id",
    "DINGTALK_CLIENT_SECRET": "dingtalk_client_secret",
    "WECOM_BOT_ID":           "wecom_bot_id",
    "WECOM_SECRET":           "wecom_secret",
    "TELEGRAM_BOT_TOKEN":     "tg_bot_token",
    "TG_BOT_TOKEN":           "tg_bot_token",
    "DISCORD_BOT_TOKEN":      "discord_bot_token",
    "QQ_APP_ID":              "qq_app_id",
    "QQ_APP_SECRET":          "qq_app_secret",
}

# 哪些 mykey 键属于 secret（--with-secrets 门控；map_model 的 apikey 单独处理）
_SECRET_KEYS = {
    "fs_app_secret", "dingtalk_client_secret", "wecom_secret",
    "tg_bot_token", "discord_bot_token", "qq_app_secret",
}


# ============================================================
# 探测
# ============================================================

def detect():
    """探测 ~/.hermes 等四目录。支持 PENGLAI_MIGRATE_HOME 覆盖（离线可测）。
    返回命中的 [(src_id, home_path, label)]。"""
    override = os.environ.get("PENGLAI_MIGRATE_HOME")
    if override:
        home = os.path.expanduser(override)
        if os.path.isdir(home):
            sid = os.environ.get("PENGLAI_MIGRATE_SRC", "hermes")
            label = SOURCES.get(sid, {}).get("label", "Hermes Agent")
            return [(sid, home, label)]
        return []
    hits = []
    for sid, meta in SOURCES.items():
        home = os.path.expanduser(meta["home"])
        if os.path.isdir(home):
            # 二次确认：有 config.yaml 或 memories/ 才算真实例（避免空壳目录误报）
            if os.path.exists(os.path.join(home, "config.yaml")) or \
               os.path.isdir(os.path.join(home, "memories")):
                hits.append((sid, home, meta["label"]))
    return hits


def _load_config(home):
    """读 config.yaml；缺失/损坏返回 {}。"""
    p = os.path.join(home, "config.yaml")
    if not os.path.exists(p):
        return {}
    try:
        import yaml
        return yaml.safe_load(open(p, encoding="utf-8")) or {}
    except Exception:
        return {}


def _load_env(home):
    """解析 .env 的 KEY=VALUE 行（不引 dotenv），返回 dict。"""
    out = {}
    p = os.path.join(home, ".env")
    if not os.path.exists(p):
        return out
    for raw in open(p, encoding="utf-8", errors="replace").read().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k = k.strip()
        if k.lower().startswith("export "):
            k = k[len("export "):].strip()
        v = v.strip()
        # 去成对引号
        if len(v) >= 2 and v[0] == v[-1] and v[0] in ("'", '"'):
            v = v[1:-1]
        if k:
            out[k] = v
    return out


# ============================================================
# 搬运件①：模型 API
# ============================================================

def _match_provider(base, model):
    """base_url 反查 penglai_providers.yaml：命中某 provider×billing 的 base_url
    → 取其 name（前向兼容）/ display（实际字段）作为蓬莱 native name；未命中用模型名兜底。"""
    base = (base or "").rstrip("/")
    try:
        import yaml
        data = yaml.safe_load(open(os.path.join(ROOT, "penglai_providers.yaml"),
                                   encoding="utf-8")) or {}
    except Exception:
        return model or "migrated-model"
    for pid, p in (data.get("providers") or {}).items():
        for bid, b in (p.get("billing") or {}).items():
            if (b.get("base_url") or "").rstrip("/") == base and base:
                return p.get("name") or p.get("display") or pid    # 命中：火山 coding base_url 实测逐字相同
    return model or "migrated-model"                               # 未命中：模型名兜底，连通仍可用


def map_model(cfg):
    """config.yaml model/fallback_model → 蓬莱 native/fallback 槽。apikey 默认带回，
    是否落明文由 apply 按 --with-secrets 决定。auxiliary.* 归一到主模型（report 标已合并）。"""
    m = cfg.get("model", {}) or {}
    base = (m.get("base_url") or "").rstrip("/")
    model = m.get("default") or m.get("model") or ""
    key = m.get("api_key") or ""
    name = _match_provider(base, model)
    out = {"native": {"name": name, "apikey": key, "apibase": base,
                      "model": model, "max_retries": 3}}
    fb = cfg.get("fallback_model", {}) or {}
    fb_base = (fb.get("base_url") or "").rstrip("/")
    fb_model = fb.get("default") or fb.get("model") or ""
    if fb_base and fb_model and (fb_base, fb_model) != (base, model):
        out["fallback"] = {"name": _match_provider(fb_base, fb_model),
                           "apikey": fb.get("api_key") or "", "apibase": fb_base,
                           "model": fb_model, "max_retries": 3}
    out["aux_dropped"] = list((cfg.get("auxiliary") or {}).keys())
    return out


# ============================================================
# 搬运件③：渠道凭证 + 白名单
# ============================================================

def map_channels(env, cfg, home):
    """.env 渠道凭证 + 白名单 → 蓬莱 mykey 键（复用 penglai_channels 注册表的 keys/allow 字段）。
    ALLOW_ALL → ['*'] + 红字警告；逗号串（含中文逗号）→ list。微信扫码身份不可直搬→提示重扫。
    返回 (pairs, notes)。"""
    pairs, notes = {}, []
    for ek, mk in _ENV_MAP.items():
        if env.get(ek):
            pairs[mk] = env[ek]
    # 飞书白名单
    allow_all = (str(env.get("FEISHU_ALLOW_ALL_USERS", "")).lower() == "true"
                 or cfg.get("GATEWAY_ALLOW_ALL_USERS") is True)
    if allow_all:
        pairs["fs_allowed_users"] = ["*"]   # preview 的白名单行会红字提示收紧，这里不重复加 note
    elif env.get("FEISHU_ALLOWED_USERS"):
        pairs["fs_allowed_users"] = [u.strip() for u in
            env["FEISHU_ALLOWED_USERS"].replace("，", ",").split(",") if u.strip()]
    # 微信会话身份（扫码协议）不可直搬
    if os.path.exists(os.path.join(home, "channel_directory.json")):
        notes.append("🟡 微信会话身份不可直搬（扫码协议）；迁移后用 penglai setup 重新扫码绑定")
    return pairs, notes


# ============================================================
# 记忆解析 / 合并 / 改写（照抄蓝本，方向反转）
# ============================================================

def parse_entries(text):
    """有 § 按 § 切；否则按 markdown 标题层级切。返回去空条目列表。"""
    text = (text or "").strip()
    if not text:
        return []
    if "§" in text:
        return [e.strip() for e in text.split("§") if e.strip()]
    entries, buf = [], []
    for line in text.splitlines():
        if line.startswith("#") and buf:
            entries.append("\n".join(buf).strip()); buf = [line]
        else:
            buf.append(line)
    if buf:
        entries.append("\n".join(buf).strip())
    return [e for e in entries if e]


def _norm(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())


def merge_entries(existing, incoming, limit):
    """normalize 去重 + 字符上限裁剪。返回 (merged_list, stats)。
    绝不删既有条目；只往尾部追加未重复且不超限的新条目。"""
    seen = {_norm(e) for e in existing}
    merged = list(existing)
    added = dup = overflow = 0
    used = sum(len(e) for e in existing)
    for e in incoming:
        n = _norm(e)
        if not n or n in seen:
            dup += 1; continue
        if used + len(e) > limit:
            overflow += 1; continue
        merged.append(e); seen.add(n); used += len(e); added += 1
    return merged, {"added": added, "duplicates": dup, "overflowed": overflow}


def rebrand_text(text, agent_name):
    """Hermes/OpenClaw/ClawdBot/MoltBot → 管家名；~/.hermes 等路径 → 蓬莱 ROOT。"""
    text = text or ""
    name = agent_name or "蓬莱助手"
    for brand in ("Hermes", "OpenClaw", "ClawdBot", "MoltBot"):
        text = re.sub(brand, name, text)
    for src in ("~/.hermes", "~/.openclaw", "~/.clawdbot", "~/.moltbot"):
        text = text.replace(src, ROOT)
    return text


# ============================================================
# 搬运件②：L2 文件记忆
# ============================================================

def map_memory(home, src_label="Hermes"):
    """MEMORY.md/USER.md → 解析后的 incoming 条目（按 § 同构 / markdown 回退）。
    返回 {section_title: [entries], ...}。"""
    out = {}
    plan = (("MEMORY.md", "迁移自 {s} · 长期记忆"),
            ("USER.md",   "迁移自 {s} · 用户画像"))
    for fname, sect in plan:
        p = os.path.join(home, "memories", fname)
        if os.path.exists(p):
            text = open(p, encoding="utf-8", errors="replace").read()
            entries = parse_entries(text)
            if entries:
                out[sect.format(s=src_label)] = entries
    return out


# ============================================================
# 搬运件④：人设
# ============================================================

def map_persona(home):
    """SOUL.md → {agent_name, owner, soul_full}。抽不到留空让向导问。无 SOUL.md 返回 None。"""
    p = os.path.join(home, "SOUL.md")
    if not os.path.exists(p):
        return None
    soul = open(p, encoding="utf-8", errors="replace").read()
    om = re.search(r"Owner[:：]\s*(\S+)", soul)
    owner = om.group(1) if om else ""
    nm = re.search(r"^#\s*(.+)$", soul, re.M)
    name = nm.group(1).strip() if nm else ""
    # SOUL 首行常是文档标题(如「TECHNICAL AUDITOR SOUL v1.1」或「小雅·技术审计员 v1.1」)。提名字:
    # ①去版本尾缀 ②取「名字·角色」的名字段 ③英文文档标题(含SOUL/PERSONA/PROFILE或纯大写英文)不是名字→留空。
    # 人设规则全文照常进 L2(有价值的部分),只是 L1 身份名抽不准时留给用户用 penglai setup 设定。
    name = re.sub(r"\s*v?\d+(\.\d+)+\s*$", "", name, flags=re.I).strip()
    name = re.split(r"[·:：—–\-]", name, 1)[0].strip()
    if name and (re.search(r"\b(SOUL|PERSONA|PROFILE)\b", name, re.I)
                 or (name.isascii() and name.upper() == name and len(name) > 4)):
        name = ""
    return {"agent_name": name, "owner": owner, "soul_full": soul}


# ============================================================
# secret 脱敏（preview 用）
# ============================================================

def redact(value):
    """ark-bee1…14da1 形态：首4 + 省略 + 末4，中间不暴露。空值返回 ''。"""
    s = "" if value is None else str(value)
    if not s:
        return ""
    if len(s) <= 8:
        return s[0] + "…" if len(s) > 1 else "…"
    return f"{s[:4]}…{s[-4:]}"


# ============================================================
# plan 汇总（preview/apply 共用）
# ============================================================

def build_plan(src_id, home, opts):
    """汇总四件 → 统一 plan dict（含每项 status + 落点 + 脱敏值）。先 plan 后 apply。"""
    opts = opts or {}
    label = SOURCES.get(src_id, {}).get("label", src_id)
    cfg = _load_config(home)
    env = _load_env(home)

    model = map_model(cfg)
    channels, ch_notes = map_channels(env, cfg, home)
    memory = map_memory(home, label)
    persona = map_persona(home)

    agent_name = (persona or {}).get("agent_name") or ""
    owner = (persona or {}).get("owner") or ""

    # 探测搬不了的两件（诚实标注，不假装搬）
    deferred = []
    if os.path.isdir(os.path.join(home, "hindsight")):
        deferred.append({"asset": "Hindsight 嵌入召回", "status": "deferred",
                         "note": "bank/ 存在 → 待支持（依赖蓬莱召回层），仅导出条数说明，不接入"})
    sdb = os.path.join(home, "state.db")
    if os.path.exists(sdb):
        mb = os.path.getsize(sdb) / (1024 * 1024)
        deferred.append({"asset": "会话历史 state.db", "status": "deferred",
                         "note": f"state.db {mb:.0f}MB → 待支持，仅可选导出近期摘要（非召回）"})

    plan = {
        "src_id": src_id, "home": home, "label": label,
        "model": model, "channels": channels, "channel_notes": ch_notes,
        "memory": memory, "persona": persona,
        "agent_name": agent_name, "owner": owner,
        "deferred": deferred,
        # 向导预填回传（不直接写模型，由 step_llm 用）
        "model_prefill": model.get("native"),
        "channels_detected": [mk for mk in channels if not isinstance(channels[mk], list)],
    }
    return plan


# ============================================================
# preview（只打印，不写盘）
# ============================================================

def _preview_lines(plan, with_secrets):
    """构造 preview 文本行列表（也供测试断言）。"""
    L = [f"检测到 {plan['label']}（{plan['home']}）。将搬运："]
    m = plan["model"]
    nat = m.get("native") or {}
    sec_hint = "" if with_secrets else "（--with-secrets 才搬明文）"
    if nat.get("model"):
        L.append(f"  {OK} 主模型      {nat.get('name')} / {nat.get('model')}"
                 f"  apikey={redact(nat.get('apikey')) or '(空)'}{sec_hint}"
                 f" → 向导路径预填；独立 migrate 不覆盖你现有模型（要换用 penglai setup）")
    if m.get("fallback"):
        fb = m["fallback"]
        L.append(f"  {OK} 兜底模型    {fb.get('name')} / {fb.get('model')} → mixin_config.llm_nos")
    if m.get("aux_dropped"):
        L.append(f"  {NOTE} 辅助模型槽  {', '.join(m['aux_dropped'])} → 已合并到主模型（蓬莱无分槽）")
    # 渠道
    for mk, v in plan["channels"].items():
        if isinstance(v, list):
            continue  # 白名单单独打
        shown = v if mk not in _SECRET_KEYS else (redact(v) + sec_hint)
        L.append(f"  {OK} 渠道凭证    {mk}={shown} → mykey")
    fa = plan["channels"].get("fs_allowed_users")
    if fa == ["*"]:
        L.append(f"  {WARN}飞书白名单  源端 ALLOW_ALL → 建议收紧为你本人 open_id（安全默认）")
    elif isinstance(fa, list) and fa:
        L.append(f"  {OK} 飞书白名单  {len(fa)} 人 → mykey.fs_allowed_users")
    for note in plan.get("channel_notes", []):
        L.append("  " + note)
    # 记忆
    for sect, entries in plan["memory"].items():
        L.append(f"  {OK} 记忆        {sect}：{len(entries)} 条 → L2 global_mem.txt（merge 去重）")
    # 人设
    if plan["persona"]:
        nm = plan["agent_name"] or "(未抽到名字，向导会问)"
        L.append(f"  {NOTE} 人设        {nm} → L1 身份行 + L2 全文备查")
    # 诚实标注的两件
    for d in plan.get("deferred", []):
        L.append(f"  {BAD} {d['asset']}  {d['note']}")
    return L


def preview(plan, with_secrets=False):
    for line in _preview_lines(plan, with_secrets):
        print(line)


# ============================================================
# 备份 / 落盘 / report
# ============================================================

def _backup():
    """时间戳备份 mykey.py + memory/（搬运是写凭证+记忆，出错要能还原）。返回备份目录。"""
    ts = time.strftime("%Y%m%d-%H%M%S")
    bdir = os.path.join(ROOT, f"penglai-migrate-backup-{ts}")
    os.makedirs(bdir, exist_ok=True)
    mk = os.path.join(ROOT, "mykey.py")
    if os.path.exists(mk):
        shutil.copy2(mk, os.path.join(bdir, "mykey.py"))
    mem = os.path.join(ROOT, "memory")
    if os.path.isdir(mem):
        shutil.copytree(mem, os.path.join(bdir, "memory"), dirs_exist_ok=True)
    return bdir


def _global_mem_path():
    return os.path.join(ROOT, "memory", "global_mem.txt")


def _atomic_write(path, text):
    """原子落盘 tmp+os.replace（写 L1/L2 记忆,崩溃中途不留半截；另有 _backup 兜底）。"""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(text)
    os.replace(tmp, path)


def _sanitize_section_body(body):
    """正文行首的 `## [` 会被误判为 section 边界（GA L2 用 `## [SECTION]` 当节标题，而 Hermes
    SOUL/MEMORY 正文可能含这种行）→ 缩进一格成 ` ## [`，不在行首、不被当边界，渲染视觉几乎无差，
    保 _write_section 的 section 切分幂等正确，不再静默丢正文。"""
    return re.sub(r"(?m)^(## \[)", r" \1", body or "")


def _read_section(full_text, header):
    """从 global_mem.txt 全文里取出某 `## [header]` section 的正文（不含标题行）。
    只认【行首】的 `## [` 为边界（缩进过的不算），与 _write_section 的 sanitize 配套。"""
    if not full_text:
        return ""
    lines = full_text.splitlines()
    target = f"## [{header}]"
    out, capturing = [], False
    for l in lines:
        if l.startswith("## ["):
            capturing = (l.rstrip() == target)
            continue
        if capturing:
            out.append(l)
    return "\n".join(out).strip()


def _write_section(full_text, header, body):
    """把某 `## [header]` section 的正文替换为 body（只动该 section，其余原样）。
    section 不存在则追加到文末。body 先 sanitize，避免其中 `## [` 撑坏切分。"""
    target = f"## [{header}]"
    body = _sanitize_section_body(body)
    block = f"{target}\n{body}\n"
    if not full_text:
        return block
    lines = full_text.splitlines()
    out, i, replaced = [], 0, False
    n = len(lines)
    while i < n:
        l = lines[i]
        if l.rstrip() == target:
            out.append(target)
            out.append(body)
            replaced = True
            i += 1
            # 跳过旧 section 正文直到下一个【行首】 ## [ 或文末
            while i < n and not lines[i].startswith("## ["):
                i += 1
            continue
        out.append(l)
        i += 1
    text = "\n".join(out).rstrip("\n") + "\n"
    if not replaced:
        text = text.rstrip("\n") + "\n\n" + block
    return text


def _merge_memory_into_global(plan, agent_name):
    """记忆只 merge 不 overwrite：读现有 global_mem.txt → 对每个目标 section 内 merge_entries
    去重 → 只回写该 section。返回 stats dict。"""
    path = _global_mem_path()
    full = open(path, encoding="utf-8", errors="replace").read() if os.path.exists(path) else ""
    stats = {}
    for sect, entries in plan["memory"].items():
        incoming = [rebrand_text(e, agent_name) for e in entries]
        existing = parse_entries(_read_section(full, sect))
        limit = DEFAULT_USER_CHAR_LIMIT if "用户画像" in sect else DEFAULT_MEMORY_CHAR_LIMIT
        merged, st = merge_entries(existing, incoming, limit)
        body = ENTRY_DELIMITER.join(merged)
        full = _write_section(full, sect, body)
        stats[sect] = st
    # 人设全文进 L2（不每轮注入）
    if plan["persona"]:
        soul = rebrand_text(plan["persona"]["soul_full"], agent_name)
        sect = f"迁移自 {plan.get('label', 'Hermes')} · 人设全文"
        full = _write_section(full, sect, soul.strip())
        stats[sect] = {"added": 1, "duplicates": 0, "overflowed": 0}
    _atomic_write(path, full)
    return stats


def _write_identity_l1(agent_name, owner):
    """L1 [身份] 行（照 step_identity 格式；只替身份行，不动其余）。"""
    ins = os.path.join(ROOT, "memory", "global_mem_insight.txt")
    os.makedirs(os.path.dirname(ins), exist_ok=True)
    cur = open(ins, encoding="utf-8", errors="replace").read() if os.path.exists(ins) else ""
    lines = [l for l in cur.splitlines() if not l.startswith("[身份]")]
    user = owner or "主人"
    ident = (f"[身份] 我是「{agent_name or '蓬莱助手 Penglai'}」，基于 GenericAgent 的开源个人管家发行版蓬莱。"
             f"用户称呼：{user}。被问及身份/名字时以此为准，勿自称底层模型名。")
    if lines and lines[0].startswith("#"):
        out = [lines[0], ident] + lines[1:]
    else:
        out = [ident] + lines
    _atomic_write(ins, "\n".join(out) + "\n")


def apply(plan, opts):
    """真正落盘：备份已在 run() 里做。返回五态 results。"""
    opts = opts or {}
    with_secrets = bool(opts.get("with_secrets"))
    agent_name = plan.get("agent_name") or ""
    results = {"migrated": [], "skipped": [], "conflict": [], "deferred": [], "error": []}

    # ① 渠道凭证 → mykey（secret 门控）
    try:
        import penglai_channels as pc
        pairs = {}
        for mk, v in plan["channels"].items():
            if isinstance(v, list):
                pairs[mk] = v   # 白名单照搬
                continue
            if mk in _SECRET_KEYS and not with_secrets:
                pairs[mk] = ""
                results["skipped"].append(f"channel:{mk}（secret，--with-secrets 未给，落空占位）")
            else:
                pairs[mk] = v
                results["migrated"].append(f"channel:{mk}")
        if plan["channels"].get("fs_allowed_users") == ["*"]:
            results["conflict"].append("fs_allowed_users=['*']（源端 ALLOW_ALL，建议收紧）")
        if pairs:
            pc.mykey_set(pairs)
    except Exception as e:
        results["error"].append(f"channels: {e}")

    # ② 记忆 merge → L2（绝不 overwrite）
    try:
        stats = _merge_memory_into_global(plan, agent_name)
        for sect, st in stats.items():
            results["migrated"].append(f"memory:{sect} +{st['added']}/dup{st['duplicates']}/of{st['overflowed']}")
    except Exception as e:
        results["error"].append(f"memory: {e}")

    # ③ 人设 → L1 身份行
    try:
        if plan["persona"]:
            _write_identity_l1(agent_name, plan.get("owner"))
            results["migrated"].append("persona:L1[身份]")
    except Exception as e:
        results["error"].append(f"persona: {e}")

    # ④ 模型 apikey 的 secret 门控仅影响向导预填/report（migrate 不直接写 mykey 主模型，
    #    交向导 step_write；这里只记 status）
    nat = (plan["model"].get("native") or {})
    if nat.get("model"):
        results["skipped"].append(
            f"model:{nat.get('name')}/{nat.get('model')}（独立 migrate 不覆盖现有主模型；"
            "向导路径会预填，或装好后用 penglai setup 切换）")

    # ⑤ 诚实标注的两件
    for d in plan.get("deferred", []):
        results["deferred"].append(f"{d['asset']}: {d['note']}")

    return results


def write_report(plan, results=None, dry=False):
    """五态 report.json → _internal/migration-research/report-<ts>.json。"""
    ts = time.strftime("%Y%m%d-%H%M%S")
    rdir = os.path.join(ROOT, "_internal", "migration-research")
    try:
        os.makedirs(rdir, exist_ok=True)
    except Exception:
        rdir = ROOT
    rep = {
        "ts": ts, "dry_run": bool(dry),
        "src_id": plan.get("src_id"), "home": plan.get("home"), "label": plan.get("label"),
        "model": {
            "native": {k: ("***" if k == "apikey" else v)
                       for k, v in (plan["model"].get("native") or {}).items()},
            "fallback": bool(plan["model"].get("fallback")),
            "aux_dropped": plan["model"].get("aux_dropped", []),
        },
        "channels": sorted([mk for mk in plan["channels"] if not isinstance(plan["channels"][mk], list)]),
        "fs_allowed_users": plan["channels"].get("fs_allowed_users"),
        "memory_sections": {s: len(e) for s, e in plan["memory"].items()},
        "persona": bool(plan["persona"]),
        "agent_name": plan.get("agent_name"),
        "deferred": plan.get("deferred", []),
        "results": results or {},
    }
    path = os.path.join(rdir, f"report-{ts}.json")
    open(path, "w", encoding="utf-8").write(json.dumps(rep, ensure_ascii=False, indent=2))
    return path


# ============================================================
# CLI
# ============================================================

def _parse_flags(argv):
    opts = {"from": None, "dry_run": False, "with_secrets": False, "yes": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--from" and i + 1 < len(argv):
            opts["from"] = argv[i + 1]; i += 2; continue
        if a.startswith("--from="):
            opts["from"] = a.split("=", 1)[1]; i += 1; continue
        if a in ("--dry-run", "-n"):
            opts["dry_run"] = True
        elif a == "--with-secrets":
            opts["with_secrets"] = True
        elif a in ("--yes", "-y"):
            opts["yes"] = True
        i += 1
    return opts


def _pick_source(hits, opts):
    if opts.get("from"):
        for h in hits:
            if h[0] == opts["from"]:
                return h
        print(f"{WARN}--from {opts['from']} 未在检测结果中（命中：{', '.join(h[0] for h in hits)}）")
        return None
    if len(hits) == 1:
        return hits[0]
    print("检测到多个来源，请用 --from 指定：")
    for sid, home, label in hits:
        print(f"  --from {sid}   {label}（{home}）")
    return None


def run(argv):
    opts = _parse_flags(argv or [])
    hits = detect()
    if not hits:
        print("未检测到 Hermes/OpenClaw（探测 ~/.hermes 等四目录）。")
        return 0
    src = _pick_source(hits, opts)
    if not src:
        return 1
    plan = build_plan(src[0], src[1], opts)
    print()
    preview(plan, with_secrets=opts["with_secrets"])
    print()
    if opts["dry_run"]:
        rp = write_report(plan, dry=True)
        print(f"（dry-run：未写任何文件；预览报告 → {rp}）")
        return 0
    if not opts["yes"]:
        try:
            if input("确认搬运？(y/N) ").strip().lower() != "y":
                print("已取消。")
                return 0
        except EOFError:
            print("非交互环境，加 --yes 确认或 --dry-run 预览。")
            return 0
    bdir = _backup()
    print(f"{OK} 已备份 mykey.py + memory/ → {os.path.basename(bdir)}")
    results = apply(plan, {"with_secrets": opts["with_secrets"]})
    rp = write_report(plan, results)
    print(f"{OK} 搬运完成。报告 → {rp}")
    if results["skipped"]:
        print(f"  {WARN}{len(results['skipped'])} 项 secret 未搬明文（加 --with-secrets 重跑可搬）")
    if results["conflict"]:
        print(f"  {WARN}{len(results['conflict'])} 项需你手动收紧（见报告）")
    return 0


if __name__ == "__main__":
    import sys
    raise SystemExit(run(sys.argv[1:]))
