"""
Penglai 0.4 IM Bridge - connects existing Python IM adapters to TS Host.

Usage in existing IM code:
    from im_bridge import PenglaiHostBridge
    bridge = PenglaiHostBridge(port=14169)

    # When IM message arrives:
    result = bridge.prompt(text="用户消息", workspace_path="/path/to/project")
    # result is the assistant's response text

    # Or async with callback:
    bridge.prompt_async(text, workspace_path, callback=lambda response: send_to_im(response))

This replaces the old 0.3 Python Runtime Hub call site. Existing Feishu/WeChat
adapters only need to swap their `runtime.prompt(...)` call for
`bridge.prompt(...)`; everything else (message routing, IM auth) stays the same.

Design notes:
  - Loopback only: the TS Host binds 127.0.0.1, so this bridge does too.
  - Token-gated: reads ~/.penglai/host.token (auto-created by the Host on first
    `npm run serve`) and sends it as `Authorization: Bearer <token>`.
  - Intentionally simple: synchronous polling of session.get, no WebSocket.
    Good enough for M4 IM (low message rate); upgrade to WS streaming later.
  - Security: IM sessions should run under the `chat_safe` policy profile
    (read-only). The Host enforces policy at the Boundary; the bridge just
    forwards text. See docs/0.4/01-CONSTITUTION.md §7.2 and policy.ts.
"""

import json
import os
import threading
import time
import urllib.error
import urllib.request


