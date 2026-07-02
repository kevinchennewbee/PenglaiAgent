# -*- coding: utf-8 -*-
"""Local Companion Loop state helpers.

This module is deliberately small: it exposes observable state for the desktop
surface and keeps adaptive companion data as local JSON artifacts.  The actual
LLM generation still goes through reflect/penglai_companion.py and Runtime Hub.
"""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from .context_events import recent_context_events
from .redaction import redact_obj, redact_text


VALID_MODES = {"off", "quiet", "present", "active"}
MODE_ALIASES = {"normal": "present"}


def normalize_mode(mode: str | None) -> str:
    value = str(mode or "present").strip().lower()
    value = MODE_ALIASES.get(value, value)
    return value if value in VALID_MODES else "present"


def temp_dir(root: str | os.PathLike[str]) -> Path:
    path = Path(root).resolve() / "temp"
    path.mkdir(parents=True, exist_ok=True)
    return path


def state_path(root: str | os.PathLike[str]) -> Path:
    return temp_dir(root) / "companion_state.json"


def profile_path(root: str | os.PathLike[str]) -> Path:
    return temp_dir(root) / "companion_profile.json"


def feedback_path(root: str | os.PathLike[str]) -> Path:
    return temp_dir(root) / "companion_feedback.jsonl"


def _load_json(path: Path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def companion_profile(root: str | os.PathLike[str]) -> dict:
    profile = _load_json(profile_path(root), {})
    if not isinstance(profile, dict):
        profile = {}
    profile.setdefault("stage", "new")
    profile.setdefault("confirmed", {})
    profile.setdefault("inferred", [])
    profile.setdefault("boundaries", [])
    return redact_obj(profile)


def companion_state(root: str | os.PathLike[str]) -> dict:
    state = _load_json(state_path(root), {})
    return state if isinstance(state, dict) else {}


def companion_heartbeats(*, limit: int = 20, max_age_hours: int = 168) -> list[dict]:
    events = recent_context_events(
        limit=max(1, min(int(limit or 20), 100)),
        max_age_hours=max_age_hours,
        channel="companion",
        include_legacy=True,
    )
    items = []
    for event in reversed(events):
        meta = event.get("metadata") if isinstance(event.get("metadata"), dict) else {}
        items.append(
            {
                "ts": time.strftime("%Y-%m-%d %H:%M", time.localtime(float(event.get("ts", 0) or 0))),
                "kind": event.get("kind", ""),
                "tag": meta.get("trigger") or event.get("kind", ""),
                "mode": meta.get("mode", ""),
                "message": redact_text(event.get("text", "")),
                "run_id": meta.get("run_id", ""),
            }
        )
    return items


def append_feedback(root: str | os.PathLike[str], feedback: dict) -> dict:
    rec = {
        "ts": time.time(),
        "type": str(feedback.get("type") or "feedback"),
        "value": redact_text(feedback.get("value", "")),
        "context": redact_obj(feedback.get("context") or {}),
    }
    path = feedback_path(root)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(rec, ensure_ascii=False, sort_keys=True) + "\n")
    return rec


def run_companion_loop_tick(cfg: dict, state: dict, now: float | None = None, *, root: str | os.PathLike[str] | None = None) -> dict:
    """执行一次 Companion Loop tick（Phase 5 完整闭环）。

    observe -> reflect -> propose -> choose -> express -> (act 由调用方执行) -> learn

    返回 CompanionDecision：
    {
      "decision": "speak"|"silent"|"defer",
      "opportunity": {"kind":..., "score":...}|None,
      "expression": {"mode":..., "voice":...},
      "why": "...",
      "evidence_ids": [...],
      "plan": [...]  # dialogue plan steps（speak 时）
    }

    不创建新 agent，不启动独立进程，不绕 Runtime Hub。
    act（投递）由调用方（reflect/penglai_companion.py）通过 Runtime Hub 执行。
    """
    now = now or time.time()
    cfg = cfg or {}
    state = state or {}

    # observe + reflect：生成当天反思（如果 root 提供）
    reflection = {}
    if root is not None:
        try:
            from .daily_reflection import generate_reflection
            reflection = generate_reflection(root, now=now, cfg=cfg) or {}
        except Exception:
            reflection = {}

    # propose：挖掘机会
    from .care_opportunities import mine_care_opportunities
    opportunities = mine_care_opportunities(reflection, cfg, now)

    # choose + express：策略判断
    from .companion_policy import decide_companion_action
    decision = decide_companion_action(cfg, state, reflection, now, opportunities=opportunities)

    # 如果决定 speak，生成 dialogue plan
    if decision.get("decision") == "speak" and decision.get("opportunity"):
        from .proactive_dialogue import build_dialogue_plan
        opp = decision["opportunity"]
        opp["evidence_ids"] = decision.get("evidence_ids", [])
        opp["suggested_opening"] = decision.get("suggested_opening", "")
        plan = build_dialogue_plan(opp, cfg, state)
        decision["plan"] = plan

    return decision

