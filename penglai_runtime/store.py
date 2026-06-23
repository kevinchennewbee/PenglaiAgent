# -*- coding: utf-8 -*-
"""SQLite state store for the Penglai Runtime Hub."""

import json
import os
import sqlite3
import time


def default_store_path(root=None):
    base = root or os.path.dirname(os.path.dirname(os.path.realpath(__file__)))
    path = os.path.join(base, "temp", "runtime_hub.sqlite3")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


class RuntimeStateStore:
    """Small durable store for runtime events and task runs."""

    def __init__(self, path=None):
        self.path = path or default_store_path()
        os.makedirs(os.path.dirname(os.path.realpath(self.path)), exist_ok=True)
        self._init_db()

    def _connect(self):
        conn = sqlite3.connect(self.path, timeout=30)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA busy_timeout=30000")
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

    def _ensure_column(self, conn, table, name, definition):
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        if name in {row[1] for row in rows}:
            return
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

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
                    event.text,
                    json.dumps(event.metadata or {}, ensure_ascii=False, sort_keys=True),
                    time.time(),
                ),
            )

    def record_run(self, task_run):
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
                    task_run.result_text or "",
                    task_run.error or "",
                    json.dumps(permission_json, ensure_ascii=False, sort_keys=True),
                    json.dumps(list(task_run.artifacts or ()), ensure_ascii=False, sort_keys=True),
                    task_run.log_excerpt or "",
                    json.dumps(task_run.metadata or {}, ensure_ascii=False, sort_keys=True),
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


def _loads(text, fallback):
    try:
        return json.loads(text or "")
    except Exception:
        return fallback
