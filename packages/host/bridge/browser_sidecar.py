#!/usr/bin/env python3
"""Penglai 0.4 browser tool sidecar.

Bridges the TS Core's `web_scan` / `web_execute_js` tools to GA's browser stack
(`TMWebDriver` + `simphtml`) which ships as Python in the PenglaiAgent root.

docs/0.4/12-UPSTREAM-SYNC.md §6.2: GA's browser stack is a *Tool sidecar*, not
the Core. The TS host spawns this script, sends a JSON request on stdin, and
reads a JSON response on stdout -- it never vendors TMWebDriver/simphtml.

Protocol
--------
stdin  : {"tool": "web_scan" | "web_execute_js", "args": {...}, "workspaceRoot": "..."}
stdout : {"ok": true|false, "text": "..."}

`web_scan` args : tabs_only (bool), text_only (bool)
`web_execute_js` args : script (str)

The script imports `TMWebDriver` and `simphtml` directly (not the heavy `ga`
module) and mirrors the thin dispatch in ga.py:web_scan / web_execute_js. If the
Python deps (bottle, requests, simple_websocket_server, bs4) or a connected
browser tab are missing, a clear error is returned rather than crashing.
"""

import json
import os
import sys
import time
import traceback


def _repo_root():
    # packages/host/bridge/browser_sidecar.py -> repo root (3 levels up).
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", "..", ".."))


def _ensure_repo_on_path():
    root = _repo_root()
    if root not in sys.path:
        sys.path.insert(0, root)


# Shared driver across calls within one sidecar process. The TS host spawns a
# fresh process per tool call, so this mainly avoids re-init if a process ever
# handles multiple requests.
_driver = None


def _get_driver():
    global _driver
    if _driver is None:
        _ensure_repo_on_path()
        from TMWebDriver import TMWebDriver  # noqa: WPS433 (lazy import on demand)

        _driver = TMWebDriver()
        # Wait briefly for at least one browser tab to register (mirrors
        # ga.first_init_driver's retry loop, but shorter).
        for _ in range(7):
            if _driver.get_all_sessions():
                break
            time.sleep(1)
    return _driver


def _short(url):
    url = url or ""
    return url[:50] + ("..." if len(url) > 50 else "")


def web_scan(args):
    driver = _get_driver()
    sessions = driver.get_all_sessions()
    if not sessions:
        return {"status": "error", "msg": "no browser tabs connected"}

    tabs_only = bool(args.get("tabs_only", False))
    text_only = bool(args.get("text_only", False))

    tabs = []
    for sess in sessions:
        sess.pop("connected_at", None)
        sess.pop("type", None)
        sess["url"] = _short(sess.get("url", ""))
        tabs.append(sess)

    result = {
        "status": "success",
        "metadata": {
            "tabs_count": len(tabs),
            "tabs": tabs,
            "active_tab": driver.default_session_id,
        },
    }
    if not tabs_only:
        import simphtml  # noqa: WPS433

        result["content"] = simphtml.get_html(
            driver, cutlist=True, maxchars=35000, text_only=text_only
        )
    return result


def web_execute_js(args):
    driver = _get_driver()
    if not driver.get_all_sessions():
        return {"status": "error", "msg": "no browser tabs connected"}
    script = args.get("script", "")
    import simphtml  # noqa: WPS433

    return simphtml.execute_js_rich(script, driver, no_monitor=False)


def _emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, default=str))
    sys.stdout.write("\n")
    sys.stdout.flush()


def main():
    try:
        raw = sys.stdin.read()
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "text": f"failed to read stdin: {exc}"})
        return

    if not raw.strip():
        _emit({"ok": False, "text": "empty request"})
        return

    try:
        req = json.loads(raw)
    except Exception as exc:  # noqa: BLE001
        _emit({"ok": False, "text": f"invalid JSON request: {exc}"})
        return

    tool = req.get("tool")
    args = req.get("args") or {}
    if tool not in ("web_scan", "web_execute_js"):
        _emit({"ok": False, "text": f"unknown browser tool: {tool}"})
        return

    # Importing TMWebDriver/simphtml pulls in optional deps (bottle, requests,
    # simple_websocket_server, bs4). If they are missing, surface a clear error
    # instead of a traceback to the TS caller.
    try:
        _ensure_repo_on_path()
        # Touch the modules lazily inside _get_driver / the handlers so the
        # error message names the real failure.
        if tool == "web_scan":
            result = web_scan(args)
        else:
            result = web_execute_js(args)
    except Exception as exc:  # noqa: BLE001
        _emit(
            {
                "ok": False,
                "text": (
                    f"browser sidecar failed: {type(exc).__name__}: {exc}\n"
                    + traceback.format_exc()
                ),
            }
        )
        return

    # ga-style results are dicts; collapse to a JSON string for the ToolResult
    # `text` field so the TS host passes a single string back to the model.
    _emit({"ok": True, "text": json.dumps(result, ensure_ascii=False, default=str)})


if __name__ == "__main__":
    main()
