from __future__ import annotations

import asyncio
import os
import platform
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytz
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile

from app.api.helpers import envelope
from app.core.constants import (
    API_PREFIX,
    APP_NAME,
    APP_VERSION,
    AUTO_FETCH_GAP_WARN_COUNT,
    DISPLAY_TZ_DEFAULT,
    SERVER_TZ_DEFAULT,
    STORAGE_TZ,
)
from app.core.security import enforce_session_token
from app.schemas.requests import (
    AutoFetchApplyRequest,
    PromoteMetricRequest,
    RuntimeConfigApplyRequest,
    SwapConfigRequest,
    TimezoneApplyRequest,
    WizardSetupRequest,
)
from app.services.autofetch_service import apply_and_sync as autofetch_apply_and_sync
from app.services.autofetch_service import load_autofetch_config
from app.services.checklist_service import build_checklist_overview
from app.services.fred_service import FredService
from app.services.ingest_service import IngestError, ingest_calendar_file, ingest_price_csv
from app.services.metrics_service import (
    adr20_map,
    atr14_h1_map,
    compute_pair_differentials,
    pip_value,
)
from app.workers.job_manager import JobCancelledError

router = APIRouter(prefix=API_PREFIX)

_LOG_FILE_LINE = re.compile(r"^(?P<ts>[^|]+)\|\s*(?P<level>[A-Z]+)\s*\|\s*(?P<message>.*)$")
_PAIR_RE = re.compile(r"^[A-Z]{6}$")
_MAJOR_USD_PAIRS = ["EURUSD", "GBPUSD", "AUDUSD", "NZDUSD", "USDCAD", "USDCHF", "USDJPY"]
_STRENGTH_MAJOR_WATCHLIST = ["EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "USD"]


def _must_auth(request: Request) -> None:
    enforce_session_token(request)


def _service(request: Request):
    return request.app.state.services


def _load_price_df(parquet_path: Path) -> pd.DataFrame:
    if not parquet_path.exists():
        return pd.DataFrame()
    try:
        return pd.read_parquet(parquet_path)
    except Exception:
        return pd.DataFrame()


def _load_calendar_df(parquet_path: Path) -> pd.DataFrame:
    if not parquet_path.exists():
        return pd.DataFrame()
    try:
        return pd.read_parquet(parquet_path)
    except Exception:
        return pd.DataFrame()


def _event_payload(event_name: str, payload: dict | None) -> dict:
    raw = dict(payload or {})

    topic = "system"
    kind = event_name
    if event_name.startswith("job."):
        topic = "jobs"
        kind = "job.update"
    elif event_name == "data.updated":
        topic = "data"
        kind = "dataset.updated"
    elif event_name.startswith("alerts."):
        topic = "alerts"
        kind = event_name

    return {
        "topic": topic,
        "kind": kind,
        "event_version": "1",
        "data": raw,
    }


def _emit_event(request: Request, event_name: str, payload: dict) -> None:
    loop = getattr(request.app.state, "event_loop", None)
    bus = getattr(request.app.state, "event_bus", None)
    if loop is None or bus is None:
        return
    try:
        normalized_payload = _event_payload(event_name, payload)
        future = asyncio.run_coroutine_threadsafe(bus.broadcast(event_name, normalized_payload), loop)
        future.result(timeout=2)
    except Exception:
        pass

def _parse_watchlist_csv(value: str) -> set[str]:
    tokens = [x.strip().upper() for x in str(value or "").split(",") if x.strip()]
    return {x for x in tokens if len(x) >= 6}


def _parse_symbols_csv(value: str) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for raw in str(value or "").split(","):
        token = raw.strip().upper()
        if len(token) < 6 or token in seen:
            continue
        seen.add(token)
        out.append(token)
    return out



def _release_manifest_url(base_url: str, channel: str) -> str:
    token = str(channel or "stable").strip().lower()
    if token not in {"stable", "beta"}:
        token = "stable"
    root = str(base_url or "").strip().rstrip("/")
    if not root:
        return ""
    return f"{root}/latest/download/latest-{token}.json"




def _split_pair_token(value: str | None) -> tuple[str, str] | None:
    token = str(value or "").strip().upper()
    if not _PAIR_RE.match(token):
        return None
    return token[:3], token[3:]


def _policy_pair_available(symbol: str, policy_details: dict[str, dict]) -> bool:
    pair = _split_pair_token(symbol)
    if pair is None:
        return False
    base, quote = pair
    base_row = policy_details.get(base) or {}
    quote_row = policy_details.get(quote) or {}
    return (
        str(base_row.get("status", "error")) == "ok"
        and str(quote_row.get("status", "error")) == "ok"
        and base_row.get("value") is not None
        and quote_row.get("value") is not None
    )


def _resolve_active_pair(
    pair_query: str | None,
    base: str,
    quote: str,
    policy_details: dict[str, dict],
) -> tuple[str, str]:
    pair_token = str(pair_query or "").strip().upper()
    if _split_pair_token(pair_token) is not None:
        return pair_token, "query"

    base_ccy = str(base or "").strip().upper()
    quote_ccy = str(quote or "").strip().upper()
    if len(base_ccy) == 3 and len(quote_ccy) == 3 and base_ccy.isalpha() and quote_ccy.isalpha():
        return f"{base_ccy}{quote_ccy}", "base_quote"

    for candidate in _MAJOR_USD_PAIRS:
        if _policy_pair_available(candidate, policy_details):
            return candidate, "fallback"

    return _MAJOR_USD_PAIRS[0], "fallback"


def _effective_as_of(base_as_of: str, quote_as_of: str) -> str:
    items: list[pd.Timestamp] = []
    for raw in [base_as_of, quote_as_of]:
        ts = pd.to_datetime(raw, errors="coerce", utc=True)
        if not pd.isna(ts):
            items.append(ts)
    if not items:
        return ""
    if len(items) == 1:
        return items[0].isoformat()
    return min(items).isoformat()


def _build_rate_metric(
    symbol: str,
    diffs,
    rate_reason: str,
    policy_details: dict[str, dict],
    last_refreshed_utc: str,
) -> dict:
    pair = _split_pair_token(symbol)
    base_ccy, quote_ccy = pair if pair is not None else ("", "")
    base_row = policy_details.get(base_ccy) or {}
    quote_row = policy_details.get(quote_ccy) or {}

    signed_value = None if diffs.rate_diff is None else round(float(diffs.rate_diff), 2)

    return {
        "signed_value": signed_value,
        "unit": "pp",
        "trend_badge": str(diffs.rate_trend or "n/a"),
        "tooltip": "Interest rate differential shows base policy rate minus quote policy rate. Positive values favor base currency carry.",
        "na_reason": "" if signed_value is not None else rate_reason,
        "detail": {
            "raw_components": {
                "base_rate_pp": None if base_row.get("value") is None else float(base_row.get("value")),
                "quote_rate_pp": None if quote_row.get("value") is None else float(quote_row.get("value")),
                "formula": "base_rate_pp - quote_rate_pp",
            },
            "source_series_ids": {
                "base": str(base_row.get("series_id", "")),
                "quote": str(quote_row.get("series_id", "")),
            },
            "as_of_utc": {
                "base": str(base_row.get("as_of_utc", "")),
                "quote": str(quote_row.get("as_of_utc", "")),
                "effective": _effective_as_of(
                    str(base_row.get("as_of_utc", "")),
                    str(quote_row.get("as_of_utc", "")),
                ),
            },
            "last_refreshed_utc": str(last_refreshed_utc or ""),
        },
    }


def _to_rows(df: pd.DataFrame, limit: int = 50) -> list[dict]:
    if df.empty:
        return []
    out = df.head(int(limit)).copy()
    for col in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[col]):
            out[col] = pd.to_datetime(out[col], errors="coerce", utc=True).astype(str)
    rows: list[dict] = []
    for _, row in out.iterrows():
        item: dict = {}
        for key in out.columns:
            val = row[key]
            if pd.isna(val):
                item[str(key)] = None
            elif isinstance(val, (int, float, bool, str)):
                item[str(key)] = val
            else:
                item[str(key)] = str(val)
        rows.append(item)
    return rows


