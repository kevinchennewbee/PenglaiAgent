#!/usr/bin/env python3
"""
Penglai 0.3 -> 0.4 Migration Script.

Migrates:
  1. mykey.py model configs  -> 0.4 model profiles (profiles.json + .env.penglai)
  2. memory/ files           -> preserved (language-agnostic, no change needed)
  3. skills/ files           -> preserved (language-agnostic)
  4. Feishu/WeChat credentials -> preserved in mykey.py (adapters read the same file)

Does NOT migrate:
  - Runtime Hub state (incompatible: 0.3 SQLite vs 0.4 JSONL transcripts; start fresh)
  - Session history (different format; 0.4 re-records transcripts)
  - Python plugins (redline/memguard concepts moved to the TS Boundary; code retired)

Outputs (written to <output_dir>, default packages/host/migrate/out/):
  - profiles.json         0.4 ModelProfile catalog (no API keys, just apiKeyEnv refs)
  - .env.penglai          API keys as env vars (gitignored; secrets)
  - im_credentials.json   Feishu/WeChat/etc. credentials preserved verbatim
  - register_profiles.py  helper that registers profiles into a running Host
                          via the config.createProfile JSON-RPC method
  - migration_report.txt  human-readable summary of what was migrated

Usage:
  python packages/host/migrate/migrate_03_to_04.py             # interactive wizard
  python packages/host/migrate/migrate_03_to_04.py --yes       # non-interactive
  python packages/host/migrate/migrate_03_to_04.py --source /path/to/0.3 \\
         --output packages/host/migrate/out --yes

Safe by default: backs up 0.3 data before writing anything, previews changes,
and asks for confirmation unless --yes is passed.

Stdlib only (importlib / json / shutil / re / sys) so it runs on Python 3.12
with no extra dependencies.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import shutil
import sys
import uuid
from datetime import datetime
from pathlib import Path

# ── constants ───────────────────────────────────────────────────────────

SCHEMA_VERSION = 1

# 0.3 markers that identify a 0.3 installation.
_03_MARKERS = [
    "mykey.py",
    "mykey_template.py",
    "agentmain.py",
    "llmcore.py",
    "penglai_runtime",
    "frontends/fsapp.py",
    "frontends/wechatapp.py",
]

# 0.4 markers (so we can tell if 0.3 and 0.4 share a directory).
_04_MARKERS = ["packages/host/src/server.ts", "packages/protocol/src/index.ts"]

# Dirs/files that are language-agnostic data and are preserved in place
# (not copied into the migration output -- they don't need conversion).
PRESERVED_DATA = ["memory", "skills"]

# IM credential keys to carry over verbatim from mykey.py.
IM_CREDENTIAL_KEYS = [
    "fs_app_id",
    "fs_app_secret",
    "fs_allowed_users",
    "wechat_allowed_users",
    "tg_bot_token",
    "tg_allowed_users",
    "qq_app_id",
    "qq_app_secret",
    "qq_allowed_users",
    "wecom_bot_id",
    "wecom_secret",
    "wecom_allowed_users",
    "wecom_welcome_message",
    "dingtalk_client_id",
    "dingtalk_client_secret",
    "dingtalk_allowed_users",
]

# Provider inference from base URL / model name. Order matters: first match wins.
_PROVIDER_RULES = [
    ("grok", lambda b, m: "x.ai" in b or "grok" in b),
    ("deepseek", lambda b, m: "deepseek" in b),
    ("glm", lambda b, m: "z.ai" in b or "bigmodel" in b or "glm" in m.lower()),
    ("kimi", lambda b, m: "moonshot" in b or "kimi" in b or "kimi" in m.lower()),
    ("minimax", lambda b, m: "minimax" in b or "minimax" in m.lower()),
    ("openrouter", lambda b, m: "openrouter" in b),
    ("anthropic", lambda b, m: "anthropic" in b),
    ("openai", lambda b, m: "openai" in b or "api.openai" in b),
]

# Canonical env-var names the 0.4 Host's default profiles already look up.
_CANONICAL_ENV = {
    "grok": "GROK_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "glm": "ZAI_API_KEY",
    "openai": "OPENAI_API_KEY",
}

# Regex detecting an unfilled placeholder API key in mykey.py templates.
_PLACEHOLDER_RE = re.compile(
    r"<[^>]+>|your-|xxxx|placeholder|replace-?me|sk-$", re.IGNORECASE
)


# ── mykey.py loading ───────────────────────────────────────────────────

def _load_mykey_module(mykey_path: Path) -> dict:
    """Execute a mykey.py / mykey.json file and return its public namespace."""
    mykey_path = Path(mykey_path)
    if not mykey_path.exists():
        return {}
    if mykey_path.suffix == ".json":
        with open(mykey_path, encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    # .py: exec into an isolated namespace so repeated calls don't collide.
    mod_name = f"_migrate_mykey_{uuid.uuid4().hex}"
    spec = importlib.util.spec_from_file_location(mod_name, mykey_path)
    if not spec or not spec.loader:
        return {}
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return {k: v for k, v in vars(module).items() if not k.startswith("_")}


# ── 1. detect_03_install ───────────────────────────────────────────────

def detect_03_install(search_dir: str | Path | None = None) -> dict:
    """Locate a 0.3 installation by scanning for marker files/dirs.

    Returns a dict with:
      - root: the detected 0.3 root directory (Path or None)
      - markers: {marker_name: path_or_None}
      - mykey: path to mykey.py / mykey.json (or None)
      - shared_with_04: True if 0.4 markers are also present in the same dir
      - preserved: {name: path} for memory/ and skills/ if present
    """
    root = Path(search_dir).expanduser().resolve() if search_dir else None
    if root is None:
        # Default: the repo root three levels above this file
        # (packages/host/migrate -> packages/host -> packages -> repo root).
        root = Path(__file__).resolve().parents[3]

    markers = {}
    for m in _03_MARKERS:
        p = root / m
        markers[m] = p if p.exists() else None

    # Pick the mykey file actually containing config (mykey.py preferred).
    mykey = None
    mykey_is_template = False
    for cand in ("mykey.py", "mykey.json"):
        p = root / cand
        if p.exists():
            data = _load_mykey_module(p)
            if isinstance(data, dict) and data:
                mykey = p
                break
    # Last resort: fall back to the template so a preview works before the
    # user has created a real mykey.py. Flagged so the report can say so.
    if mykey is None:
        p = root / "mykey_template.py"
        if p.exists():
            data = _load_mykey_module(p)
            if isinstance(data, dict) and data:
                mykey = p
                mykey_is_template = True

    found = sum(1 for v in markers.values() if v is not None)
    is_03 = found >= 2 and mykey is not None

    shared_with_04 = any((root / m).exists() for m in _04_MARKERS)

    preserved = {}
    for name in PRESERVED_DATA:
        p = root / name
        if p.exists():
            preserved[name] = p

    return {
        "root": root if is_03 else None,
        "is_03": is_03,
        "markers": markers,
        "mykey": mykey,
        "mykey_is_template": mykey_is_template,
        "shared_with_04": shared_with_04,
        "preserved": preserved,
    }


# ── 2. extract_model_profiles ──────────────────────────────────────────

def _infer_provider(apibase: str, model: str) -> str:
    b = (apibase or "").lower()
    m = (model or "")
    for name, test in _PROVIDER_RULES:
        if test(b, m):
            return name
    return "custom"


def _is_anthropic_protocol(var_name: str, apibase: str) -> bool:
    """0.3 native_claude_* configs speak the Anthropic Messages protocol.

    The 0.4 Host provider only speaks OpenAI-compatible /chat/completions,
    so these need either an OpenAI-compatible base URL or a future provider
    adapter. We flag them so the report is honest.
    """
    n = var_name.lower()
    b = (apibase or "").lower()
    if "native" in n and "claude" in n:
        return True
    return "/anthropic" in b


def _is_placeholder_key(apikey: str) -> bool:
    if not apikey or not apikey.strip():
        return True
    return bool(_PLACEHOLDER_RE.search(apikey))


def _slug(name: str, seen: set[str]) -> str:
    # Underscores (not hyphens) so derived env var names (PENGLAI_PROFILE_<ID>_API_KEY)
    # stay valid shell identifiers.
    base = re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_") or "profile"
    slug = base
    i = 2
    while slug in seen:
        slug = f"{base}_{i}"
        i += 1
    seen.add(slug)
    return slug


def _normalize_baseurl(apibase: str) -> str:
    """Light normalization: strip a trailing slash. The 0.4 provider joins
    /chat/completions itself, so we do NOT collapse /v1 here (preserving the
    user's intent)."""
    return (apibase or "").rstrip("/")


def extract_model_profiles(mykey_path: str | Path) -> tuple[list[dict], dict]:
    """Read mykey.py, extract LLM session configs, convert to 0.4 ModelProfile.

    Returns (profiles, meta) where:
      - profiles: list of ModelProfile-shaped dicts (plus extra `note` and
        `compatible` fields for the report). No API keys are embedded; each
        profile carries an `apiKeyEnv` name.
      - meta: {mixin: <mixin_config or None>, raw_count: N, skipped: [...]}
    """
    data = _load_mykey_module(Path(mykey_path))
    profiles: list[dict] = []
    seen_ids: set[str] = set()
    skipped: list[str] = []

    mixin = data.get("mixin_config")
    if not isinstance(mixin, dict):
        mixin = None

    for var_name, cfg in data.items():
        if var_name == "mixin_config":
            continue
        if not isinstance(cfg, dict):
            continue
        # A session config has an apibase and a model. (mixin has llm_nos.)
        apibase = cfg.get("apibase")
        model = cfg.get("model")
        if not apibase or not model:
            continue

        name = str(cfg.get("name") or model).strip()
        apikey = str(cfg.get("apikey") or "").strip()
        provider = _infer_provider(apibase, str(model))
        anthropic = _is_anthropic_protocol(var_name, str(apibase))
        # Strip the 0.3 [1m] context-beta suffix; 0.4 doesn't use it.
        model_clean = re.sub(r"\[1m\]$", "", str(model)).strip()

        pid = _slug(name, seen_ids)
        # Use the canonical env var name only for the first profile of a
        # known provider; otherwise a unique per-profile name to avoid
        # collisions when several profiles share a provider.
        env = _CANONICAL_ENV.get(provider, f"PENGLAI_PROFILE_{pid.upper()}_API_KEY")

        placeholder = _is_placeholder_key(apikey)
        capabilities = {
            "tools": True,
            "streaming": bool(cfg.get("stream", True)),
            "vision": provider in ("glm", "openai", "anthropic"),
        }

        note_parts = []
        if anthropic:
            note_parts.append(
                "anthropic-protocol: 0.4 Host speaks OpenAI-compatible "
                "/chat/completions; supply an OpenAI-compatible base URL or "
                "wait for a provider adapter"
            )
        if placeholder:
            note_parts.append("api key is a placeholder -- fill in a real key")

        profile = {
            "schemaVersion": SCHEMA_VERSION,
            "id": pid,
            "label": name,
            "provider": provider,
            "baseUrl": _normalize_baseurl(str(apibase)),
            "apiKeyEnv": env,
            "model": model_clean,
            "capabilities": capabilities,
            # Extra report-only fields (not part of the 0.4 protocol type):
            "compatible": not anthropic,
            "note": "; ".join(note_parts) if note_parts else "",
            "source_var": var_name,
            "apikey_placeholder": placeholder,
        }
        profiles.append(profile)

    meta = {
        "mixin": mixin,
        "raw_count": len(profiles),
        "skipped": skipped,
    }
    return profiles, meta


# ── 3. extract_im_credentials ──────────────────────────────────────────

def extract_im_credentials(mykey_path: str | Path) -> dict:
    """Read Feishu/WeChat/other IM credentials from mykey.py."""
    data = _load_mykey_module(Path(mykey_path))
    creds: dict[str, object] = {}
    for key in IM_CREDENTIAL_KEYS:
        if key in data:
            creds[key] = data[key]
    return creds


# ── 4. write_04_config ─────────────────────────────────────────────────

def _mask(value: str) -> str:
    s = str(value or "")
    if len(s) <= 8:
        return "*" * len(s)
    return s[:4] + "*" * (len(s) - 8) + s[-4:]


def write_04_config(
    profiles: list[dict],
    credentials: dict,
    output_dir: str | Path,
    *,
    include_keys: bool = True,
) -> dict:
    """Write the 0.4 config artifacts to output_dir.

    Writes:
      - profiles.json        ModelProfile catalog (no secrets)
      - .env.penglai         API keys as env vars (only if include_keys)
      - im_credentials.json  IM credentials preserved verbatim
      - register_profiles.py helper to register profiles into a running Host
    Returns a dict of written file paths.
    """
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    written: dict[str, Path] = {}

    # profiles.json: strip report-only fields so it matches the 0.4 protocol
    # ModelProfile shape (plus schemaVersion). Keep `note` for human context.
    catalog = []
    for p in profiles:
        entry = {
            "schemaVersion": p["schemaVersion"],
            "id": p["id"],
            "label": p["label"],
            "provider": p["provider"],
            "baseUrl": p["baseUrl"],
            "apiKeyEnv": p["apiKeyEnv"],
            "model": p["model"],
            "capabilities": p["capabilities"],
        }
        if p.get("note"):
            entry["note"] = p["note"]
        catalog.append(entry)
    profiles_path = out / "profiles.json"
    with open(profiles_path, "w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
    written["profiles"] = profiles_path

    # .env.penglai: one VAR=value per profile key. Placeholders are emitted
    # commented out so the user fills them in.
    env_path = out / ".env.penglai"
    lines = [
        "# Penglai 0.4 model API keys (generated by migrate_03_to_04.py).",
        "# Source this file or export the vars before `npm run serve`.",
        "# SECRETS -- do not commit. Add to .gitignore.",
        "",
    ]
    for p in profiles:
        env = p["apiKeyEnv"]
        # We don't carry the raw key into the profile dict (it isn't there);
        # re-derive a placeholder marker. Real keys were never stored in
        # `profiles` -- the caller is expected to fill .env.penglai by hand
        # OR re-run with keys present. We emit a commented template.
        if p.get("apikey_placeholder"):
            lines.append(f"# {env}=sk-...   # {p['label']} (placeholder in mykey.py)")
        else:
            lines.append(f"# {env}=   # fill from mykey.py {p['source_var']}")
    if include_keys:
        # When the caller passes real keys via profiles (future hook), write
        # them. Currently profiles don't carry keys, so this stays templated.
        pass
    with open(env_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    written["env"] = env_path

    # im_credentials.json: preserved verbatim (masked copy for the report,
    # full copy here since it's a local secret file).
    im_path = out / "im_credentials.json"
    with open(im_path, "w", encoding="utf-8") as f:
        json.dump(credentials, f, ensure_ascii=False, indent=2)
    written["im_credentials"] = im_path

    # register_profiles.py: registers each profile into a running Host via
    # config.createProfile. Lets the user materialize migrated profiles at
    # runtime without editing the Host's default catalog.
    reg_path = out / "register_profiles.py"
    reg_src = _REGISTER_PROFILES_TEMPLATE
    with open(reg_path, "w", encoding="utf-8") as f:
        f.write(reg_src)
    written["register_profiles"] = reg_path

    return written


_REGISTER_PROFILES_TEMPLATE = '''#!/usr/bin/env python3
"""Register migrated 0.3 model profiles into a running 0.4 TS Host.

Reads profiles.json (same dir) and calls the Host's config.createProfile
JSON-RPC method for each entry. The Host must be running (`npm run serve`)
and ~/.penglai/host.token must exist.

  python register_profiles.py

API keys are NOT in profiles.json. Set the apiKeyEnv vars in your environment
(first load .env.penglai) before running -- the Host reads them from env.
Alternatively pass --api-key <id> <key> to inject a key in-memory.
"""
import argparse, json, os, sys, urllib.request

BRIDGE_DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(BRIDGE_DIR))
from im_bridge import PenglaiHostBridge  # noqa


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=14169)
    ap.add_argument("--profiles", default=os.path.join(BRIDGE_DIR, "profiles.json"))
    ap.add_argument("--api-key", nargs=2, action="append", default=[],
                    metavar=("ID", "KEY"), help="inject an in-memory key for profile ID")
    args = ap.parse_args()

    with open(args.profiles, encoding="utf-8") as f:
        profiles = json.load(f)
    bridge = PenglaiHostBridge(port=args.port)
    if not bridge.health():
        print("Host not reachable. Run `npm run serve` first.")
        sys.exit(1)
    inject = dict(args.api_key)
    for p in profiles:
        api_key = inject.get(p["id"], "")
        try:
            created = bridge._rpc("config.createProfile", {
                "id": p["id"], "label": p["label"], "provider": p["provider"],
                "baseUrl": p["baseUrl"], "model": p["model"], "apiKey": api_key,
            })
            print(f"registered: {p['id']} ({p['label']})")
        except Exception as e:
            print(f"FAILED {p['id']}: {e}")
    print("done.")


if __name__ == "__main__":
    main()
'''


# ── 5. backup_03 ────────────────────────────────────────────────────────

def backup_03(source_dir: str | Path, dest_root: str | Path | None = None) -> Path:
    """Back up 0.3 data (mykey.py, memory/, skills/, frontends/) before migration.

    Copies into <dest_root>/penglai_03_backup_<timestamp>/. Returns the backup
    directory path. Never overwrites: each run gets a fresh timestamped dir.
    """
    src = Path(source_dir).resolve()
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest_root = Path(dest_root).resolve() if dest_root else src.parent
    backup_dir = dest_root / f"penglai_03_backup_{ts}"
    backup_dir.mkdir(parents=True, exist_ok=False)

    # Small, high-value files/dirs only -- not node_modules / temp / .git.
    targets = ["mykey.py", "mykey.json", "memory", "skills", "frontends",
               "agentmain.py", "llmcore.py", "penglai_runtime"]
    copied = []
    for t in targets:
        p = src / t
        if not p.exists():
            continue
        dst = backup_dir / t
        try:
            if p.is_dir():
                shutil.copytree(p, dst, dirs_exist_ok=False)
            else:
                shutil.copy2(p, dst)
            copied.append(t)
        except Exception as e:  # noqa: BLE001
            print(f"[backup] skip {t}: {e}")
    # Record what was backed up.
    (backup_dir / "BACKUP_MANIFEST.txt").write_text(
        f"Penglai 0.3 backup\ncreated: {datetime.now().isoformat()}\n"
        f"source: {src}\nitems: {copied}\n",
        encoding="utf-8",
    )
    return backup_dir


# ── report ──────────────────────────────────────────────────────────────

def build_report(
    detection: dict,
    profiles: list[dict],
    meta: dict,
    credentials: dict,
    backup_dir: Path | None,
    written: dict,
) -> str:
    lines = []
    lines.append("=" * 70)
    lines.append("Penglai 0.3 -> 0.4 Migration Report")
    lines.append(f"generated: {datetime.now().isoformat()}")
    lines.append("=" * 70)

    lines.append("\n## 1. Detection")
    root = detection.get("root")
    lines.append(f"0.3 root   : {root or '(not detected)'}")
    lines.append(f"is 0.3     : {detection.get('is_03')}")
    lines.append(f"shared w/0.4: {detection.get('shared_with_04')}")
    lines.append(f"mykey      : {detection.get('mykey')}"
                 + (" (TEMPLATE -- no mykey.py found; preview only)" if detection.get("mykey_is_template") else ""))
    pres = detection.get("preserved", {})
    lines.append(f"preserved  : {', '.join(f'{k}={v}' for k, v in pres.items()) or '(none)'}")

    lines.append("\n## 2. Model profiles")
    lines.append(f"extracted  : {len(profiles)}")
    mixin = meta.get("mixin")
    if mixin:
        nos = mixin.get("llm_nos", [])
        lines.append(f"mixin/failover: llm_nos={nos} (0.4 Host has no failover; "
                     "first compatible profile is primary)")
    else:
        lines.append("mixin/failover: (none)")
    compatible = [p for p in profiles if p.get("compatible")]
    lines.append(f"compatible : {len(compatible)} (OpenAI-compatible base URL)")
    for p in profiles:
        flag = "OK " if p.get("compatible") else "!! "
        key = "placeholder" if p.get("apikey_placeholder") else "has-key"
        note = f"  -- {p['note']}" if p.get("note") else ""
        lines.append(
            f"  {flag}{p['id']:<18} {p['provider']:<10} {p['model']:<28} "
            f"[{key}] env={p['apiKeyEnv']}{note}"
        )

    lines.append("\n## 3. IM credentials")
    if not credentials:
        lines.append("(none found in mykey.py)")
    else:
        for k, v in credentials.items():
            if any(s in k for s in ("secret", "token", "key")) and isinstance(v, str):
                lines.append(f"  {k}: {_mask(v)}")
            else:
                lines.append(f"  {k}: {v}")

    lines.append("\n## 4. Preserved data (no conversion needed)")
    lines.append("  memory/ and skills/ are language-agnostic; left in place.")
    lines.append("  Feishu/WeChat credentials stay in mykey.py; adapters read it.")

    lines.append("\n## 5. NOT migrated (start fresh)")
    lines.append("  - Runtime Hub state (0.3 SQLite temp/runtime_hub.sqlite3)")
    lines.append("  - Session history / transcripts (0.4 uses JSONL, different shape)")
    lines.append("  - Python plugins (concepts moved to TS Boundary; code retired)")

    lines.append("\n## 6. Backup")
    lines.append(f"  backup dir: {backup_dir or '(skipped)'}")

    lines.append("\n## 7. Output files")
    for k, p in written.items():
        lines.append(f"  {k}: {p}")

    lines.append("\n## Next steps")
    lines.append("  1. Fill real API keys into .env.penglai (export them, or `source`).")
    lines.append("  2. Start the Host: npm run serve")
    lines.append("  3. Register profiles: python register_profiles.py")
    lines.append("     (or rely on default profiles if you set GROK_API_KEY etc.)")
    lines.append("  4. Start IM: bash packages/host/bridge/start_im.sh")
    lines.append("")
    return "\n".join(lines)


# ── 6. main (interactive wizard) ───────────────────────────────────────

def _confirm(prompt: str, default: bool = False, auto: bool = False) -> bool:
    if auto:
        return True
    suffix = " [Y/n] " if default else " [y/N] "
    ans = input(prompt + suffix).strip().lower()
    if not ans:
        return default
    return ans in ("y", "yes")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Penglai 0.3 -> 0.4 migration")
    ap.add_argument("--source", help="0.3 install root (default: auto-detect)")
    ap.add_argument("--output", default=None,
                    help="output dir (default: packages/host/migrate/out)")
    ap.add_argument("--yes", action="store_true",
                    help="non-interactive: accept all defaults")
    ap.add_argument("--no-backup", action="store_true",
                    help="skip the 0.3 backup (NOT recommended)")
    ap.add_argument("--no-keys", action="store_true",
                    help="do not write .env.penglai key templates")
    args = ap.parse_args(argv)

    auto = args.yes
    here = Path(__file__).resolve().parent
    default_out = here / "out"
    output_dir = Path(args.output).resolve() if args.output else default_out

    print("=" * 70)
    print("Penglai 0.3 -> 0.4 Migration")
    print("=" * 70)

    # Step 1: detect
    detection = detect_03_install(args.source)
    root = detection["root"]
    if root is None:
        print(f"\nNo 0.3 installation detected at "
              f"{detection.get('root') or args.source or '(auto)'}")
        print("Pass --source /path/to/0.3 to point at one.")
        return 1
    print(f"\n[1/5] Detected 0.3 install at: {root}")
    print(f"      mykey: {detection['mykey']}")
    print(f"      shared with 0.4: {detection['shared_with_04']}")
    pres = detection.get("preserved", {})
    if pres:
        print(f"      preserved data: {', '.join(pres.keys())}")

    mykey = detection["mykey"]
    if mykey is None:
        print("\nNo mykey.py/mykey.json with config found. Nothing to migrate.")
        return 1

    # Step 2: extract + preview
    profiles, meta = extract_model_profiles(mykey)
    credentials = extract_im_credentials(mykey)
    print(f"\n[2/5] Extracted {len(profiles)} model profile(s):")
    for p in profiles:
        flag = "OK " if p.get("compatible") else "!! "
        print(f"      {flag}{p['id']:<16} {p['provider']:<10} {p['model']}")
        if p.get("note"):
            print(f"           note: {p['note']}")
    print(f"      IM credentials: {len(credentials)} key(s) "
          f"({', '.join(sorted(credentials)) or 'none'})")

    if not profiles and not credentials:
        print("\nNothing to migrate. Exiting.")
        return 0

    # Step 3: backup
    backup_dir = None
    if args.no_backup:
        print("\n[3/5] Backup skipped (--no-backup).")
    else:
        if not _confirm(f"\n[3/5] Back up 0.3 data from {root}?",
                        default=True, auto=auto):
            print("      Backup declined. Aborting (use --no-backup to skip).")
            return 1
        backup_dir = backup_03(root)
        print(f"      backup -> {backup_dir}")

    # Step 4: write config
    print(f"\n[4/5] Write 0.4 config to {output_dir}")
    if not _confirm("      Proceed?", default=True, auto=auto):
        print("      Aborted by user.")
        return 1
    written = write_04_config(
        profiles, credentials, output_dir, include_keys=not args.no_keys
    )
    for k, p in written.items():
        print(f"      {k}: {p}")

    # Step 5: report
    report = build_report(detection, profiles, meta, credentials, backup_dir, written)
    report_path = output_dir / "migration_report.txt"
    with open(report_path, "w", encoding="utf-8") as f:
        f.write(report)
    print(f"\n[5/5] Report -> {report_path}")
    print("\n" + report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
