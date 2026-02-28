from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytz

from app.core.v1_decisions import AUTO_FETCH
from app.services.ingest_service import IngestError, ingest_calendar_file, ingest_price_csv


@dataclass
class AutoFetchConfig:
    enabled: bool
    mt5_folder: str
    price_pattern: str
    calendar_pattern: str
    interval_hours: int
    last_sync_utc: str
    last_price_status: str
    last_calendar_status: str
    last_price_file: str
    last_calendar_file: str


def load_autofetch_config(db) -> AutoFetchConfig:
    return AutoFetchConfig(
        enabled=bool(db.get_setting("auto_fetch_enabled", True)),
        mt5_folder=str(db.get_setting("mt5_folder", "") or ""),
        price_pattern=str(db.get_setting("auto_fetch_price_pattern", AUTO_FETCH["default_price_pattern"]) or AUTO_FETCH["default_price_pattern"]),
        calendar_pattern=str(db.get_setting("auto_fetch_calendar_pattern", AUTO_FETCH["default_calendar_pattern"]) or AUTO_FETCH["default_calendar_pattern"]),
        interval_hours=max(1, int(db.get_setting("auto_fetch_interval_hours", AUTO_FETCH["default_interval_hours"]))),
        last_sync_utc=str(db.get_setting("auto_fetch_last_sync_utc", "") or ""),
        last_price_status=str(db.get_setting("auto_fetch_last_price_status", "") or ""),
        last_calendar_status=str(db.get_setting("auto_fetch_last_calendar_status", "") or ""),
        last_price_file=str(db.get_setting("auto_fetch_last_price_file", "") or ""),
        last_calendar_file=str(db.get_setting("auto_fetch_last_calendar_file", "") or ""),
    )


def _validate_glob_pattern(pattern: str, label: str) -> tuple[bool, str]:
    value = str(pattern or "").strip()
    if not value:
        return False, f"{label} pattern is empty."
    if Path(value).is_absolute():
        return False, f"{label} pattern must be relative."
    normalized = value.replace("\\", "/")
    if ".." in normalized.split("/"):
        return False, f"{label} pattern cannot include '..'."
    if "**" in normalized:
        return False, f"{label} pattern cannot include recursive wildcard '**'."
    return True, ""


def find_latest_matching_file(base_dir: str, pattern: str) -> Path | None:
    base_path = Path(str(base_dir or "").strip())
    if not base_path.exists() or not base_path.is_dir():
        return None
    matches = [p for p in base_path.glob(str(pattern or "").strip()) if p.is_file()]
    if not matches:
        return None
    return max(matches, key=lambda p: p.stat().st_mtime)


