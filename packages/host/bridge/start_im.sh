#!/bin/bash
#
# Penglai 0.4 - Start the TS Host + IM adapters.
#
# Brings up the 0.4 TypeScript Host (JSON-RPC over loopback) and, if their
# credentials are configured, the Feishu and WeChat adapters that bridge IM
# messages to the Host.
#
#   bash packages/host/bridge/start_im.sh
#
# Environment overrides:
#   PENGLAI_HOST_PORT   Host port (default 14169, must match `npm run serve`)
#   PENGLAI_IM_WORKSPACE  workspace path the Host agent operates in
#   PENGLAI_IM_TIMEOUT  per-turn timeout in seconds (default 300)
#   SKIP_FEISHU=1       do not start the Feishu adapter
#   SKIP_WECHAT=1       do not start the WeChat adapter
#
# Each adapter is optional: it only starts if its credentials are present
# (Feishu: fs_app_id/fs_app_secret in mykey.py; WeChat: a logged-in iLink
# token in ~/.wxbot/token.json) and not explicitly skipped. The Host always
# starts; adapters print a clear warning and exit if the Host isn't up.
#
# Signals: Ctrl+C (SIGINT) tears down the Host and both adapters together
# via `wait` + trap. The Host's own SIGINT handler closes its server cleanly.

set -u

# Resolve the repo root from this script's location (packages/host/bridge).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
cd "$REPO_ROOT"

PYTHON="${PYTHON:-python}"
HOST_PORT="${PENGLAI_HOST_PORT:-14169}"
ADAPTER_DIR="$SCRIPT_DIR"

pids=()

cleanup() {
  echo "[start_im] shutting down..."
  for pid in "${pids[@]:-}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  # Give children a moment, then force-kill anything still alive.
  sleep 1
  for pid in "${pids[@]:-}"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  done
  exit 0
}
trap cleanup INT TERM

echo "[start_im] repo root: $REPO_ROOT"
echo "[start_im] host port: $HOST_PORT"

# ── 1. Start the TS Host ────────────────────────────────────────────────
# `npm run serve` runs `node --import tsx packages/host/src/cli.ts serve`.
# It binds 127.0.0.1:$HOST_PORT and writes ~/.penglai/host.token on first run.
echo "[start_im] starting TS Host (npm run serve)..."
npm run serve -- --port "$HOST_PORT" &
HOST_PID=$!
pids+=("$HOST_PID")

# Wait for the Host to be reachable before starting adapters. Poll /health
# for up to ~30s; if it never comes up, adapters would just spin on retries
# anyway, but starting them early produces confusing interleaved logs.
echo "[start_im] waiting for Host health..."
for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$HOST_PORT/health" >/dev/null 2>&1; then
    echo "[start_im] Host is healthy (after ${i}s)."
    break
  fi
  if ! kill -0 "$HOST_PID" 2>/dev/null; then
    echo "[start_im] ERROR: Host process exited before becoming healthy."
    exit 1
  fi
  sleep 1
  if [ "$i" -eq 30 ]; then
    echo "[start_im] WARNING: Host not healthy after 30s; starting adapters anyway."
  fi
done

# Small extra delay so the token file is flushed to ~/.penglai/host.token.
sleep 1

# ── 2. Start the Feishu adapter (if configured) ─────────────────────────
if [ "${SKIP_FEISHU:-0}" = "1" ]; then
  echo "[start_im] SKIP_FEISHU=1 -> Feishu adapter not started."
else
  # Only start if mykey.py has fs_app_id. The adapter itself also checks,
  # but checking here avoids spawning a process that immediately exits.
  if "$PYTHON" - <<'PY' 2>/dev/null
import importlib.util, json, os, sys
from pathlib import Path
root = Path(os.environ.get("REPO_ROOT", ".")).resolve()
for cand in (root / "mykey.py", root / "mykey.json"):
    if not cand.exists():
        continue
    try:
        if cand.suffix == ".py":
            spec = importlib.util.spec_from_file_location("_k", cand)
            m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
            d = {k: v for k, v in vars(m).items() if not k.startswith("_")}
        else:
            d = json.loads(cand.read_text(encoding="utf-8"))
        if d.get("fs_app_id") and d.get("fs_app_secret"):
            sys.exit(0)
    except Exception:
        pass
sys.exit(1)
PY
  then
    echo "[start_im] starting Feishu adapter..."
    "$PYTHON" "$ADAPTER_DIR/feishu_adapter.py" &
    FS_PID=$!
    pids+=("$FS_PID")
  else
    echo "[start_im] Feishu credentials not found in mykey.py -> skipping Feishu adapter."
  fi
fi

# ── 3. Start the WeChat adapter (if configured) ─────────────────────────
if [ "${SKIP_WECHAT:-1}" = "1" ]; then
  echo "[start_im] SKIP_WECHAT=1 (default) -> WeChat adapter not started."
else
  # WeChat needs a logged-in iLink token (~/.wxbot/token.json) OR the user
  # is ready to scan a QR on first run. We start it unconditionally when
  # not skipped; the adapter will prompt for QR login if no token exists.
  echo "[start_im] starting WeChat adapter..."
  "$PYTHON" "$ADAPTER_DIR/wechat_adapter.py" &
    WC_PID=$!
    pids+=("$WC_PID")
fi

echo "[start_im] all components started. Ctrl+C to stop."
echo "[start_im] pids: host=$HOST_PID feishu=${FS_PID:-none} wechat=${WC_PID:-none}"

# Block until any child exits. `wait -n` returns when the first background
# job does; we then tear everything down so a crash in one component doesn't
# leave orphans (e.g. adapters without a Host, or a Host with dead adapters).
wait -n
EXIT_CODE=$?
echo "[start_im] a component exited (code $EXIT_CODE); shutting down the rest."
cleanup
