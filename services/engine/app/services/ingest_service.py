from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import pytz
from pandas.errors import EmptyDataError, ParserError


class IngestError(ValueError):
    pass


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _detect_delimiter(sample: str) -> str:
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        return str(dialect.delimiter)
    except csv.Error:
        return ","


def _normalize_symbol(token: str) -> str:
    return str(token or "").strip().upper()


def _ensure_timezone(value: str, fallback: str) -> str:
    token = str(value or "").strip() or str(fallback or "UTC")
    try:
        pytz.timezone(token)
        return token
    except pytz.UnknownTimeZoneError:
        return str(fallback or "UTC")


def _to_utc_series(raw: pd.Series, source_timezone: str) -> pd.Series:
    parsed = pd.to_datetime(raw, errors="coerce")
    if parsed.dt.tz is not None:
        return parsed.dt.tz_convert("UTC")
    return parsed.dt.tz_localize(source_timezone, ambiguous="NaT", nonexistent="NaT").dt.tz_convert("UTC")


def ingest_price_csv(
    raw_bytes: bytes,
    source_name: str,
    source_timezone: str,
    parquet_dir: Path,
) -> dict:
    text = raw_bytes.decode("utf-8", errors="replace")
    delim = _detect_delimiter(text[:4096])
    try:
        df = pd.read_csv(io.StringIO(text), sep=delim)
    except (EmptyDataError, ParserError) as exc:
        raise IngestError(f"Unable to parse price CSV: {exc}") from exc

    required = {"Time", "Open", "High", "Low", "Close", "Symbol"}
    if not required.issubset(set(df.columns)):
        raise IngestError(f"Price CSV missing required columns: {sorted(required)}")

    source_tz = _ensure_timezone(source_timezone, "UTC")
    out = df[["Time", "Open", "High", "Low", "Close", "Symbol"]].copy()
    out["Symbol"] = out["Symbol"].map(_normalize_symbol)
    out["Open"] = pd.to_numeric(out["Open"], errors="coerce")
    out["High"] = pd.to_numeric(out["High"], errors="coerce")
    out["Low"] = pd.to_numeric(out["Low"], errors="coerce")
    out["Close"] = pd.to_numeric(out["Close"], errors="coerce")
    out["TimeUTC"] = _to_utc_series(out["Time"], source_tz)

    out = out.dropna(subset=["Symbol", "Open", "High", "Low", "Close", "TimeUTC"])
    out = out[out["Symbol"].ne("")]
    if out.empty:
        raise IngestError("Price CSV has no valid rows after normalization.")

    out = out.sort_values(["Symbol", "TimeUTC"]).reset_index(drop=True)

    parquet_dir.mkdir(parents=True, exist_ok=True)
    out_path = parquet_dir / "price_latest.parquet"
    out.to_parquet(out_path, index=False)

    symbols = sorted(out["Symbol"].unique().tolist())
    min_ts = out["TimeUTC"].min()
    max_ts = out["TimeUTC"].max()

    gap_count = 0
    for _sym, group in out.groupby("Symbol", sort=False):
        diffs = group["TimeUTC"].diff().dropna().dt.total_seconds().div(3600.0)
        missing = diffs[diffs > 1.0].apply(lambda h: max(0, int(round(h - 1.0))))
        gap_count += int(missing.sum())

    meta = {
        "source_name": source_name,
        "source_timezone": source_tz,
        "delimiter": delim,
        "rows_loaded": int(len(out)),
        "symbols": symbols,
        "symbol_count": int(len(symbols)),
        "min_time_utc": min_ts.isoformat() if hasattr(min_ts, "isoformat") else "",
        "max_time_utc": max_ts.isoformat() if hasattr(max_ts, "isoformat") else "",
        "gap_count": int(gap_count),
        "loaded_at_utc": _utc_now_iso(),
        "parquet_path": str(out_path),
    }
    return meta


def ingest_calendar_file(
    raw_bytes: bytes,
    source_name: str,
    source_timezone: str,
    parquet_dir: Path,
) -> dict:
    source_tz = _ensure_timezone(source_timezone, "UTC")
    lower_name = str(source_name or "").lower()
    text = raw_bytes.decode("utf-8", errors="replace")
    bad_line_count = 0
    delimiter = ""

    parsed_df: pd.DataFrame
    mode: str
    if lower_name.endswith((".htm", ".html")):
        try:
            tables = pd.read_html(io.StringIO(text))
            if not tables:
                raise IngestError("Calendar HTML has no tables.")
            parsed_df = tables[0]
            mode = "html"
        except ValueError as exc:
            raise IngestError(f"Unable to parse calendar HTML: {exc}") from exc
    else:
        delim = _detect_delimiter(text[:4096])
        delimiter = delim
        try:
            parsed_df = pd.read_csv(io.StringIO(text), sep=delim)
            mode = "csv"
        except (EmptyDataError, ParserError) as exc:
            skipped = {"count": 0}

            def _skip_bad_line(_: list[str]) -> None:
                skipped["count"] += 1
                return None

            try:
                parsed_df = pd.read_csv(
                    io.StringIO(text),
                    sep=delim,
                    engine="python",
                    on_bad_lines=_skip_bad_line,
                )
            except (EmptyDataError, ParserError) as retry_exc:
                raise IngestError(f"Unable to parse calendar CSV: {exc}") from retry_exc

            bad_line_count = int(skipped["count"])
            if parsed_df.empty:
                raise IngestError("Calendar CSV has no valid rows after skipping malformed rows.")
            mode = "csv_tolerant"

    parsed_df.columns = [str(c).strip() for c in parsed_df.columns]
    time_col = None
    for candidate in ["ServerDateTime", "time", "Time", "DateTime", "datetime"]:
        if candidate in parsed_df.columns:
            time_col = candidate
            break
    if time_col is None:
        raise IngestError("Calendar file missing datetime column (expected ServerDateTime/Time).")

    out = parsed_df.copy()
    out["EventTimeUTC"] = _to_utc_series(out[time_col], source_tz)
    out = out.dropna(subset=["EventTimeUTC"])
    if out.empty:
        raise IngestError("Calendar file has no valid datetime rows.")

    out = out.sort_values("EventTimeUTC").reset_index(drop=True)
    parquet_dir.mkdir(parents=True, exist_ok=True)
    out_path = parquet_dir / "calendar_latest.parquet"
    out.to_parquet(out_path, index=False)

    currency_col = None
    for candidate in ["Currency", "currency", "CCY"]:
        if candidate in out.columns:
            currency_col = candidate
            break
    currencies = []
    if currency_col:
        currencies = sorted([x for x in out[currency_col].fillna("").astype(str).str.upper().str.strip().unique().tolist() if x])

    meta = {
        "source_name": source_name,
        "source_timezone": source_tz,
        "mode": mode,
        "delimiter": delimiter,
        "bad_line_count": int(bad_line_count),
        "rows_loaded": int(len(out)),
        "currency_count": len(currencies),
        "currencies": currencies,
        "min_time_utc": out["EventTimeUTC"].min().isoformat(),
        "max_time_utc": out["EventTimeUTC"].max().isoformat(),
        "loaded_at_utc": _utc_now_iso(),
        "parquet_path": str(out_path),
    }
    return meta