def _build_symbol_price_meta(df: pd.DataFrame, symbol: str) -> dict | None:
    if df.empty:
        return None
    token = str(symbol or "").strip().upper()
    if not token:
        return None

    out = df[df["Symbol"].astype(str).str.upper() == token].copy()
    if out.empty:
        return None

    out["TimeUTC"] = pd.to_datetime(out["TimeUTC"], errors="coerce", utc=True)
    out = out.dropna(subset=["TimeUTC"]).sort_values("TimeUTC")
    if out.empty:
        return None

    diffs = out["TimeUTC"].diff().dropna().dt.total_seconds().div(3600.0)
    missing = diffs[diffs > 1.0].apply(lambda h: max(0, int(round(h - 1.0))))
    gap_count = int(missing.sum())
    max_ts = out["TimeUTC"].max()
    min_ts = out["TimeUTC"].min()
    return {
        "symbol": token,
        "rows_loaded": int(len(out)),
        "gap_count": gap_count,
        "min_time_utc": min_ts.isoformat() if hasattr(min_ts, "isoformat") else "",
        "max_time_utc": max_ts.isoformat() if hasattr(max_ts, "isoformat") else "",
    }


def _read_file_logs(log_path: Path, levels: set[str], lookback_hours: int, limit: int) -> list[dict]:
    if not log_path.exists():
        return []

    cutoff = datetime.now(timezone.utc) - timedelta(hours=int(lookback_hours))
    out: list[dict] = []
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        return []

    for line in reversed(lines):
        m = _LOG_FILE_LINE.match(str(line).strip())
        if not m:
            continue
        level = str(m.group("level") or "INFO").upper()
        if levels and level not in levels:
            continue
        ts_raw = str(m.group("ts") or "").strip().replace(",", ".")
        ts = pd.to_datetime(ts_raw, errors="coerce", utc=True)
        if pd.isna(ts):
            continue
        ts_dt = ts.to_pydatetime()
        if ts_dt < cutoff:
            continue
        out.append(
            {
                "timestamp_utc": ts_dt.isoformat(timespec="seconds"),
                "level": level,
                "message": str(m.group("message") or "").strip(),
                "context": {"source": "file"},
            }
        )
        if len(out) >= int(limit):
            break
    return out


@router.get("/health")
def get_health(request: Request):
    services = _service(request)
    data = {
        "status": "ok",
        "service": APP_NAME,
        "version": APP_VERSION,
        "macro_enabled": bool(services["settings"].macro_enabled),
        "worker_pool_size": int(services["settings"].worker_pool_size),
    }
    return envelope(request, data)


