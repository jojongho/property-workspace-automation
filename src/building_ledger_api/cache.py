from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path


class LedgerCache:
    def __init__(self, db_path: Path) -> None:
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self.db_path)

    def _init_db(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS ledger_cache (
                    pnu TEXT PRIMARY KEY,
                    payload_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL
                )
                """
            )
            conn.commit()

    def get(self, pnu: str, ttl_days: int) -> dict | None:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT payload_json, fetched_at FROM ledger_cache WHERE pnu = ?",
                (pnu,),
            ).fetchone()

        if not row:
            return None

        payload_json, fetched_at = row
        fetched_dt = datetime.fromisoformat(fetched_at)
        now = datetime.now(timezone.utc)
        if fetched_dt.tzinfo is None:
            fetched_dt = fetched_dt.replace(tzinfo=timezone.utc)

        if fetched_dt + timedelta(days=ttl_days) < now:
            return None

        return json.loads(payload_json)

    def set(self, pnu: str, payload: dict) -> None:
        now_iso = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            conn.execute(
                """
                INSERT INTO ledger_cache (pnu, payload_json, fetched_at)
                VALUES (?, ?, ?)
                ON CONFLICT(pnu) DO UPDATE SET
                    payload_json = excluded.payload_json,
                    fetched_at = excluded.fetched_at
                """,
                (pnu, json.dumps(payload, ensure_ascii=False), now_iso),
            )
            conn.commit()