class PenglaiHostBridge:
    def __init__(self, port=14169, token=None):
        port = int(port)
        if not 1 <= port <= 65535:
            raise ValueError("Host port is out of range")
        self.base_url = f"http://127.0.0.1:{port}"
        self.token = token or self._load_token()

    def _load_token(self):
        token_path = os.path.expanduser("~/.penglai/host.token")
        try:
            with open(token_path) as f:
                return f.read().strip()
        except FileNotFoundError:
            raise RuntimeError(
                "Host token not found. Is the TS Host running? Run: npm run serve"
            )

    def _rpc(self, method, params=None):
        payload = json.dumps(
            {"jsonrpc": "2.0", "method": method, "params": params or {}, "id": 1}
        ).encode()
        req = urllib.request.Request(
            f"{self.base_url}/api",
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.token}",
            },
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
            if "error" in data:
                raise RuntimeError(f"Host error: {data['error']}")
            return data.get("result")

    def health(self):
        """Check if host is running."""
        try:
            with urllib.request.urlopen(f"{self.base_url}/health", timeout=5) as resp:
                return resp.status == 200
        except Exception:
            return False

    def open_workspace(self, root_path, name=None):
        return self._rpc(
            "workspace.open",
            {"rootPath": root_path, "name": name or os.path.basename(root_path)},
        )

    def create_session(self, workspace_id, title="IM Session", model_profile_id="default",
                       source=None, policy_profile=None):
        """Create a session on the Host.

        ``source`` tags the session origin (e.g. ``"im"``). When ``source ==
        "im"`` the Host FORCES the ``chat_safe`` policy profile (read-only)
        regardless of any ``policy_profile`` passed here, so untrusted IM input
        can never drive write/edit/bash. ``policy_profile`` is forwarded as a
        hint for non-IM sources (``"full_auto_workspace"`` | ``"chat_safe"``).
        """
        params = {
            "workspaceId": workspace_id,
            "title": title,
            "modelProfileId": model_profile_id,
        }
        if source is not None:
            params["source"] = source
        if policy_profile is not None:
            params["policyProfile"] = policy_profile
        return self._rpc("session.create", params)

    def open_im_session(self, workspace_path, title="IM Session", source="im"):
        """Open a workspace + create a session ready for IM turns.

        Convenience for adapters that want to reuse one session per user
        across multiple turns (so multi-turn context survives). Picks the
        first model profile whose API-key env var is set, falling back to
        the first profile in the catalog -- the same logic ``prompt()`` uses
        internally. Returns the session dict (``{"id": ..., ...}``).

        ``source`` defaults to ``"im"`` so the Host enforces the ``chat_safe``
        policy (read-only) on this session: IM is an untrusted surface
        (docs/0.4/01-CONSTITUTION.md §7.2) and must not run write/edit/bash.

        Use the returned id as ``session_id=`` for subsequent ``prompt`` /
        ``prompt_async`` calls so the Host keeps the transcript.
        """
        ws = self.open_workspace(workspace_path)
        return self.create_session(
            ws["id"], title=title, model_profile_id=self._pick_profile(),
            source=source,
        )

    def list_sessions(self):
        return self._rpc("session.list", {})

    def list_profiles(self):
        """Return the Host's configured model profiles (no API keys leak)."""
        return self._rpc("config.listProfiles", {})

    def _pick_profile(self):
        """Pick a usable model profile id.

        The Host ships default profiles (grok/deepseek/glm/openai) but no profile
        literally named 'default'. For prompt() we prefer the first profile whose
        API-key env var is set, falling back to the first profile in the catalog.
        """
        try:
            profiles = self.list_profiles()
        except Exception:
            return "grok"
        if not profiles:
            return "grok"
        for p in profiles:
            env = p.get("apiKeyEnv") or ""
            if env and os.environ.get(env):
                return p["id"]
        return profiles[0]["id"]

    def prompt(self, text, workspace_path=None, session_id=None, goal_objective=None, timeout=120):
        """Send a prompt and wait for response. Returns assistant text.

        If `session_id` is omitted, a workspace + session are created on the fly
        (using the first model profile that has an API key configured). If
        `goal_objective` is given, a goal is bound to the session so the agent
        iterates toward it.
        """
        # Open workspace if needed.
        if workspace_path and not session_id:
            ws = self.open_workspace(workspace_path)
            workspace_id = ws["id"]
            sess = self.create_session(
                workspace_id, model_profile_id=self._pick_profile()
            )
            session_id = sess["id"]

        # Create goal if specified.
        if goal_objective:
            self._rpc(
                "goal.create", {"sessionId": session_id, "objective": goal_objective}
            )

        # Send prompt (this starts the async agent; the call returns immediately).
        self._rpc("session.prompt", {"sessionId": session_id, "text": text})

        # Poll for completion (simplified - real version would use WebSocket).
        # The Host transitions session.status: idle -> running -> waiting_user
        # (turn done) or error (turn failed). We keep polling while "running".
        deadline = time.time() + timeout
        while time.time() < deadline:
            time.sleep(2)
            sess_data = self._rpc("session.get", {"sessionId": session_id})
            status = sess_data["session"]["status"]
            if status == "running":
                continue
            # Turn finished (waiting_user / idle / error / archived).
            messages = sess_data.get("messages", [])
            for msg in reversed(messages):
                if msg["role"] == "assistant":
                    # Extract text from content.
                    for c in msg.get("content", []):
                        if c.get("type") == "text":
                            return c["text"]
            if status == "error":
                return "(host error: session ended in error state)"
            return "(no response)"
        return "(timeout)"

    def prompt_async(self, text, workspace_path=None, session_id=None,
                     goal_objective=None, callback=None, timeout=120):
        """Run prompt() on a background thread; invoke callback with the result.

        `callback` receives the assistant text on success, or the Exception on
        failure. Returns the started Thread (daemon) so callers may join it.
        """
        def _run():
            try:
                result = self.prompt(
                    text,
                    workspace_path=workspace_path,
                    session_id=session_id,
                    goal_objective=goal_objective,
                    timeout=timeout,
                )
            except Exception as e:  # noqa: BLE001 - bridge must not crash caller
                result = e
            if callback is not None:
                try:
                    callback(result)
                except Exception:
                    pass

        t = threading.Thread(target=_run, daemon=True)
        t.start()
        return t

    def abort(self, session_id):
        return self._rpc("session.abort", {"sessionId": session_id})

    def cancel_goal(self, goal_id):
        return self._rpc("goal.cancel", {"goalId": goal_id})