@router.get("/bootstrap")
def get_bootstrap(request: Request):
    services = _service(request)
    runtime = services["state"].load_runtime_state()
    token = str(request.app.state.session_token)
    data = {
        "session_token": token,
        "first_launch_complete": runtime.first_launch_complete,
        "display_timezone": runtime.display_timezone or DISPLAY_TZ_DEFAULT,
        "server_timezone": runtime.server_timezone or SERVER_TZ_DEFAULT,
        "macro_enabled": services["settings"].macro_enabled,
        "macro_disabled_reason": services["settings"].macro_disabled_reason,
        "worker_pool_size": services["settings"].worker_pool_size,
        "data_root": str(services["settings"].data_root_path),
    }
    return envelope(request, data)


@router.post("/wizard/setup", dependencies=[Depends(_must_auth)])
def post_wizard_setup(request: Request, body: WizardSetupRequest):
    services = _service(request)
    services["state"].save_wizard(body.mt5_folder, body.top_pairs)

    fred_api_key = str(body.fred_api_key or "").strip()
    if fred_api_key:
        services["state"].save_fred_api_key(fred_api_key)
        services["settings"].fred_api_key = fred_api_key
        os.environ["FRED_API_KEY"] = fred_api_key
        services["logger_service"].write("INFO", "Wizard provided FRED key and saved it for future sessions.")

    return envelope(request, {"saved": True})


@router.get("/config/runtime", dependencies=[Depends(_must_auth)])
def get_runtime_config(request: Request):
    services = _service(request)
    state = services["state"].load_runtime_state()
    release_channel = str(state.release_channel or "stable").strip().lower()
    if release_channel not in {"stable", "beta"}:
        release_channel = "stable"

    release_base_url = str(services["settings"].releases_base_url or "").strip().rstrip("/")
    data = {
        "python_version": platform.python_version(),
        "timezone_display": state.display_timezone or DISPLAY_TZ_DEFAULT,
        "timezone_server": state.server_timezone or SERVER_TZ_DEFAULT,
        "timezone_storage": STORAGE_TZ,
        "macro_enabled": services["settings"].macro_enabled,
        "macro_disabled_reason": services["settings"].macro_disabled_reason,
        "fred_key_configured": bool(str(services["settings"].fred_api_key or "").strip()),
        "worker_pool_size": int(services["settings"].worker_pool_size),
        "first_launch_complete": state.first_launch_complete,
        "mt5_folder": state.mt5_folder,
        "top_pairs": state.top_pairs,
        "release_channel": release_channel,
        "release_base_url": release_base_url,
        "release_manifest_url": _release_manifest_url(release_base_url, release_channel),
    }
    return envelope(request, data)


@router.post("/config/runtime/apply", dependencies=[Depends(_must_auth)])
def post_runtime_config_apply(request: Request, body: RuntimeConfigApplyRequest):
    services = _service(request)

    mt5_folder = str(body.mt5_folder or "").strip()
    if mt5_folder:
        services["state"].set_mt5_folder(mt5_folder)
        services["state"].set_first_launch_complete(True)

    release_channel_updated = False
    if body.release_channel is not None:
        services["state"].set_release_channel(body.release_channel)
        release_channel_updated = True

    if body.fred_api_key is not None:
        fred_api_key = str(body.fred_api_key).strip()
        services["state"].save_fred_api_key(fred_api_key)
        services["settings"].fred_api_key = fred_api_key
        if fred_api_key:
            os.environ["FRED_API_KEY"] = fred_api_key
        else:
            os.environ.pop("FRED_API_KEY", None)

    services["logger_service"].write(
        "INFO",
        "Runtime config applied from Data Checklist.",
        {
            "mt5_folder_set": bool(mt5_folder),
            "fred_key_updated": body.fred_api_key is not None,
            "release_channel_updated": release_channel_updated,
            "macro_enabled": services["settings"].macro_enabled,
        },
    )

    state = services["state"].load_runtime_state()
    release_channel = str(state.release_channel or "stable").strip().lower()
    if release_channel not in {"stable", "beta"}:
        release_channel = "stable"

    release_base_url = str(services["settings"].releases_base_url or "").strip().rstrip("/")
    return envelope(
        request,
        {
            "saved": True,
            "mt5_folder": state.mt5_folder,
            "macro_enabled": services["settings"].macro_enabled,
            "macro_disabled_reason": services["settings"].macro_disabled_reason,
            "fred_key_configured": bool(str(services["settings"].fred_api_key or "").strip()),
            "release_channel": release_channel,
            "release_base_url": release_base_url,
            "release_manifest_url": _release_manifest_url(release_base_url, release_channel),
        },
    )


@router.post("/timezone/apply", dependencies=[Depends(_must_auth)])
def post_timezone_apply(request: Request, body: TimezoneApplyRequest):
    services = _service(request)
    try:
        pytz.timezone(body.display_timezone)
        pytz.timezone(body.server_timezone)
    except pytz.UnknownTimeZoneError:
        raise HTTPException(status_code=400, detail="Invalid timezone.")
    applied = services["state"].apply_timezone(body.display_timezone, body.server_timezone)
    services["logger_service"].write("INFO", "Timezone conversion updated.", applied)
    _emit_event(request, "data.updated", {"kind": "timezone", **applied})
    return envelope(request, {"applied": applied})


