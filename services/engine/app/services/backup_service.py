from __future__ import annotations

import shutil
from datetime import datetime, timezone
from pathlib import Path


def _utc_now_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def run_backup(data_root: Path, keep_last: int = 14) -> Path:
    backups_root = data_root / "backups"
    backups_root.mkdir(parents=True, exist_ok=True)
    stamp = _utc_now_stamp()
    out_dir = backups_root / f"snapshot-{stamp}"
    out_dir.mkdir(parents=True, exist_ok=True)

    for name in ["db", "parquet"]:
        src = data_root / name
        if src.exists() and src.is_dir():
            shutil.copytree(src, out_dir / name, dirs_exist_ok=True)

    _prune_backups(backups_root, keep_last=keep_last)
    return out_dir


def _prune_backups(backups_root: Path, keep_last: int = 14) -> None:
    dirs = [p for p in backups_root.iterdir() if p.is_dir() and p.name.startswith("snapshot-")]
    dirs.sort(key=lambda p: p.name, reverse=True)
    for old in dirs[keep_last:]:
        shutil.rmtree(old, ignore_errors=True)


def should_run_backup(last_backup_utc: str, now_utc: datetime | None = None) -> bool:
    now = now_utc or datetime.now(timezone.utc)
    if not str(last_backup_utc or "").strip():
        return True
    try:
        from pandas import to_datetime

        ts = to_datetime(last_backup_utc, utc=True)
        if ts is None:
            return True
        delta_hours = (now - ts.to_pydatetime()).total_seconds() / 3600.0
        return delta_hours >= 24.0
    except Exception:
        return True
