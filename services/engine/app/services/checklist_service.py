from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pandas as pd
import pytz

from app.core.constants import (
    CAL_READY_HOURS,
    CAL_WARN_HOURS,
    MACRO_READY_HOURS,
    MACRO_WARN_HOURS,
    PRICE_READY_HOURS,
    PRICE_WARN_HOURS,
)
from app.services.autofetch_service import compute_schedule_snapshot
from app.services.metrics_service import age_hours_from_iso


def _state_from_age(age_h: float | None, ready_h: float, warn_h: float) -> str:
    if age_h is None:
        return "error"
    if age_h <= ready_h:
        return "ready"
    if age_h <= warn_h:
        return "warn"
    return "error"


def _is_fx_market_closed(now_utc: datetime) -> bool:
    # FX is typically closed from Friday 22:00 UTC through Sunday 22:00 UTC.
    weekday = now_utc.weekday()  # Monday=0 ... Sunday=6
    hour = now_utc.hour
    if weekday == 5:
        return True
    if weekday == 6 and hour < 22:
        return True
    if weekday == 4 and hour >= 22:
        return True
    return False


def _state_from_price_age(age_h: float | None, now_utc: datetime) -> tuple[str, str]:
    base_state = _state_from_age(age_h, PRICE_READY_HOURS, PRICE_WARN_HOURS)
    if base_state != "error":
        return base_state, ""
    if age_h is None:
        return "error", ""
    if _is_fx_market_closed(now_utc) and age_h <= 72.0:
        return "warn", " Market close window detected; stale H1 age is tolerated until reopen."
    return "error", ""


def _state_factor(state: str) -> float:
    token = str(state).lower()
    if token == "ready":
        return 1.0
    if token == "warn":
        return 0.5
    return 0.0


def _overall_state(states: list[str]) -> str:
    tokens = [str(x).lower() for x in states]
    if any(x == "error" for x in tokens):
        return "error"
    if any(x == "warn" for x in tokens):
        return "warn"
    return "ready"


def _fmt_age(age_h: float | None) -> str:
    if age_h is None:
        return "n/a"
    total_minutes = max(0, int(round(float(age_h) * 60.0)))
    hours = total_minutes // 60
    mins = total_minutes % 60
    hour_label = "hour" if hours == 1 else "hours"
    minute_label = "minute" if mins == 1 else "minutes"
    return f"{hours} {hour_label} {mins} {minute_label}"


def _to_local_display(utc_iso: str, tz_name: str) -> str:
    token = str(utc_iso or "").strip()
    if not token:
        return ""
    try:
        ts = pd.to_datetime(token, utc=True)
        if pd.isna(ts):
            return ""
        tz_obj = pytz.timezone(str(tz_name or "UTC"))
        return ts.tz_convert(tz_obj).strftime("%Y-%m-%d %H:%M")
    except Exception:
        return ""


def _market_session_snapshot(ui_timezone: str) -> dict[str, Any]:
    try:
        tz_obj = pytz.timezone(str(ui_timezone or "UTC"))
    except pytz.UnknownTimeZoneError:
        tz_obj = pytz.UTC

    now_utc = datetime.now(timezone.utc)
    now_local = now_utc.astimezone(tz_obj)
    hour_utc = now_utc.hour

    sessions = {
        "Sydney": (21, 6),
        "Tokyo": (0, 9),
        "London": (7, 16),
        "New York": (12, 21),
    }

    active: list[str] = []
    for name, (start, end) in sessions.items():
        if start <= end:
            is_active = start <= hour_utc < end
        else:
            is_active = hour_utc >= start or hour_utc < end
        if is_active:
            active.append(name)

    return {
        "local_time": now_local.strftime("%Y-%m-%d %H:%M"),
        "utc_time": now_utc.strftime("%Y-%m-%d %H:%M"),
        "timezone": str(getattr(tz_obj, "zone", "UTC")),
        "active_sessions": active,
        "label": " / ".join(active) if active else "No major session overlap",
    }


