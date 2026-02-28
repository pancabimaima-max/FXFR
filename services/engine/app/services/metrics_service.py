from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytz


def _split_fx_symbol(symbol: str) -> tuple[str, str] | None:
    token = str(symbol or "").strip().upper()
    if len(token) != 6 or not token.isalpha():
        return None
    return token[:3], token[3:]


def pip_size_for_symbol(symbol: str) -> float | None:
    pair = _split_fx_symbol(symbol)
    if pair is None:
        return None
    _base, quote = pair
    return 0.01 if quote == "JPY" else 0.0001


def atr14_h1_map(price_df: pd.DataFrame) -> dict[str, float]:
    req = {"Symbol", "TimeUTC", "High", "Low", "Close"}
    if price_df.empty or not req.issubset(price_df.columns):
        return {}
    df = price_df[["Symbol", "TimeUTC", "High", "Low", "Close"]].copy()
    df["Symbol"] = df["Symbol"].astype(str).str.upper().str.strip()
    df["TimeUTC"] = pd.to_datetime(df["TimeUTC"], errors="coerce", utc=True)
    df["High"] = pd.to_numeric(df["High"], errors="coerce")
    df["Low"] = pd.to_numeric(df["Low"], errors="coerce")
    df["Close"] = pd.to_numeric(df["Close"], errors="coerce")
    df = df.dropna(subset=["Symbol", "TimeUTC", "High", "Low", "Close"]).sort_values(["Symbol", "TimeUTC"])
    if df.empty:
        return {}
    prev_close = df.groupby("Symbol")["Close"].shift(1)
    tr = pd.concat(
        [(df["High"] - df["Low"]).abs(), (df["High"] - prev_close).abs(), (df["Low"] - prev_close).abs()],
        axis=1,
    ).max(axis=1)
    df["ATR14"] = tr.groupby(df["Symbol"]).transform(lambda s: s.rolling(14).mean())
    latest = df.groupby("Symbol", as_index=False).tail(1)
    out: dict[str, float] = {}
    for _, row in latest.iterrows():
        val = row.get("ATR14")
        if pd.isna(val):
            continue
        out[str(row["Symbol"])] = float(val)
    return out


def adr20_map(price_df: pd.DataFrame) -> dict[str, float]:
    req = {"Symbol", "TimeUTC", "High", "Low"}
    if price_df.empty or not req.issubset(price_df.columns):
        return {}
    df = price_df[["Symbol", "TimeUTC", "High", "Low"]].copy()
    df["Symbol"] = df["Symbol"].astype(str).str.upper().str.strip()
    df["TimeUTC"] = pd.to_datetime(df["TimeUTC"], errors="coerce", utc=True)
    df["High"] = pd.to_numeric(df["High"], errors="coerce")
    df["Low"] = pd.to_numeric(df["Low"], errors="coerce")
    df = df.dropna(subset=["Symbol", "TimeUTC", "High", "Low"])
    if df.empty:
        return {}
    df["DayUTC"] = df["TimeUTC"].dt.floor("D")
    daily = (
        df.groupby(["Symbol", "DayUTC"], as_index=False)
        .agg(day_high=("High", "max"), day_low=("Low", "min"))
        .assign(day_range=lambda x: (x["day_high"] - x["day_low"]).abs())
    )
    daily = daily.sort_values(["Symbol", "DayUTC"])
    daily["ADR20"] = daily.groupby("Symbol")["day_range"].transform(lambda s: s.rolling(20).mean())
    latest = daily.groupby("Symbol", as_index=False).tail(1)
    out: dict[str, float] = {}
    for _, row in latest.iterrows():
        val = row.get("ADR20")
        if pd.isna(val):
            continue
        out[str(row["Symbol"])] = float(val)
    return out


def pip_value(symbol: str, raw_value: float | None) -> float | None:
    if raw_value is None:
        return None
    size = pip_size_for_symbol(symbol)
    if size is None or size <= 0:
        return None
    return float(raw_value) / size


@dataclass
class DifferentialSet:
    rate_diff: float | None
    rate_trend: str
    inflation_diff: float | None
    carry_estimator: float | None
    strength_meter: float | None


def _zscore_map(values: dict[str, float]) -> dict[str, float]:
    if not values:
        return {}
    arr = np.array(list(values.values()), dtype=float)
    std = float(arr.std())
    mean = float(arr.mean())
    if std == 0:
        return {k: 0.0 for k in values.keys()}
    return {k: (float(v) - mean) / std for k, v in values.items()}


def compute_currency_strength(policy_map: dict[str, float], cpi_yoy_map: dict[str, float]) -> dict[str, float]:
    z_rate = _zscore_map(policy_map)
    inv_cpi = {k: -float(v) for k, v in cpi_yoy_map.items()}
    z_infl = _zscore_map(inv_cpi)
    currencies = set(z_rate.keys()) | set(z_infl.keys())
    out: dict[str, float] = {}
    for ccy in currencies:
        out[ccy] = 0.7 * float(z_rate.get(ccy, 0.0)) + 0.3 * float(z_infl.get(ccy, 0.0))
    return out


def compute_pair_differentials(
    symbol: str,
    policy_latest: dict[str, float],
    policy_trend: dict[str, str],
    inflation_yoy: dict[str, float],
    swap_drag_bps_map: dict[str, float],
) -> DifferentialSet:
    pair = _split_fx_symbol(symbol)
    if pair is None:
        return DifferentialSet(None, "n/a", None, None, None)

    base, quote = pair
    base_rate = policy_latest.get(base)
    quote_rate = policy_latest.get(quote)
    base_inf = inflation_yoy.get(base)
    quote_inf = inflation_yoy.get(quote)

    rate_diff = None if base_rate is None or quote_rate is None else float(base_rate - quote_rate)
    inflation_diff = None if base_inf is None or quote_inf is None else float(base_inf - quote_inf)

    rate_trend = "n/a"
    if base in policy_trend and quote in policy_trend:
        trend_tokens = (policy_trend[base], policy_trend[quote])
        if trend_tokens[0] == trend_tokens[1]:
            rate_trend = "Flat"
        elif trend_tokens[0] == "Rising" and trend_tokens[1] != "Rising":
            rate_trend = "Rising"
        elif trend_tokens[0] == "Falling" and trend_tokens[1] != "Falling":
            rate_trend = "Falling"
        else:
            rate_trend = "Mixed"

    if rate_diff is None:
        carry = None
    else:
        drag_pp = float(swap_drag_bps_map.get(symbol.upper(), 0.0)) / 100.0
        carry = float(rate_diff - drag_pp)

    policy_strength = compute_currency_strength(policy_latest, inflation_yoy)
    strength = None
    if base in policy_strength and quote in policy_strength:
        strength = float(policy_strength[base] - policy_strength[quote]) * 10.0 + 50.0

    return DifferentialSet(rate_diff, rate_trend, inflation_diff, carry, strength)


def to_local_iso(utc_iso: str, timezone_name: str) -> str:
    if not utc_iso:
        return ""
    try:
        dt = pd.to_datetime(utc_iso, utc=True)
        if pd.isna(dt):
            return ""
        tz = pytz.timezone(timezone_name)
        return dt.tz_convert(tz).strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return utc_iso


def age_hours_from_iso(utc_iso: str) -> float | None:
    if not utc_iso:
        return None
    try:
        dt = pd.to_datetime(utc_iso, utc=True)
        if pd.isna(dt):
            return None
        delta = datetime.now(timezone.utc) - dt.to_pydatetime()
        return max(0.0, delta.total_seconds() / 3600.0)
    except Exception:
        return None

