from __future__ import annotations

from datetime import datetime, timezone

import pandas as pd
from fredapi import Fred

from app.core.constants import (
    CENTRAL_BANK_LABELS,
    FRED_CPI_FALLBACK_SERIES,
    FRED_CPI_INDEX_SERIES,
    FRED_POLICY_SERIES,
)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _trend_from_last_three(values: list[float], epsilon: float = 0.05) -> str:
    if len(values) < 2:
        return "Flat"
    delta = float(values[-1] - values[0])
    if delta > epsilon:
        return "Rising"
    if delta < -epsilon:
        return "Falling"
    return "Flat"


class FredService:
    def __init__(self, api_key: str):
        self._api_key = str(api_key or "").strip()
        self._enabled = bool(self._api_key)
        self._client = Fred(api_key=self._api_key) if self._enabled else None

    @property
    def enabled(self) -> bool:
        return self._enabled

    def fetch_policy_rows(self) -> list[dict]:
        if not self._enabled or self._client is None:
            return []
        rows: list[dict] = []
        for currency, series_id in FRED_POLICY_SERIES.items():
            rows.append(self._fetch_policy_one(currency, series_id))
        return rows

    def _fetch_policy_one(self, currency: str, series_id: str) -> dict:
        try:
            s = self._client.get_series(series_id)  # type: ignore[union-attr]
            s = s.dropna().tail(3)
            if s.empty:
                raise ValueError("No observations")
            val = float(s.iloc[-1])
            as_of = pd.to_datetime(s.index[-1]).tz_localize("UTC").isoformat()
            trend = _trend_from_last_three([float(x) for x in s.tolist()])
            return {
                "currency": currency,
                "series_id": series_id,
                "value": val,
                "status": "ok",
                "error_message": "",
                "as_of_utc": as_of,
                "aux": {"trend": trend, "central_bank": CENTRAL_BANK_LABELS.get(currency, currency)},
            }
        except Exception as exc:
            return {
                "currency": currency,
                "series_id": series_id,
                "value": None,
                "status": "error",
                "error_message": str(exc),
                "as_of_utc": "",
                "aux": {"trend": "n/a", "central_bank": CENTRAL_BANK_LABELS.get(currency, currency)},
            }

    def fetch_inflation_rows(self) -> list[dict]:
        if not self._enabled or self._client is None:
            return []
        rows: list[dict] = []
        for currency, primary_series in FRED_CPI_INDEX_SERIES.items():
            rows.append(self._fetch_inflation_one(currency, primary_series))
        return rows

    def _fetch_inflation_one(self, currency: str, primary_series: str) -> dict:
        candidates = [primary_series] + list(FRED_CPI_FALLBACK_SERIES.get(currency, []))
        result: dict = {
            "currency": currency,
            "series_id": primary_series,
            "value": None,
            "status": "error",
            "error_message": "No candidate series available.",
            "as_of_utc": "",
            "aux": {"yoy": None, "mom": None, "central_bank": CENTRAL_BANK_LABELS.get(currency, currency)},
        }
        for series_id in candidates:
            result = self._try_fetch_inflation_series(currency, series_id)
            if result.get("status") == "ok":
                return result
        return result

    def _try_fetch_inflation_series(self, currency: str, series_id: str) -> dict:
        try:
            series = self._client.get_series(series_id)  # type: ignore[union-attr]
            series = series.dropna().tail(18)
            if len(series) < 13:
                raise ValueError("Insufficient CPI history for YoY/MoM")
            latest = float(series.iloc[-1])
            prev_month = float(series.iloc[-2])
            prev_year = float(series.iloc[-13])
            yoy = ((latest / prev_year) - 1.0) * 100.0
            mom = ((latest / prev_month) - 1.0) * 100.0
            as_of = pd.to_datetime(series.index[-1]).tz_localize("UTC").isoformat()
            return {
                "currency": currency,
                "series_id": series_id,
                "value": latest,
                "status": "ok",
                "error_message": "",
                "as_of_utc": as_of,
                "aux": {
                    "yoy": round(float(yoy), 4),
                    "mom": round(float(mom), 4),
                    "central_bank": CENTRAL_BANK_LABELS.get(currency, currency),
                },
            }
        except Exception as exc:
            return {
                "currency": currency,
                "series_id": series_id,
                "value": None,
                "status": "error",
                "error_message": str(exc),
                "as_of_utc": "",
                "aux": {"yoy": None, "mom": None, "central_bank": CENTRAL_BANK_LABELS.get(currency, currency)},
            }

    def to_policy_maps(self, rows: list[dict]) -> tuple[dict[str, float], dict[str, str]]:
        latest: dict[str, float] = {}
        trend: dict[str, str] = {}
        for row in rows:
            if str(row.get("status", "")).lower() != "ok":
                continue
            currency = str(row.get("currency", "")).upper()
            if currency:
                latest[currency] = float(row.get("value"))
                trend[currency] = str(row.get("aux", {}).get("trend", "Flat"))
        return latest, trend

    def to_policy_detail_map(self, rows: list[dict]) -> dict[str, dict]:
        details: dict[str, dict] = {}
        for row in rows:
            currency = str(row.get("currency", "")).upper()
            if not currency:
                continue
            aux = row.get("aux", {}) or {}
            value_raw = row.get("value")
            details[currency] = {
                "currency": currency,
                "series_id": str(row.get("series_id", "")),
                "value": None if value_raw is None else float(value_raw),
                "as_of_utc": str(row.get("as_of_utc", "")),
                "trend": str(aux.get("trend", "n/a")),
                "status": str(row.get("status", "error")).lower(),
                "error_message": str(row.get("error_message", "")),
            }
        return details

    def to_inflation_map(self, rows: list[dict], mode: str = "yoy") -> dict[str, float]:
        token = str(mode or "yoy").strip().lower()
        if token not in {"yoy", "mom"}:
            token = "yoy"
        out: dict[str, float] = {}
        for row in rows:
            if str(row.get("status", "")).lower() != "ok":
                continue
            currency = str(row.get("currency", "")).upper()
            val = row.get("aux", {}).get(token)
            if currency and val is not None:
                out[currency] = float(val)
        return out

    def to_inflation_yoy_map(self, rows: list[dict]) -> dict[str, float]:
        return self.to_inflation_map(rows, mode="yoy")