def build_checklist_overview(
    *,
    price_meta: dict | None,
    price_symbol_meta: dict | None,
    calendar_meta: dict | None,
    macro_policy_rows: list[dict],
    macro_inflation_rows: list[dict],
    macro_enabled: bool,
    ui_timezone: str,
    auto_fetch_config: dict | None,
    active_symbol: str = "",
) -> dict[str, Any]:
    sections: list[dict] = []
    timeline: list[dict] = []
    now_utc = datetime.now(timezone.utc)

    price_age = age_hours_from_iso(str((price_meta or {}).get("max_time_utc", "")))
    price_state = "error"
    price_state_note = ""
    if price_meta:
        price_state, price_state_note = _state_from_price_age(price_age, now_utc)
    price_detail = "Not loaded."
    if price_meta:
        aggregate_detail = f"Aggregate latest local candle age: {_fmt_age(price_age)}; gaps={int(price_meta.get('gap_count', 0))}."
        symbol_detail = ""
        token = str(active_symbol or "").strip().upper()
        if price_symbol_meta and token:
            symbol_age = age_hours_from_iso(str(price_symbol_meta.get("max_time_utc", "")))
            symbol_detail = (
                f" Active {token} latest local candle age: {_fmt_age(symbol_age)};"
                f" gaps={int(price_symbol_meta.get('gap_count', 0))}."
            )
        elif token:
            symbol_detail = f" Active {token}: no rows in current price dataset."
        price_detail = f"{aggregate_detail}{symbol_detail}{price_state_note}"
        timeline.append(
            {
                "section": "H1 Candle Data",
                "state": price_state,
                "timestamp_utc": str(price_meta.get("max_time_utc", "")),
                "timestamp_local": _to_local_display(str(price_meta.get("max_time_utc", "")), ui_timezone),
                "age_text": _fmt_age(price_age),
            }
        )
    sections.append({"name": "H1 Candle Data", "state": price_state, "score": 40.0 * _state_factor(price_state), "detail": price_detail})

    cal_age = age_hours_from_iso(str((calendar_meta or {}).get("loaded_at_utc", "")))
    cal_state = _state_from_age(cal_age, CAL_READY_HOURS, CAL_WARN_HOURS) if calendar_meta else "error"
    cal_detail = "Not loaded."
    if calendar_meta:
        cal_detail = f"Upload age: {_fmt_age(cal_age)}; rows={int(calendar_meta.get('rows_loaded', 0))}."
        timeline.append(
            {
                "section": "Economic Calendar Data",
                "state": cal_state,
                "timestamp_utc": str(calendar_meta.get("loaded_at_utc", "")),
                "timestamp_local": _to_local_display(str(calendar_meta.get("loaded_at_utc", "")), ui_timezone),
                "age_text": _fmt_age(cal_age),
            }
        )
    sections.append({"name": "Economic Calendar Data", "state": cal_state, "score": 25.0 * _state_factor(cal_state), "detail": cal_detail})

    macro_state = "error"
    macro_detail = "Disabled (missing FRED key)." if not macro_enabled else "No valid macro observations."
    freshest_macro_utc = ""
    if macro_enabled:
        rows = [r for r in list(macro_policy_rows) + list(macro_inflation_rows) if str(r.get("status", "")).lower() == "ok"]
        if rows:
            freshest_age: float | None = None
            freshest_dt: pd.Timestamp | None = None
            for row in rows:
                as_of = str(row.get("as_of_utc", ""))
                age_h = age_hours_from_iso(as_of)
                if age_h is None:
                    continue
                if freshest_age is None or age_h < freshest_age:
                    freshest_age = age_h
                    try:
                        freshest_dt = pd.to_datetime(as_of, utc=True)
                    except Exception:
                        freshest_dt = None
            macro_state = _state_from_age(freshest_age, MACRO_READY_HOURS, MACRO_WARN_HOURS)
            errors = int(sum(1 for r in list(macro_policy_rows) + list(macro_inflation_rows) if str(r.get("status", "")).lower() != "ok"))
            macro_detail = f"Freshest macro age: {_fmt_age(freshest_age)}; failing series={errors}."
            if freshest_dt is not None:
                freshest_macro_utc = freshest_dt.isoformat()
                timeline.append(
                    {
                        "section": "FRED Data",
                        "state": macro_state,
                        "timestamp_utc": freshest_macro_utc,
                        "timestamp_local": _to_local_display(freshest_macro_utc, ui_timezone),
                        "age_text": _fmt_age(freshest_age),
                    }
                )
    sections.append({"name": "FRED Data", "state": macro_state, "score": 25.0 * _state_factor(macro_state), "detail": macro_detail})

    tz_state = "ready"
    tz_detail = "Applied timezone settings are in sync."
    sections.append({"name": "Time Conversion", "state": tz_state, "score": 10.0 * _state_factor(tz_state), "detail": tz_detail})

    auto_cfg = dict(auto_fetch_config or {})
    interval_hours = max(1, int(auto_cfg.get("interval_hours", 1)))
    last_sync_utc = str(auto_cfg.get("last_sync_utc", "") or "")
    schedule = compute_schedule_snapshot(ui_timezone, interval_hours, last_sync_utc)

    auto_fetch_status = {
        "enabled": bool(auto_cfg.get("enabled", True)),
        "mt5_folder": str(auto_cfg.get("mt5_folder", "") or ""),
        "price_pattern": str(auto_cfg.get("price_pattern", "*h1*.csv") or "*h1*.csv"),
        "calendar_pattern": str(auto_cfg.get("calendar_pattern", "economic_calendar.csv") or "economic_calendar.csv"),
        "interval_hours": interval_hours,
        "last_sync_utc": last_sync_utc,
        "last_sync_local": _to_local_display(last_sync_utc, ui_timezone),
        "next_update_local": schedule.get("next_update_local", ""),
        "due": bool(schedule.get("due", False)),
        "price_status": str(auto_cfg.get("last_price_status", "") or ""),
        "calendar_status": str(auto_cfg.get("last_calendar_status", "") or ""),
        "last_price_file": str(auto_cfg.get("last_price_file", "") or ""),
        "last_calendar_file": str(auto_cfg.get("last_calendar_file", "") or ""),
    }

    actions: list[dict] = []
    if price_state == "error":
        actions.append({"done": False, "text": "Upload Price Candle Data."})
    if cal_state == "error":
        actions.append({"done": False, "text": "Upload Economic Calendar Data."})
    if macro_enabled and macro_state in {"warn", "error"}:
        actions.append({"done": False, "text": "Refresh FRED Data and review failing series."})
    if not macro_enabled:
        actions.append({"done": False, "text": "Add FRED key to enable macro modules."})
    if not actions:
        actions.append({"done": True, "text": "All checklist sections are healthy."})

    total_score = round(sum(float(s["score"]) for s in sections), 1)
    overall = _overall_state([str(s["state"]) for s in sections])
    return {
        "overall_state": overall,
        "total_score": total_score,
        "active_symbol": str(active_symbol or "").strip().upper(),
        "sections": sections,
        "action_queue": actions,
        "freshness_timeline": timeline,
        "market_session": _market_session_snapshot(ui_timezone),
        "auto_fetch_status": auto_fetch_status,
    }