def _latest_closed_candle_slot_with_delay(now_local: datetime, interval_hours: int, delay_minutes: int) -> datetime:
    step = max(1, int(interval_hours or 1))
    local = now_local.replace(second=0, microsecond=0)
    day_start = local.replace(hour=0, minute=0, second=0, microsecond=0)
    hours_since_midnight = int((local - day_start).total_seconds() // 3600)
    aligned_hours = (hours_since_midnight // step) * step
    slot = day_start + timedelta(hours=aligned_hours, minutes=int(delay_minutes))
    if local < slot:
        slot -= timedelta(hours=step)
    return slot


def _parse_utc_iso(value: str) -> datetime | None:
    token = str(value or "").strip()
    if not token:
        return None
    try:
        ts = pd.to_datetime(token, utc=True)
        if pd.isna(ts):
            return None
        return ts.to_pydatetime()
    except Exception:
        return None


def compute_schedule_snapshot(ui_timezone: str, interval_hours: int, last_sync_utc: str) -> dict:
    tz_name = str(ui_timezone or "UTC")
    try:
        tz_obj = pytz.timezone(tz_name)
    except pytz.UnknownTimeZoneError:
        tz_obj = pytz.UTC

    now_local = datetime.now(tz_obj)
    slot_now = _latest_closed_candle_slot_with_delay(
        now_local=now_local,
        interval_hours=max(1, int(interval_hours or 1)),
        delay_minutes=int(AUTO_FETCH["delay_minutes"]),
    )

    last_sync_dt_utc = _parse_utc_iso(last_sync_utc)
    due = True
    if last_sync_dt_utc is not None:
        last_sync_local = last_sync_dt_utc.astimezone(tz_obj)
        due = last_sync_local < slot_now

    next_local = slot_now if due else slot_now + timedelta(hours=max(1, int(interval_hours or 1)))

    return {
        "now_local": now_local.strftime("%Y-%m-%d %H:%M"),
        "next_update_local": next_local.strftime("%Y-%m-%d %H:%M"),
        "due": bool(due),
    }


def apply_and_sync(
    *,
    db,
    settings,
    state_service,
    logger_service,
    mt5_folder: str,
    enabled: bool,
    price_pattern: str,
    calendar_pattern: str,
    interval_hours: int,
    section: str,
) -> dict:
    section_norm = str(section or "full").strip().lower()
    if section_norm not in {"full", "price", "calendar"}:
        section_norm = "full"

    interval = max(1, int(interval_hours or AUTO_FETCH["default_interval_hours"]))
    price_pat = str(price_pattern or AUTO_FETCH["default_price_pattern"]).strip() or AUTO_FETCH["default_price_pattern"]
    cal_pat = str(calendar_pattern or AUTO_FETCH["default_calendar_pattern"]).strip() or AUTO_FETCH["default_calendar_pattern"]

    folder = str(mt5_folder or "").strip()
    if folder:
        state_service.set_mt5_folder(folder)
    runtime = state_service.load_runtime_state()
    folder = str(runtime.mt5_folder or "").strip()

    db.set_setting("auto_fetch_enabled", bool(enabled))
    db.set_setting("auto_fetch_price_pattern", price_pat)
    db.set_setting("auto_fetch_calendar_pattern", cal_pat)
    db.set_setting("auto_fetch_interval_hours", int(interval))

    price_status = "Skipped"
    cal_status = "Skipped"
    price_rows = 0
    cal_rows = 0
    price_file = ""
    cal_file = ""

    if not enabled:
        price_status = "Disabled"
        cal_status = "Disabled"
    elif not folder:
        price_status = "Skipped: MT5 folder is empty"
        cal_status = "Skipped: MT5 folder is empty"
    else:
        base_path = Path(folder)
        if not base_path.exists() or not base_path.is_dir():
            price_status = "Skipped: MT5 folder is invalid"
            cal_status = "Skipped: MT5 folder is invalid"
        else:
            if section_norm in {"full", "price"}:
                ok, msg = _validate_glob_pattern(price_pat, "Price")
                if not ok:
                    price_status = f"Skipped: {msg}"
                else:
                    p = find_latest_matching_file(folder, price_pat)
                    if p is None:
                        price_status = "No matching price file"
                    else:
                        price_file = p.name
                        try:
                            meta = ingest_price_csv(
                                raw_bytes=p.read_bytes(),
                                source_name=p.name,
                                source_timezone=runtime.server_timezone,
                                parquet_dir=settings.parquet_dir,
                            )
                            db.append_ingestion("price", p.name, int(meta["rows_loaded"]), meta)
                            db.set_setting("latest_price_meta", meta)
                            existing_top_pairs = db.get_setting("top_pairs", [])
                            if not existing_top_pairs:
                                db.set_setting("top_pairs", list(meta.get("symbols", []))[:10])
                            price_rows = int(meta.get("rows_loaded", 0))
                            price_status = f"Loaded {price_rows} rows from {p.name}"
                            logger_service.write("INFO", "Auto-fetch loaded Price Candle Data.", {"rows_loaded": price_rows, "source": p.name})
                        except (IngestError, OSError, ValueError, TypeError) as exc:
                            price_status = f"Error: {exc}"
                            logger_service.write("ERROR", "Auto-fetch price sync failed.", {"error": str(exc), "source": p.name})

            if section_norm in {"full", "calendar"}:
                ok, msg = _validate_glob_pattern(cal_pat, "Calendar")
                if not ok:
                    cal_status = f"Skipped: {msg}"
                else:
                    p = find_latest_matching_file(folder, cal_pat)
                    if p is None:
                        cal_status = "No matching calendar file"
                    else:
                        cal_file = p.name
                        try:
                            meta = ingest_calendar_file(
                                raw_bytes=p.read_bytes(),
                                source_name=p.name,
                                source_timezone=runtime.server_timezone,
                                parquet_dir=settings.parquet_dir,
                            )
                            db.append_ingestion("calendar", p.name, int(meta["rows_loaded"]), meta)
                            db.set_setting("latest_calendar_meta", meta)
                            cal_rows = int(meta.get("rows_loaded", 0))
                            cal_status = f"Loaded {cal_rows} events from {p.name}"
                            logger_service.write("INFO", "Auto-fetch loaded Economic Calendar Data.", {"rows_loaded": cal_rows, "source": p.name})
                        except (IngestError, OSError, ValueError, TypeError) as exc:
                            cal_status = f"Error: {exc}"
                            logger_service.write("ERROR", "Auto-fetch calendar sync failed.", {"error": str(exc), "source": p.name})

    synced_utc = datetime.now(timezone.utc).isoformat(timespec="seconds")
    db.set_setting("auto_fetch_last_sync_utc", synced_utc)
    db.set_setting("auto_fetch_last_price_status", price_status)
    db.set_setting("auto_fetch_last_calendar_status", cal_status)
    db.set_setting("auto_fetch_last_price_file", price_file)
    db.set_setting("auto_fetch_last_calendar_file", cal_file)

    schedule = compute_schedule_snapshot(runtime.display_timezone, interval, synced_utc)

    return {
        "saved": True,
        "enabled": bool(enabled),
        "section": section_norm,
        "price": {"status": price_status, "rows_loaded": price_rows, "source_file": price_file},
        "calendar": {"status": cal_status, "rows_loaded": cal_rows, "source_file": cal_file},
        "last_sync_utc": synced_utc,
        "next_update_local": schedule["next_update_local"],
        "due": bool(schedule["due"]),
    }