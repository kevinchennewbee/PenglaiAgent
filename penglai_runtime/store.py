# -*- coding: utf-8 -*-
"""SQLite state store for the Penglai Runtime Hub."""

import json
import os
import sqlite3
import time

from .redaction import redact_obj, redact_text
from .private_files import ensure_private_dir, harden_private_file


def default_store_path(root=None):
    override = os.environ.get("PENGLAI_RUNTIME_STORE_PATH", "").strip()
    if override:
        path = os.path.abspath(os.path.expanduser(override))
        ensure_private_dir(os.path.dirname(path))
        return path
    base = root or os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    path = os.path.join(base, "temp", "runtime_hub.sqlite3")
    ensure_private_dir(os.path.dirname(path))
    return path


# Statuses that mark a run as finished.  Once a run reaches one of these,
# late overwrites from zombie processes are blocked by record_run().
_TERMINAL_STATUSES = frozenset({"succeeded", "failed", "cancelled"})


def _redacted_json(value):
    return json.dumps(redact_obj(value or {}), ensure_ascii=False, sort_keys=True)


class RuntimeStateStore:
    """Small durable store for runtime events and task runs."""

    def __init__(self, path=None):
        self.path = os.path.abspath(path or default_store_path())
        ensure_private_dir(os.path.dirname(self.path))
        if os.path.lexists(self.path):
            harden_private_file(self.path)
        else:
            descriptor = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(descriptor)
        self._init_db()
        self._harden_database_files()

    def _harden_database_files(self):
        for suffix in ("", "-wal", "-shm"):
            candidate = self.path + suffix
            if os.path.lexists(candidate):
                harden_private_file(candidate)

    def _connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        self._harden_database_files()
        return conn

    def _connect_immediate(self):
        """A connection in autocommit mode for explicit BEGIN IMMEDIATE.

        Used by methods that wrap a read-modify-write cycle in a single
        transaction to prevent TOCTOU races (record_session_state,
        request_cancel, clear_cancel_request).  In WAL mode BEGIN IMMEDIATE
        acquires the write lock up front, so no other writer can interleave
        between the SELECT and the INSERT/UPDATE.
        """
        conn = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
        self._harden_database_files()
        return conn

    def _init_db(self):
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS inbound_events (
                    event_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    chat_id TEXT NOT NULL,
                    chat_type TEXT NOT NULL,
                    text TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    created_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS task_runs (
                    run_id TEXT PRIMARY KEY,
                    event_id TEXT NOT NULL,
                    session_id TEXT NOT NULL,
                    status TEXT NOT NULL,
                    worker_id TEXT NOT NULL,
                    created_at REAL NOT NULL,
                    started_at REAL NOT NULL,
                    finished_at REAL NOT NULL,
                    result_text TEXT NOT NULL,
                    error TEXT NOT NULL,
                    permission_json TEXT NOT NULL DEFAULT '{}',
                    artifacts_json TEXT NOT NULL DEFAULT '[]',
                    log_excerpt TEXT NOT NULL DEFAULT '',
                    metadata_json TEXT NOT NULL,
                    updated_at REAL NOT NULL
                )
                """
            )
            self._ensure_column(conn, "task_runs", "permission_json", "TEXT NOT NULL DEFAULT '{}'")
            self._ensure_column(conn, "task_runs", "artifacts_json", "TEXT NOT NULL DEFAULT '[]'")
            self._ensure_column(conn, "task_runs", "log_excerpt", "TEXT NOT NULL DEFAULT ''")
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_task_runs_session ON task_runs(session_id, created_at)"
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS session_state (
                    session_id TEXT PRIMARY KEY,
                    active INTEGER NOT NULL DEFAULT 0,
                    active_run_id TEXT NOT NULL DEFAULT '',
                    active_status TEXT NOT NULL DEFAULT '',
                    pending_count INTEGER NOT NULL DEFAULT 0,
                    cancel_requested INTEGER NOT NULL DEFAULT 0,
                    cancel_drop_pending INTEGER NOT NULL DEFAULT 0,
                    cancel_reason TEXT NOT NULL DEFAULT '',
                    cancel_requested_at REAL NOT NULL DEFAULT 0,
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    updated_at REAL NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS cancel_requests (
                    request_id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    drop_pending INTEGER NOT NULL DEFAULT 0,
                    reason TEXT NOT NULL DEFAULT '',
                    source TEXT NOT NULL DEFAULT '',
                    created_at REAL NOT NULL,
                    consumed_at REAL NOT NULL DEFAULT 0
                )
                """
            )
            for name, definition in (
                ("active", "INTEGER NOT NULL DEFAULT 0"),
                ("active_run_id", "TEXT NOT NULL DEFAULT ''"),
                ("active_status", "TEXT NOT NULL DEFAULT ''"),
                ("pending_count", "INTEGER NOT NULL DEFAULT 0"),
                ("cancel_requested", "INTEGER NOT NULL DEFAULT 0"),
                ("cancel_drop_pending", "INTEGER NOT NULL DEFAULT 0"),
                ("cancel_reason", "TEXT NOT NULL DEFAULT ''"),
                ("cancel_requested_at", "REAL NOT NULL DEFAULT 0"),
                ("metadata_json", "TEXT NOT NULL DEFAULT '{}'"),
                ("updated_at", "REAL NOT NULL DEFAULT 0"),
            ):
                self._ensure_column(conn, "session_state", name, definition)

    def _ensure_column(self, conn, table, name, definition):
        migrations = {
            ("task_runs", "permission_json", "TEXT NOT NULL DEFAULT '{}'"):
                "ALTER TABLE task_runs ADD COLUMN permission_json TEXT NOT NULL DEFAULT '{}'",
            ("task_runs", "artifacts_json", "TEXT NOT NULL DEFAULT '[]'"):
                "ALTER TABLE task_runs ADD COLUMN artifacts_json TEXT NOT NULL DEFAULT '[]'",
            ("task_runs", "log_excerpt", "TEXT NOT NULL DEFAULT ''"):
                "ALTER TABLE task_runs ADD COLUMN log_excerpt TEXT NOT NULL DEFAULT ''",
            ("session_state", "active", "INTEGER NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN active INTEGER NOT NULL DEFAULT 0",
            ("session_state", "active_run_id", "TEXT NOT NULL DEFAULT ''"):
                "ALTER TABLE session_state ADD COLUMN active_run_id TEXT NOT NULL DEFAULT ''",
            ("session_state", "active_status", "TEXT NOT NULL DEFAULT ''"):
                "ALTER TABLE session_state ADD COLUMN active_status TEXT NOT NULL DEFAULT ''",
            ("session_state", "pending_count", "INTEGER NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN pending_count INTEGER NOT NULL DEFAULT 0",
            ("session_state", "cancel_requested", "INTEGER NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0",
            ("session_state", "cancel_drop_pending", "INTEGER NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN cancel_drop_pending INTEGER NOT NULL DEFAULT 0",
            ("session_state", "cancel_reason", "TEXT NOT NULL DEFAULT ''"):
                "ALTER TABLE session_state ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT ''",
            ("session_state", "cancel_requested_at", "REAL NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN cancel_requested_at REAL NOT NULL DEFAULT 0",
            ("session_state", "metadata_json", "TEXT NOT NULL DEFAULT '{}'"):
                "ALTER TABLE session_state ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'",
            ("session_state", "updated_at", "REAL NOT NULL DEFAULT 0"):
                "ALTER TABLE session_state ADD COLUMN updated_at REAL NOT NULL DEFAULT 0",
        }
        sql = migrations.get((table, name, definition))
        if sql is None:
            raise ValueError("unsupported schema migration column")
        rows = conn.execute(
            "PRAGMA table_info(task_runs)" if table == "task_runs" else "PRAGMA table_info(session_state)"
        ).fetchall()
        if name in {row[1] for row in rows}:
            return
        conn.execute(sql)

    def record_event(self, event, session):
        with self._connect() as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO inbound_events
                (event_id, session_id, channel, user_id, chat_id, chat_type, text, metadata_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    event.event_id,
                    session.session_id,
                    event.channel,
                    event.user_id,
                    event.chat_id,
                    event.chat_type,
                    redact_text(event.text),
                    _redacted_json(event.metadata),
                    time.time(),
                ),
            )

    def record_run(self, task_run, *, allow_terminal_overwrite=False):
        permission = task_run.permission
        permission_json = {}
        if permission is not None:
            permission_json = {
                "request_id": permission.request_id,
                "action": permission.action,
                "prompt": permission.prompt,
                "options": list(permission.options),
                "metadata": permission.metadata or {},
            }
        with self._connect() as conn:
            # Guard: do not let a late success (or any different status)
            # overwrite an already-terminal run.  This prevents zombie
            # processes from clobbering crash-recovery FAILED marks or
            # explicit CANCELLED marks recorded by other processes.
            existing = conn.execute(
                "SELECT status FROM task_runs WHERE run_id = ?",
                (task_run.run_id,),
            ).fetchone()
            if existing and not allow_terminal_overwrite:
                existing_status = existing[0]
                if (existing_status in _TERMINAL_STATUSES
                        and task_run.status != existing_status):
                    # Record the blocked attempt in metadata without
                    # overwriting the terminal row.
                    try:
                        blocked_meta = json.loads(
                            conn.execute(
                                "SELECT metadata_json FROM task_runs WHERE run_id = ?",
                                (task_run.run_id,),
                            ).fetchone()[0] or "{}"
                        )
                    except Exception:
                        blocked_meta = {}
                    blocked_meta.setdefault("blocked_late_overwrite", []).append({
                        "attempted_status": task_run.status,
                        "existing_status": existing_status,
                        "ts": time.time(),
                    })
                    conn.execute(
                        "UPDATE task_runs SET metadata_json = ? WHERE run_id = ?",
                        (
                            _redacted_json(blocked_meta),
                            task_run.run_id,
                        ),
                    )
                    return
            conn.execute(
                """
                INSERT OR REPLACE INTO task_runs
                (run_id, event_id, session_id, status, worker_id, created_at, started_at,
                 finished_at, result_text, error, permission_json, artifacts_json, log_excerpt,
                 metadata_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    task_run.run_id,
                    task_run.event_id,
                    task_run.session_id,
                    task_run.status,
                    task_run.worker_id,
                    float(task_run.created_at or 0),
                    float(task_run.started_at or 0),
                    float(task_run.finished_at or 0),
                    redact_text(task_run.result_text or ""),
                    redact_text(task_run.error or ""),
                    _redacted_json(permission_json),
                    json.dumps(redact_obj(list(task_run.artifacts or ())), ensure_ascii=False, sort_keys=True),
                    redact_text(task_run.log_excerpt or ""),
                    _redacted_json(task_run.metadata),
                    time.time(),
                ),
            )

    def recent_runs(self, *, session_id=None, limit=20):
        sql = (
            "SELECT run_id, event_id, session_id, status, worker_id, created_at, "
            "started_at, finished_at, result_text, error, permission_json, artifacts_json "
            "FROM task_runs"
        )
        args = []
        if session_id:
            sql += " WHERE session_id = ?"
            args.append(session_id)
        sql += " ORDER BY created_at DESC LIMIT ?"
        args.append(int(limit))
        with self._connect() as conn:
            rows = conn.execute(sql, args).fetchall()
        return [
            {
                "run_id": r[0],
                "event_id": r[1],
                "session_id": r[2],
                "status": r[3],
                "worker_id": r[4],
                "created_at": r[5],
                "started_at": r[6],
                "finished_at": r[7],
                "result_text": r[8],
                "error": r[9],
                "permission": _loads(r[10], {}),
                "artifacts": _loads(r[11], []),
            }
            for r in rows
        ]

    def get_run(self, run_id):
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT run_id, event_id, session_id, status, worker_id, created_at,
                       started_at, finished_at, result_text, error, permission_json,
                       artifacts_json, log_excerpt, metadata_json, updated_at
                FROM task_runs WHERE run_id = ?
                """,
                (str(run_id),),
            ).fetchone()
        if not row:
            return None
        return {
            "run_id": row[0],
            "event_id": row[1],
            "session_id": row[2],
            "status": row[3],
            "worker_id": row[4],
            "created_at": row[5],
            "started_at": row[6],
            "finished_at": row[7],
            "result_text": row[8],
            "error": row[9],
            "permission": _loads(row[10], {}),
            "artifacts": _loads(row[11], []),
            "log_excerpt": row[12],
            "metadata": _loads(row[13], {}),
            "updated_at": row[14],
        }

    def get_crashed_runs(self):
        """Return runs left in non-terminal states (running/waiting_permission).

        Called at service startup to find zombie TaskRuns left behind by a
        crashed process.  The caller (RuntimeHubService._recover_crashed_runs)
        marks each as failed with a crash-recovery error excerpt.
        """
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT run_id, event_id, session_id, status, worker_id,
                       created_at, started_at, finished_at, error, metadata_json
                FROM task_runs
                WHERE status IN ('running', 'waiting_permission')
                ORDER BY created_at ASC
                """,
            ).fetchall()
        return [
            {
                "run_id": r[0],
                "event_id": r[1],
                "session_id": r[2],
                "status": r[3],
                "worker_id": r[4],
                "created_at": r[5],
                "started_at": r[6],
                "finished_at": r[7],
                "error": r[8],
                "metadata": _loads(r[9], {}),
            }
            for r in rows
        ]

    def record_session_state(
        self,
        session_id,
        *,
        active=False,
        active_run_id="",
        active_status="",
        pending_count=0,
        metadata=None,
        clear_cancel=False,
    ):
        sid = str(session_id or "")
        if not sid:
            return {}
        # BEGIN IMMEDIATE wraps the read-modify-write so that a concurrent
        # request_cancel or clear_cancel_request cannot interleave between
        # our SELECT (cancel flags) and our INSERT OR REPLACE.  In WAL mode
        # BEGIN IMMEDIATE is the correct choice: it acquires the write lock
        # up front without blocking readers.
        conn = self._connect_immediate()
        try:
            conn.execute("BEGIN IMMEDIATE")
            row_data = conn.execute(
                """
                SELECT cancel_requested, cancel_drop_pending, cancel_reason,
                       cancel_requested_at
                FROM session_state WHERE session_id = ?
                """,
                (sid,),
            ).fetchone()
            if row_data:
                cancel_requested = bool(row_data[0])
                cancel_drop_pending = bool(row_data[1])
                cancel_reason = str(row_data[2] or "")
                cancel_requested_at = float(row_data[3] or 0)
            else:
                cancel_requested = False
                cancel_drop_pending = False
                cancel_reason = ""
                cancel_requested_at = 0
            if clear_cancel:
                cancel_requested = False
                cancel_drop_pending = False
                cancel_reason = ""
                cancel_requested_at = 0
            row = {
                "session_id": sid,
                "active": bool(active),
                "active_run_id": str(active_run_id or ""),
                "active_status": str(active_status or ""),
                "pending_count": int(pending_count or 0),
                "cancel_requested": cancel_requested,
                "cancel_drop_pending": cancel_drop_pending,
                "cancel_reason": cancel_reason,
                "cancel_requested_at": cancel_requested_at,
                "metadata": metadata or {},
                "updated_at": time.time(),
            }
            conn.execute(
                """
                INSERT OR REPLACE INTO session_state
                (session_id, active, active_run_id, active_status, pending_count,
                 cancel_requested, cancel_drop_pending, cancel_reason,
                 cancel_requested_at, metadata_json, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    row["session_id"],
                    1 if row["active"] else 0,
                    row["active_run_id"],
                    row["active_status"],
                    row["pending_count"],
                    1 if row["cancel_requested"] else 0,
                    1 if row["cancel_drop_pending"] else 0,
                    row["cancel_reason"],
                    row["cancel_requested_at"],
                    json.dumps(row["metadata"], ensure_ascii=False, sort_keys=True),
                    row["updated_at"],
                ),
            )
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()
        return row

    def get_session_state(self, session_id):
        sid = str(session_id or "")
        if not sid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT session_id, active, active_run_id, active_status, pending_count,
                       cancel_requested, cancel_drop_pending, cancel_reason,
                       cancel_requested_at, metadata_json, updated_at
                FROM session_state WHERE session_id = ?
                """,
                (sid,),
            ).fetchone()
        if not row:
            return None
        return {
            "session_id": row[0],
            "active": bool(row[1]),
            "active_run_id": row[2],
            "active_status": row[3],
            "pending_count": int(row[4] or 0),
            "cancel_requested": bool(row[5]),
            "cancel_drop_pending": bool(row[6]),
            "cancel_reason": row[7],
            "cancel_requested_at": float(row[8] or 0),
            "metadata": _loads(row[9], {}),
            "updated_at": float(row[10] or 0),
        }

    def request_cancel(self, session_id, *, drop_pending=False, reason="", source=""):
        sid = str(session_id or "")
        if not sid:
            return {}
        created = time.time()
        request_id = f"cancel_{int(created * 1000)}_{abs(hash((sid, created))) & 0xfffffff:x}"
        reason = str(reason or "cancelled by runtime")
        source = str(source or "runtime")
        # BEGIN IMMEDIATE prevents a concurrent record_session_state from
        # overwriting our cancel_requested flag with a stale read.  The read
        # (current session_state) and both writes (cancel_requests row +
        # session_state update) are atomic within this transaction.
        conn = self._connect_immediate()
        try:
            conn.execute("BEGIN IMMEDIATE")
            current_row = conn.execute(
                """
                SELECT active, active_run_id, active_status, pending_count, metadata_json
                FROM session_state WHERE session_id = ?
                """,
                (sid,),
            ).fetchone()
            if current_row:
                s_active = bool(current_row[0])
                s_active_run_id = str(current_row[1] or "")
                s_active_status = str(current_row[2] or "")
                s_pending = int(current_row[3] or 0)
                s_metadata = current_row[4] or "{}"
            else:
                s_active = False
                s_active_run_id = ""
                s_active_status = ""
                s_pending = 0
                s_metadata = "{}"
            conn.execute(
                """
                INSERT INTO cancel_requests
                (request_id, session_id, drop_pending, reason, source, created_at, consumed_at)
                VALUES (?, ?, ?, ?, ?, ?, 0)
                """,
                (request_id, sid, 1 if drop_pending else 0, reason, source, created),
            )
            conn.execute(
                """
                INSERT OR REPLACE INTO session_state
                (session_id, active, active_run_id, active_status, pending_count,
                 cancel_requested, cancel_drop_pending, cancel_reason,
                 cancel_requested_at, metadata_json, updated_at)
                VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                """,
                (
                    sid,
                    1 if s_active else 0,
                    s_active_run_id,
                    s_active_status,
                    s_pending,
                    1 if drop_pending else 0,
                    reason,
                    created,
                    s_metadata,
                    created,
                ),
            )
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()
        data = self.get_session_state(sid) or {}
        data["request_id"] = request_id
        return data

    def get_cancel_request(self, session_id):
        sid = str(session_id or "")
        if not sid:
            return None
        with self._connect() as conn:
            row = conn.execute(
                """
                SELECT request_id, session_id, drop_pending, reason, source, created_at
                FROM cancel_requests
                WHERE session_id = ? AND consumed_at = 0
                ORDER BY created_at ASC
                LIMIT 1
                """,
                (sid,),
            ).fetchone()
        if not row:
            return None
        return {
            "request_id": row[0],
            "session_id": row[1],
            "drop_pending": bool(row[2]),
            "reason": row[3],
            "source": row[4],
            "created_at": float(row[5] or 0),
        }

    def clear_cancel_request(self, session_id, *, request_id=""):
        sid = str(session_id or "")
        now = time.time()
        # BEGIN IMMEDIATE: same TOCTOU fix as record_session_state and
        # request_cancel.  The read (current session_state) and writes
        # (cancel_requests UPDATE + session_state INSERT OR REPLACE) are
        # atomic.
        conn = self._connect_immediate()
        try:
            conn.execute("BEGIN IMMEDIATE")
            current_row = conn.execute(
                """
                SELECT active, active_run_id, active_status, pending_count, metadata_json
                FROM session_state WHERE session_id = ?
                """,
                (sid,),
            ).fetchone()
            if current_row:
                s_active = bool(current_row[0])
                s_active_run_id = str(current_row[1] or "")
                s_active_status = str(current_row[2] or "")
                s_pending = int(current_row[3] or 0)
                s_metadata = current_row[4] or "{}"
            else:
                s_active = False
                s_active_run_id = ""
                s_active_status = ""
                s_pending = 0
                s_metadata = "{}"
            if request_id:
                conn.execute(
                    "UPDATE cancel_requests SET consumed_at = ? WHERE request_id = ?",
                    (now, str(request_id)),
                )
            else:
                conn.execute(
                    "UPDATE cancel_requests SET consumed_at = ? WHERE session_id = ? AND consumed_at = 0",
                    (now, sid),
                )
            conn.execute(
                """
                INSERT OR REPLACE INTO session_state
                (session_id, active, active_run_id, active_status, pending_count,
                 cancel_requested, cancel_drop_pending, cancel_reason,
                 cancel_requested_at, metadata_json, updated_at)
                VALUES (?, ?, ?, ?, ?, 0, 0, '', 0, ?, ?)
                """,
                (
                    sid,
                    1 if s_active else 0,
                    s_active_run_id,
                    s_active_status,
                    s_pending,
                    s_metadata,
                    now,
                ),
            )
            conn.execute("COMMIT")
        except Exception:
            try:
                conn.execute("ROLLBACK")
            except Exception:
                pass
            raise
        finally:
            conn.close()


def _loads(text, fallback):
    try:
        return json.loads(text or "")
    except Exception:
        return fallback
