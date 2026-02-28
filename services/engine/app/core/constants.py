from __future__ import annotations

from pathlib import Path

SCHEMA_VERSION = "1.0.0"
API_PREFIX = "/v1"

APP_NAME = "fxfr-engine"
APP_VERSION = "0.1.0"

DISPLAY_TZ_DEFAULT = "Asia/Jakarta"
SERVER_TZ_DEFAULT = "Asia/Gaza"
STORAGE_TZ = "UTC"

PRICE_READY_HOURS = 2.0
PRICE_WARN_HOURS = 6.0
CAL_READY_HOURS = 24.0
CAL_WARN_HOURS = 72.0
MACRO_READY_HOURS = 24.0 * 7.0
MACRO_WARN_HOURS = 24.0 * 30.0

AUTO_FETCH_DELAY_MINUTES = 5
AUTO_FETCH_GAP_WARN_COUNT = 2

DEFAULT_WORKER_POOL_SIZE = 2

FRED_POLICY_SERIES: dict[str, str] = {
    "USD": "FEDFUNDS",
    "EUR": "ECBDFR",
    "JPY": "IRSTCI01JPM156N",
    "GBP": "BOERUKM",
    "AUD": "IR3TBB01AUM156N",
    "CAD": "IRSTCB01CAM156N",
}

FRED_CPI_INDEX_SERIES: dict[str, str] = {
    "USD": "CPIAUCSL",
    "EUR": "CP0000EZ19M086NEST",
    "JPY": "JPNCPIALLMINMEI",
    "GBP": "GBRCPIALLMINMEI",
    "AUD": "AUSCPIALLMINMEI",
    "CAD": "CANCPIALLMINMEI",
}

FRED_CPI_FALLBACK_SERIES: dict[str, list[str]] = {
    "AUD": [],
}

CENTRAL_BANK_LABELS: dict[str, str] = {
    "USD": "Federal Reserve",
    "EUR": "European Central Bank",
    "JPY": "Bank of Japan",
    "GBP": "Bank of England",
    "AUD": "Reserve Bank of Australia",
    "CAD": "Bank of Canada",
}


def resolve_data_root(explicit: str | None = None) -> Path:
    if explicit:
        return Path(explicit).expanduser().resolve()
    appdata = Path.home()
    try:
        import os

        raw = os.getenv("APPDATA")
        if raw:
            appdata = Path(raw)
    except Exception:
        pass
    return (appdata / "FxFundamentalRefresher").resolve()
