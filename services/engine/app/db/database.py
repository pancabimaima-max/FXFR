from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, db_path: Path):
        self.db_path = db_path
        self.db_path.parent.mkdir(parents=True, exist_ok=True)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        conn = sqlite3.connect(str(self.db_path))
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    def initialize(self) -> None:
        with self.connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS app_settings (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at_utc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS ingestion_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL,
                    source_name TEXT NOT NULL,
                    rows_loaded INTEGER NOT NULL,
                    loaded_at_utc TEXT NOT NULL,
                    meta_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS macro_snapshot (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    kind TEXT NOT NULL,
                    currency TEXT NOT NULL,
                    series_id TEXT NOT NULL,
                    value REAL,
                    aux_json TEXT NOT NULL,
                    as_of_utc TEXT,
                    status TEXT NOT NULL,
                    error_message TEXT NOT NULL,
                    refreshed_at_utc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS swap_config (
                    symbol TEXT PRIMARY KEY,
                    swap_drag_bps REAL NOT NULL,
                    updated_at_utc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS metric_promotions (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    metric_key TEXT NOT NULL,
                    version_tag TEXT NOT NULL,
                    promoted_at_utc TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp_utc TEXT NOT NULL,
                    level TEXT NOT NULL,
                    message TEXT NOT NULL,
                    context_json TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS migration_journal (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    version_tag TEXT NOT NULL,
                    applied_at_utc TEXT NOT NULL,
                    note TEXT NOT NULL
                );
                """
            )
            current = conn.execute("SELECT COUNT(*) AS c FROM migration_journal").fetchone()
            if current is not None and int(current["c"]) == 0:
                conn.execute(
                    """
                    INSERT INTO migration_journal(version_tag, applied_at_utc, note)
                    VALUES (?, ?, ?)
                    """,
                    ("1.0.0", _utc_now_iso(), "Initial schema bootstrap"),
                )

    def set_setting(self, key: str, value: dict | str | int | float | bool | None) -> None:
        payload = json.dumps(value)
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO app_settings(key, value_json, updated_at_utc)
                VALUES (?, ?, ?)
                ON CONFLICT(key) DO UPDATE SET
                    value_json = excluded.value_json,
                    updated_at_utc = excluded.updated_at_utc
                """,
                (key, payload, now),
            )

    def get_setting(self, key: str, default=None):
        with self.connect() as conn:
            row = conn.execute("SELECT value_json FROM app_settings WHERE key = ?", (key,)).fetchone()
        if row is None:
            return default
        try:
            return json.loads(str(row["value_json"]))
        except json.JSONDecodeError:
            return default

    def append_ingestion(self, kind: str, source_name: str, rows_loaded: int, meta: dict) -> None:
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO ingestion_runs(kind, source_name, rows_loaded, loaded_at_utc, meta_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (kind, source_name, int(rows_loaded), now, json.dumps(meta)),
            )

    def latest_ingestion(self, kind: str) -> dict | None:
        with self.connect() as conn:
            row = conn.execute(
                """
                SELECT kind, source_name, rows_loaded, loaded_at_utc, meta_json
                FROM ingestion_runs
                WHERE kind = ?
                ORDER BY id DESC
                LIMIT 1
                """,
                (kind,),
            ).fetchone()
        if row is None:
            return None
        try:
            meta = json.loads(str(row["meta_json"]))
        except json.JSONDecodeError:
            meta = {}
        return {
            "kind": row["kind"],
            "source_name": row["source_name"],
            "rows_loaded": int(row["rows_loaded"]),
            "loaded_at_utc": row["loaded_at_utc"],
            "meta": meta,
        }

    def replace_macro_snapshot(self, kind: str, rows: list[dict]) -> None:
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute("DELETE FROM macro_snapshot WHERE kind = ?", (kind,))
            for row in rows:
                conn.execute(
                    """
                    INSERT INTO macro_snapshot(
                        kind, currency, series_id, value, aux_json, as_of_utc,
                        status, error_message, refreshed_at_utc
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        kind,
                        str(row.get("currency", "")),
                        str(row.get("series_id", "")),
                        row.get("value"),
                        json.dumps(row.get("aux", {})),
                        row.get("as_of_utc"),
                        str(row.get("status", "error")),
                        str(row.get("error_message", "")),
                        now,
                    ),
                )

    def get_macro_snapshot(self, kind: str) -> list[dict]:
        with self.connect() as conn:
            rows = conn.execute(
                """
                SELECT currency, series_id, value, aux_json, as_of_utc, status, error_message, refreshed_at_utc
                FROM macro_snapshot
                WHERE kind = ?
                ORDER BY currency ASC
                """,
                (kind,),
            ).fetchall()
        out: list[dict] = []
        for row in rows:
            try:
                aux = json.loads(str(row["aux_json"]))
            except json.JSONDecodeError:
                aux = {}
            out.append(
                {
                    "currency": row["currency"],
                    "series_id": row["series_id"],
                    "value": row["value"],
                    "aux": aux,
                    "as_of_utc": row["as_of_utc"],
                    "status": row["status"],
                    "error_message": row["error_message"],
                    "refreshed_at_utc": row["refreshed_at_utc"],
                }
            )
        return out

    def set_swap_drag_bps(self, symbol: str, swap_drag_bps: float) -> None:
        now = _utc_now_iso()
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO swap_config(symbol, swap_drag_bps, updated_at_utc)
                VALUES (?, ?, ?)
                ON CONFLICT(symbol) DO UPDATE SET
                    swap_drag_bps = excluded.swap_drag_bps,
                    updated_at_utc = excluded.updated_at_utc
                """,
                (symbol.upper(), float(swap_drag_bps), now),
            )

    def get_swap_drag_bps_map(self) -> dict[str, float]:
        with self.connect() as conn:
            rows = conn.execute("SELECT symbol, swap_drag_bps FROM swap_config").fetchall()
        return {str(r["symbol"]): float(r["swap_drag_bps"]) for r in rows}

    def get_swap_config_rows(self, symbols: list[str] | None = None) -> list[dict]:
        with self.connect() as conn:
            if symbols:
                normalized = [str(sym or "").strip().upper() for sym in symbols if str(sym or "").strip()]
                if not normalized:
                    return []
                placeholders = ",".join("?" for _ in normalized)
                rows = conn.execute(
                    f"SELECT symbol, swap_drag_bps, updated_at_utc FROM swap_config WHERE symbol IN ({placeholders})",
                    tuple(normalized),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT symbol, swap_drag_bps, updated_at_utc FROM swap_config ORDER BY symbol ASC"
                ).fetchall()
        return [
            {
                "symbol": str(r["symbol"]),
                "swap_drag_bps": float(r["swap_drag_bps"]),
                "updated_at_utc": str(r["updated_at_utc"]),
            }
            for r in rows
        ]

    def add_metric_promotion(self, metric_key: str, version_tag: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO metric_promotions(metric_key, version_tag, promoted_at_utc)
                VALUES (?, ?, ?)
                """,
                (metric_key, version_tag, _utc_now_iso()),
            )

    def add_log(self, level: str, message: str, context: dict | None = None) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO logs(timestamp_utc, level, message, context_json)
                VALUES (?, ?, ?, ?)
                """,
                (_utc_now_iso(), str(level).upper(), message, json.dumps(context or {})),
            )

    def record_migration(self, version_tag: str, note: str) -> None:
        with self.connect() as conn:
            conn.execute(
                """
                INSERT INTO migration_journal(version_tag, applied_at_utc, note)
                VALUES (?, ?, ?)
                """,
                (version_tag, _utc_now_iso(), note),
            )

    def get_logs(self, levels: list[str], lookback_hours: int, limit: int = 1000) -> list[dict]:
        with self.connect() as conn:
            query = """
                SELECT timestamp_utc, level, message, context_json
                FROM logs
                WHERE timestamp_utc >= datetime('now', ?)
            """
            args: list = [f"-{int(lookback_hours)} hours"]
            if levels:
                tokens = ",".join("?" for _ in levels)
                query += f" AND level IN ({tokens})"
                args.extend([str(x).upper() for x in levels])
            query += " ORDER BY id DESC LIMIT ?"
            args.append(int(limit))
            rows = conn.execute(query, tuple(args)).fetchall()
        out: list[dict] = []
        for row in rows:
            try:
                context = json.loads(str(row["context_json"]))
            except json.JSONDecodeError:
                context = {}
            out.append(
                {
                    "timestamp_utc": row["timestamp_utc"],
                    "level": row["level"],
                    "message": row["message"],
                    "context": context,
                }
            )
        return out