@router.post("/ingest/price", dependencies=[Depends(_must_auth)])
async def post_ingest_price(
    request: Request,
    file: UploadFile = File(...),
    source_timezone: str | None = Query(default=None),
    async_job: bool = Query(default=True),
):
    services = _service(request)
    state = services["state"].load_runtime_state()
    server_tz = source_timezone or state.server_timezone or SERVER_TZ_DEFAULT
    raw = await file.read()

    def _run_ingest(ctx=None) -> dict:
        meta = ingest_price_csv(raw, file.filename or "price.csv", server_tz, services["settings"].parquet_dir)
        if ctx is not None:
            ctx.set_progress(0.7, "Parsed candle data")
            ctx.raise_if_cancelled()

        services["db"].append_ingestion("price", file.filename or "price.csv", int(meta["rows_loaded"]), meta)
        services["db"].set_setting("latest_price_meta", meta)
        existing_top_pairs = services["db"].get_setting("top_pairs", [])
        if not existing_top_pairs:
            services["db"].set_setting("top_pairs", list(meta.get("symbols", []))[:10])
        gap_count = int(meta.get("gap_count", 0))
        services["logger_service"].write(
            "WARN" if gap_count >= AUTO_FETCH_GAP_WARN_COUNT else "INFO",
            "Price ingestion completed.",
            {"rows_loaded": meta.get("rows_loaded"), "symbols": meta.get("symbol_count"), "gap_count": gap_count},
        )
        return meta

    if async_job:

        def _job(ctx) -> dict:
            try:
                ctx.set_progress(0.15, "Parsing candle file")
                ctx.raise_if_cancelled()
                meta = _run_ingest(ctx)
                ctx.set_progress(0.95, "Publishing updates")
                ctx.raise_if_cancelled()
                _emit_event(request, "data.updated", {"kind": "price", "rows_loaded": meta.get("rows_loaded"), "symbols": meta.get("symbols", [])})
                _emit_event(request, "job.completed", {"name": "ingest.price"})
                return {"meta": meta}
            except JobCancelledError:
                services["logger_service"].write("INFO", "Price ingestion cancelled.", {"filename": file.filename or "price.csv"})
                _emit_event(request, "job.cancelled", {"name": "ingest.price"})
                raise
            except Exception as exc:
                services["logger_service"].write("ERROR", "Price ingestion failed.", {"error": str(exc)})
                _emit_event(request, "job.failed", {"name": "ingest.price", "error": str(exc)})
                raise

        job_id = services["jobs"].submit("ingest.price", _job)
        _emit_event(request, "job.started", {"job_id": job_id, "name": "ingest.price"})
        return envelope(request, {"accepted": True, "job_id": job_id, "mode": "async"})

    try:
        meta = _run_ingest(None)
    except IngestError as exc:
        services["logger_service"].write("ERROR", "Price ingestion failed.", {"error": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _emit_event(request, "data.updated", {"kind": "price", "rows_loaded": meta.get("rows_loaded"), "symbols": meta.get("symbols", [])})
    return envelope(request, {"accepted": True, "meta": meta, "mode": "sync"})


@router.post("/ingest/calendar", dependencies=[Depends(_must_auth)])
async def post_ingest_calendar(
    request: Request,
    file: UploadFile = File(...),
    source_timezone: str | None = Query(default=None),
    async_job: bool = Query(default=True),
):
    services = _service(request)
    state = services["state"].load_runtime_state()
    server_tz = source_timezone or state.server_timezone or SERVER_TZ_DEFAULT
    raw = await file.read()

    def _run_ingest(ctx=None) -> dict:
        meta = ingest_calendar_file(raw, file.filename or "calendar.csv", server_tz, services["settings"].parquet_dir)
        if ctx is not None:
            ctx.set_progress(0.7, "Parsed calendar data")
            ctx.raise_if_cancelled()

        services["db"].append_ingestion("calendar", file.filename or "calendar.csv", int(meta["rows_loaded"]), meta)
        services["db"].set_setting("latest_calendar_meta", meta)
        services["logger_service"].write("INFO", "Calendar ingestion completed.", {"rows_loaded": meta.get("rows_loaded")})
        return meta

    if async_job:

        def _job(ctx) -> dict:
            try:
                ctx.set_progress(0.15, "Parsing calendar file")
                ctx.raise_if_cancelled()
                meta = _run_ingest(ctx)
                ctx.set_progress(0.95, "Publishing updates")
                ctx.raise_if_cancelled()
                _emit_event(request, "data.updated", {"kind": "calendar", "rows_loaded": meta.get("rows_loaded")})
                _emit_event(request, "job.completed", {"name": "ingest.calendar"})
                return {"meta": meta}
            except JobCancelledError:
                services["logger_service"].write("INFO", "Calendar ingestion cancelled.", {"filename": file.filename or "calendar.csv"})
                _emit_event(request, "job.cancelled", {"name": "ingest.calendar"})
                raise
            except Exception as exc:
                services["logger_service"].write("ERROR", "Calendar ingestion failed.", {"error": str(exc)})
                _emit_event(request, "job.failed", {"name": "ingest.calendar", "error": str(exc)})
                raise

        job_id = services["jobs"].submit("ingest.calendar", _job)
        _emit_event(request, "job.started", {"job_id": job_id, "name": "ingest.calendar"})
        return envelope(request, {"accepted": True, "job_id": job_id, "mode": "async"})

    try:
        meta = _run_ingest(None)
    except IngestError as exc:
        services["logger_service"].write("ERROR", "Calendar ingestion failed.", {"error": str(exc)})
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _emit_event(request, "data.updated", {"kind": "calendar", "rows_loaded": meta.get("rows_loaded")})
    return envelope(request, {"accepted": True, "meta": meta, "mode": "sync"})


@router.post("/autofetch/apply-sync", dependencies=[Depends(_must_auth)])
def post_autofetch_apply_sync(request: Request, body: AutoFetchApplyRequest):
    services = _service(request)
    result = autofetch_apply_and_sync(
        db=services["db"],
        settings=services["settings"],
        state_service=services["state"],
        logger_service=services["logger_service"],
        mt5_folder=body.mt5_folder,
        enabled=bool(body.enabled),
        price_pattern=body.price_pattern,
        calendar_pattern=body.calendar_pattern,
        interval_hours=max(1, int(body.interval_hours)),
        section=body.section,
    )
    _emit_event(request, "data.updated", {"kind": "autofetch", "section": result.get("section", "full")})
    return envelope(request, result)


@router.post("/fred/refresh", dependencies=[Depends(_must_auth)])
def post_fred_refresh(request: Request):
    services = _service(request)
    settings = services["settings"]
    if not settings.macro_enabled:
        services["logger_service"].write("WARN", "FRED refresh skipped: missing API key.")
        return envelope(
            request,
            {
                "accepted": False,
                "macro_enabled": False,
                "message": settings.macro_disabled_reason,
            },
        )

    def _run_refresh(ctx=None) -> dict:
        fred = FredService(settings.fred_api_key)
        if ctx is not None:
            ctx.set_progress(0.2, "Fetching policy rates")
            ctx.raise_if_cancelled()

        policy_rows = fred.fetch_policy_rows()

        if ctx is not None:
            ctx.set_progress(0.55, "Fetching inflation series")
            ctx.raise_if_cancelled()

        inflation_rows = fred.fetch_inflation_rows()

        if ctx is not None:
            ctx.set_progress(0.85, "Persisting macro snapshot")
            ctx.raise_if_cancelled()

        services["db"].replace_macro_snapshot("policy", policy_rows)
        services["db"].replace_macro_snapshot("inflation", inflation_rows)
        services["db"].set_setting("macro_last_refresh_utc", pd.Timestamp.utcnow().isoformat())
        services["logger_service"].write(
            "INFO",
            "FRED refresh completed.",
            {"policy_rows": len(policy_rows), "inflation_rows": len(inflation_rows)},
        )
        _emit_event(
            request,
            "data.updated",
            {"kind": "macro", "policy_rows": len(policy_rows), "inflation_rows": len(inflation_rows)},
        )
        return {"policy_rows": policy_rows, "inflation_rows": inflation_rows}

    def _job(ctx) -> dict:
        try:
            out = _run_refresh(ctx)
            _emit_event(request, "job.completed", {"name": "fred.refresh"})
            return out
        except JobCancelledError:
            services["logger_service"].write("INFO", "FRED refresh cancelled.", {})
            _emit_event(request, "job.cancelled", {"name": "fred.refresh"})
            raise
        except Exception as exc:
            services["logger_service"].write("ERROR", "FRED refresh failed.", {"error": str(exc)})
            _emit_event(request, "job.failed", {"name": "fred.refresh", "error": str(exc)})
            raise

    job_id = services["jobs"].submit("fred.refresh", _job)
    _emit_event(request, "job.started", {"job_id": job_id, "name": "fred.refresh"})
    return envelope(request, {"accepted": True, "job_id": job_id, "mode": "async"})


@router.get("/fred/snapshot", dependencies=[Depends(_must_auth)])
def get_fred_snapshot(request: Request, kind: str = Query(default="policy")):
    services = _service(request)
    token = str(kind or "policy").strip().lower()
    if token not in {"policy", "inflation"}:
        raise HTTPException(status_code=400, detail="kind must be policy or inflation")
    rows = services["db"].get_macro_snapshot(token)
    data = {
        "kind": token,
        "rows": rows,
        "last_refresh_utc": str(services["db"].get_setting("macro_last_refresh_utc", "") or ""),
        "macro_enabled": bool(services["settings"].macro_enabled),
        "macro_disabled_reason": str(services["settings"].macro_disabled_reason or ""),
    }
    return envelope(request, data)


@router.get("/fundamental/differential", dependencies=[Depends(_must_auth)])
def get_fundamental_differential(
    request: Request,
    base: str = Query(default="EUR"),
    quote: str = Query(default="USD"),
    inflation_mode: str = Query(default="yoy"),
    pair: str | None = Query(default=None),
):
    services = _service(request)
    mode = str(inflation_mode or "yoy").strip().lower()
    if mode not in {"yoy", "mom"}:
        mode = "yoy"

    policy_rows = services["db"].get_macro_snapshot("policy")
    inflation_rows = services["db"].get_macro_snapshot("inflation")
    fred = FredService(services["settings"].fred_api_key)
    policy_latest, policy_trend = fred.to_policy_maps(policy_rows)
    policy_details = fred.to_policy_detail_map(policy_rows)
    inflation_map = fred.to_inflation_map(inflation_rows, mode=mode)

    symbol, pair_source = _resolve_active_pair(pair, base, quote, policy_details)
    pair_tokens = _split_pair_token(symbol)
    if pair_tokens is None:
        raise HTTPException(status_code=400, detail="Unable to resolve active pair.")
    base_ccy, quote_ccy = pair_tokens

    swap_map = services["db"].get_swap_drag_bps_map()
    diffs = compute_pair_differentials(symbol, policy_latest, policy_trend, inflation_map, swap_map)

    if base_ccy == quote_ccy:
        rate_reason = "Base and quote are identical."
        infl_reason = "Base and quote are identical."
        rate_metric = _build_rate_metric(
            symbol=symbol,
            diffs=diffs,
            rate_reason=rate_reason,
            policy_details=policy_details,
            last_refreshed_utc=str(services["db"].get_setting("macro_last_refresh_utc", "") or ""),
        )
        rate_metric["signed_value"] = 0.0
        rate_metric["na_reason"] = ""
        rate_metric["trend_badge"] = "Flat"
        return envelope(
            request,
            {
                "base": base_ccy,
                "quote": quote_ccy,
                "active_pair": symbol,
                "pair_source": pair_source,
                "strength_watchlist_default": list(_STRENGTH_MAJOR_WATCHLIST),
                "inflation_mode": mode,
                "rate_differential": 0.0,
                "rate_reason": rate_reason,
                "inflation_differential": 0.0,
                "inflation_reason": infl_reason,
                "rate_trend": "Flat",
                "rate_metric": rate_metric,
            },
        )

    rate_reason = "ok" if diffs.rate_diff is not None else "Missing policy rate for base or quote."
    infl_reason = "ok" if diffs.inflation_diff is not None else f"Missing inflation ({mode}) for base or quote."
    last_refreshed_utc = str(services["db"].get_setting("macro_last_refresh_utc", "") or "")
    rate_metric = _build_rate_metric(
        symbol=symbol,
        diffs=diffs,
        rate_reason=rate_reason,
        policy_details=policy_details,
        last_refreshed_utc=last_refreshed_utc,
    )

    return envelope(
        request,
        {
            "base": base_ccy,
            "quote": quote_ccy,
            "active_pair": symbol,
            "pair_source": pair_source,
            "strength_watchlist_default": list(_STRENGTH_MAJOR_WATCHLIST),
            "inflation_mode": mode,
            "rate_differential": None if diffs.rate_diff is None else round(float(diffs.rate_diff), 2),
            "rate_reason": rate_reason,
            "inflation_differential": None if diffs.inflation_diff is None else round(float(diffs.inflation_diff), 2),
            "inflation_reason": infl_reason,
            "rate_trend": diffs.rate_trend,
            "rate_metric": rate_metric,
        },
    )


@router.get("/checklist/overview", dependencies=[Depends(_must_auth)])
def get_checklist_overview(request: Request, symbol: str | None = Query(default=None)):
    services = _service(request)
    state = services["state"].load_runtime_state()
    price_meta = services["db"].get_setting("latest_price_meta", None)
    cal_meta = services["db"].get_setting("latest_calendar_meta", None)
    price_path = services["settings"].parquet_dir / "price_latest.parquet"
    price_df = _load_price_df(price_path)
    active_symbol = str(symbol or "").strip().upper()
    if not active_symbol and state.top_pairs:
        active_symbol = str(state.top_pairs[0]).strip().upper()
    price_symbol_meta = _build_symbol_price_meta(price_df, active_symbol)
    policy_rows = services["db"].get_macro_snapshot("policy")
    inflation_rows = services["db"].get_macro_snapshot("inflation")
    auto_cfg_obj = load_autofetch_config(services["db"])
    auto_cfg = {
        "enabled": auto_cfg_obj.enabled,
        "mt5_folder": auto_cfg_obj.mt5_folder,
        "price_pattern": auto_cfg_obj.price_pattern,
        "calendar_pattern": auto_cfg_obj.calendar_pattern,
        "interval_hours": auto_cfg_obj.interval_hours,
        "last_sync_utc": auto_cfg_obj.last_sync_utc,
        "last_price_status": auto_cfg_obj.last_price_status,
        "last_calendar_status": auto_cfg_obj.last_calendar_status,
        "last_price_file": auto_cfg_obj.last_price_file,
        "last_calendar_file": auto_cfg_obj.last_calendar_file,
    }
    overview = build_checklist_overview(
        price_meta=price_meta,
        price_symbol_meta=price_symbol_meta,
        calendar_meta=cal_meta,
        macro_policy_rows=policy_rows,
        macro_inflation_rows=inflation_rows,
        macro_enabled=services["settings"].macro_enabled,
        ui_timezone=state.display_timezone or DISPLAY_TZ_DEFAULT,
        auto_fetch_config=auto_cfg,
        active_symbol=active_symbol,
    )
    return envelope(request, overview)


@router.get("/preview/price", dependencies=[Depends(_must_auth)])
def get_price_preview(request: Request, limit: int = Query(default=50, ge=1, le=500), symbol: str | None = Query(default=None)):
    services = _service(request)
    path = services["settings"].parquet_dir / "price_latest.parquet"
    df = _load_price_df(path)
    if df.empty:
        return envelope(request, {"rows": [], "count": 0})

    token = str(symbol or "").strip().upper()
    if token:
        df = df[df["Symbol"].astype(str).str.upper() == token].copy()
        if df.empty:
            return envelope(request, {"rows": [], "count": 0})

    df = df.sort_values("TimeUTC", ascending=False)
    return envelope(request, {"rows": _to_rows(df, limit=int(limit)), "count": int(len(df))})


@router.get("/preview/calendar", dependencies=[Depends(_must_auth)])
def get_calendar_preview(request: Request, limit: int = Query(default=50, ge=1, le=500)):
    services = _service(request)
    path = services["settings"].parquet_dir / "calendar_latest.parquet"
    df = _load_calendar_df(path)
    return envelope(request, {"rows": _to_rows(df, limit=int(limit)), "count": int(len(df))})


@router.get("/dashboard/cards", dependencies=[Depends(_must_auth)])
def get_dashboard_cards(
    request: Request,
    symbol_query: str = Query(default=""),
    sort_by: str = Query(default="readiness_symbol"),
    watchlist_csv: str = Query(default=""),
    watchlist_only: bool = Query(default=False),
    card_limit: int = Query(default=24, ge=1, le=500),
    inflation_mode: str = Query(default="yoy"),
):
    services = _service(request)
    price_path = services["settings"].parquet_dir / "price_latest.parquet"
    df = _load_price_df(price_path)
    if df.empty:
        return envelope(request, {"cards": [], "total_symbols": 0})

    mode = str(inflation_mode or "yoy").strip().lower()
    if mode not in {"yoy", "mom"}:
        mode = "yoy"

    symbols = sorted(df["Symbol"].dropna().astype(str).str.upper().str.strip().replace("", pd.NA).dropna().unique().tolist())
    total_symbols = len(symbols)

    q = str(symbol_query).strip().upper()
    if q:
        symbols = [s for s in symbols if q in s]

    watchlist = _parse_watchlist_csv(watchlist_csv)
    if watchlist_only and watchlist:
        symbols = [s for s in symbols if s in watchlist]

    symbols = symbols[: int(card_limit)]

    atr_map = atr14_h1_map(df)
    adr_map = adr20_map(df)

    policy_rows = services["db"].get_macro_snapshot("policy")
    inflation_rows = services["db"].get_macro_snapshot("inflation")
    fred = FredService(services["settings"].fred_api_key)
    policy_latest, policy_trend = fred.to_policy_maps(policy_rows)
    inflation_map = fred.to_inflation_map(inflation_rows, mode=mode)
    swap_map = services["db"].get_swap_drag_bps_map()

    cards: list[dict] = []
    for symbol in symbols:
        atr14 = atr_map.get(symbol)
        adr20 = adr_map.get(symbol)
        daily_atr_pct_avg = None
        if atr14 is not None and adr20 is not None and adr20 > 0:
            daily_atr_pct_avg = ((atr14 * 24.0) / adr20) * 100.0

        diffs = compute_pair_differentials(symbol, policy_latest, policy_trend, inflation_map, swap_map)
        readiness = "ready"
        reason = "ATR and macro differentials are available."
        if atr14 is None:
            readiness = "error"
            reason = "ATR(14) unavailable for this symbol."
        elif diffs.rate_diff is None or diffs.inflation_diff is None:
            readiness = "warn"
            reason = "One or more macro differentials unavailable."

        cards.append(
            {
                "symbol": symbol,
                "readiness": readiness,
                "readiness_reason": reason,
                "rate_reason": "ok" if diffs.rate_diff is not None else "Missing policy data.",
                "inflation_reason": "ok" if diffs.inflation_diff is not None else f"Missing inflation ({mode}) data.",
                "metrics": {
                    "rate_differential": None if diffs.rate_diff is None else round(float(diffs.rate_diff), 2),
                    "rate_trend": diffs.rate_trend,
                    "inflation_differential": None if diffs.inflation_diff is None else round(float(diffs.inflation_diff), 2),
                    "carry_estimator": None if diffs.carry_estimator is None else round(float(diffs.carry_estimator), 2),
                    "daily_atr_pct_average": None if daily_atr_pct_avg is None else round(float(daily_atr_pct_avg), 2),
                    "strength_meter": None if diffs.strength_meter is None else round(float(diffs.strength_meter), 2),
                    "swap_drag_bps": round(float(swap_map.get(symbol.upper(), 0.0)), 2),
                    "atr14_h1_raw": None if atr14 is None else round(float(atr14), 6),
                    "atr14_h1_pips": None if atr14 is None else (None if pip_value(symbol, atr14) is None else round(float(pip_value(symbol, atr14)), 1)),
                },
            }
        )

    sort_token = str(sort_by or "readiness_symbol").strip().lower()
    if sort_token in {"symbol_az", "az"}:
        cards = sorted(cards, key=lambda r: r["symbol"])
    elif sort_token in {"symbol_za", "za"}:
        cards = sorted(cards, key=lambda r: r["symbol"], reverse=True)
    elif sort_token in {"atr_desc", "atr_high_low"}:
        cards = sorted(cards, key=lambda r: float(r["metrics"].get("atr14_h1_pips") or -1.0), reverse=True)
    else:
        cards = sorted(cards, key=lambda r: (0 if r["readiness"] == "ready" else 1 if r["readiness"] == "warn" else 2, r["symbol"]))

    return envelope(request, {"cards": cards, "total_symbols": total_symbols, "filtered_symbols": len(symbols)})


@router.get("/charts/series", dependencies=[Depends(_must_auth)])
def get_chart_series(
    request: Request,
    symbol: str = Query(...),
    limit: int = Query(default=1000, ge=50, le=5000),
):
    services = _service(request)
    path = services["settings"].parquet_dir / "price_latest.parquet"
    df = _load_price_df(path)
    if df.empty:
        return envelope(request, {"symbol": symbol.upper(), "rows": []})
    sym = str(symbol).strip().upper()
    out = df[df["Symbol"].astype(str).str.upper() == sym].copy()
    if out.empty:
        return envelope(request, {"symbol": sym, "rows": []})
    out = out.sort_values("TimeUTC").tail(int(limit))
    rows = []
    for _, row in out.iterrows():
        rows.append(
            {
                "time_utc": pd.to_datetime(row["TimeUTC"], utc=True).isoformat(),
                "open": float(row["Open"]),
                "high": float(row["High"]),
                "low": float(row["Low"]),
                "close": float(row["Close"]),
            }
        )
    return envelope(request, {"symbol": sym, "rows": rows})


@router.get("/logs", dependencies=[Depends(_must_auth)])
def get_logs(
    request: Request,
    levels: str = Query(default="WARN,ERROR"),
    lookback_hours: int = Query(default=24, ge=1, le=720),
    limit: int = Query(default=1000, ge=1, le=10000),
    source: str = Query(default="session"),
):
    services = _service(request)
    tokens = [x.strip().upper() for x in str(levels).split(",") if x.strip()]
    level_set = set(tokens)

    source_token = str(source or "session").strip().lower()
    if source_token not in {"session", "file", "both"}:
        raise HTTPException(status_code=400, detail="source must be session, file, or both")

    rows: list[dict] = []
    if source_token in {"session", "both"}:
        rows.extend(services["db"].get_logs(tokens, int(lookback_hours), int(limit)))

    if source_token in {"file", "both"}:
        rows.extend(_read_file_logs(services["settings"].log_dir / "engine.log", level_set, int(lookback_hours), int(limit)))

    rows = sorted(rows, key=lambda r: str(r.get("timestamp_utc", "")), reverse=True)
    rows = rows[: int(limit)]
    return envelope(request, {"rows": rows})


@router.post("/tools/promote-metric", dependencies=[Depends(_must_auth)])
def post_promote_metric(request: Request, body: PromoteMetricRequest):
    services = _service(request)
    services["db"].add_metric_promotion(body.metric_key, body.version_tag)
    services["logger_service"].write(
        "INFO",
        "Metric promoted from Fundamental Tools.",
        {"metric_key": body.metric_key, "version_tag": body.version_tag},
    )
    return envelope(request, {"saved": True, "metric_key": body.metric_key, "version_tag": body.version_tag})


@router.get("/swap-config", dependencies=[Depends(_must_auth)])
def get_swap_config(request: Request, symbols_csv: str = Query(default="")):
    services = _service(request)
    symbols = _parse_symbols_csv(symbols_csv)
    configured_rows = services["db"].get_swap_config_rows(symbols if symbols else None)

    if not symbols:
        rows = [
            {
                "symbol": str(row.get("symbol", "")).upper(),
                "swap_drag_bps": float(row.get("swap_drag_bps", 0.0)),
                "updated_at_utc": str(row.get("updated_at_utc", "")),
                "source": "configured",
            }
            for row in configured_rows
        ]
        return envelope(request, {"rows": rows})

    configured_map = {str(row.get("symbol", "")).upper(): row for row in configured_rows}
    rows: list[dict] = []
    for symbol in symbols:
        row = configured_map.get(symbol)
        if row is None:
            rows.append(
                {
                    "symbol": symbol,
                    "swap_drag_bps": 0.0,
                    "updated_at_utc": "",
                    "source": "default_zero",
                }
            )
        else:
            rows.append(
                {
                    "symbol": symbol,
                    "swap_drag_bps": float(row.get("swap_drag_bps", 0.0)),
                    "updated_at_utc": str(row.get("updated_at_utc", "")),
                    "source": "configured",
                }
            )
    return envelope(request, {"rows": rows})


@router.post("/swap-config", dependencies=[Depends(_must_auth)])
def post_swap_config(request: Request, body: SwapConfigRequest):
    services = _service(request)
    symbol = body.symbol.strip().upper()
    services["db"].set_swap_drag_bps(symbol, float(body.swap_drag_bps))
    services["logger_service"].write("INFO", "Swap drag updated.", {"symbol": symbol, "swap_drag_bps": body.swap_drag_bps})
    return envelope(request, {"saved": True, "symbol": symbol, "swap_drag_bps": body.swap_drag_bps})


@router.get("/jobs/{job_id}", dependencies=[Depends(_must_auth)])
def get_job(request: Request, job_id: str):
    services = _service(request)
    rec = services["jobs"].get(job_id)
    if rec is None:
        raise HTTPException(status_code=404, detail="Job not found.")
    return envelope(request, rec.__dict__)


@router.get("/jobs", dependencies=[Depends(_must_auth)])
def list_jobs(request: Request, limit: int = Query(default=20, ge=1, le=200)):
    services = _service(request)
    rows = [rec.__dict__ for rec in services["jobs"].list_recent(limit=int(limit))]
    return envelope(request, {"rows": rows})


@router.post("/jobs/{job_id}/cancel", dependencies=[Depends(_must_auth)])
def cancel_job(request: Request, job_id: str):
    services = _service(request)
    cancelled = bool(services["jobs"].cancel(job_id))
    if cancelled:
        _emit_event(request, "job.cancelled", {"job_id": job_id})
    return envelope(request, {"job_id": job_id, "cancelled": cancelled})




