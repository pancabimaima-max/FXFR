from __future__ import annotations

import json
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from fastapi.testclient import TestClient
from jsonschema import Draft202012Validator, RefResolver

from app.core.config import get_settings
from app.main import create_app
from app.services.metrics_service import (
    compute_pair_differentials,
    pip_size_for_symbol,
    pip_value,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
SCHEMA_DIR = REPO_ROOT / "packages" / "contracts" / "schemas"
SNAPSHOT_DIR = Path(__file__).resolve().parent / "fixtures" / "snapshots"


def _build_client(tmp_path: Path, fred_key: str = "") -> TestClient:
    os.environ["DATA_ROOT"] = str(tmp_path)
    os.environ["FRED_API_KEY"] = fred_key
    os.environ["ENVIRONMENT"] = "test"
    os.environ["ALLOW_TEST_CLIENT_HOST"] = "1"
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173,http://localhost,http://127.0.0.1,tauri://localhost"
    get_settings.cache_clear()
    app = create_app()
    return TestClient(app)


def _assert_or_update_snapshot(snapshot_name: str, payload: dict) -> None:
    SNAPSHOT_DIR.mkdir(parents=True, exist_ok=True)
    path = SNAPSHOT_DIR / snapshot_name
    canonical = json.loads(json.dumps(payload, sort_keys=True))

    if os.getenv("UPDATE_SNAPSHOTS") == "1":
        path.write_text(json.dumps(canonical, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        raise AssertionError(f"Snapshot updated: {path}. Re-run tests without UPDATE_SNAPSHOTS=1.")

    if not path.exists():
        raise AssertionError(f"Missing snapshot fixture: {path}. Run once with UPDATE_SNAPSHOTS=1.")

    expected = json.loads(path.read_text(encoding="utf-8"))
    assert expected == canonical, f"Snapshot mismatch: {path}"


def _validate_schema(schema_filename: str, payload: dict) -> None:
    schema_path = SCHEMA_DIR / schema_filename
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    common_path = SCHEMA_DIR / "common.schema.json"
    common_schema = json.loads(common_path.read_text(encoding="utf-8"))

    store = {
        "common.schema.json": common_schema,
        str(common_schema.get("$id", "")): common_schema,
        common_path.resolve().as_uri(): common_schema,
    }

    resolver = RefResolver(
        base_uri=f"{SCHEMA_DIR.resolve().as_uri()}/",
        referrer=schema,
        store=store,
    )
    Draft202012Validator(schema=schema, resolver=resolver).validate(payload)


def _build_price_csv() -> bytes:
    lines = ["Time,Open,High,Low,Close,Symbol"]
    start = datetime(2026, 1, 1, 0, 0, 0)

    for i in range(20):
        t = start + timedelta(hours=i)
        open_px = 1.1000 + (i * 0.0002)
        high_px = open_px + 0.0008
        low_px = open_px - 0.0006
        close_px = open_px + (0.0001 if i % 2 == 0 else -0.0001)
        lines.append(f"{t:%Y-%m-%d %H:%M:%S},{open_px:.5f},{high_px:.5f},{low_px:.5f},{close_px:.5f},EURUSD")

    for i in range(20):
        t = start + timedelta(hours=i)
        open_px = 150.00 + (i * 0.03)
        high_px = open_px + 0.12
        low_px = open_px - 0.08
        close_px = open_px + (0.02 if i % 2 == 0 else -0.01)
        lines.append(f"{t:%Y-%m-%d %H:%M:%S},{open_px:.3f},{high_px:.3f},{low_px:.3f},{close_px:.3f},USDJPY")

    return ("\n".join(lines) + "\n").encode("utf-8")


def _seed_macro_snapshot(client: TestClient) -> None:
    db = client.app.state.services["db"]

    policy_rows = [
        {
            "currency": "EUR",
            "series_id": "ECBDFR",
            "value": 3.00,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"trend": "Rising", "central_bank": "ECB"},
        },
        {
            "currency": "USD",
            "series_id": "FEDFUNDS",
            "value": 5.00,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"trend": "Flat", "central_bank": "Federal Reserve"},
        },
        {
            "currency": "JPY",
            "series_id": "IRSTCI01JPM156N",
            "value": 0.10,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"trend": "Falling", "central_bank": "Bank of Japan"},
        },
    ]

    inflation_rows = [
        {
            "currency": "EUR",
            "series_id": "CP0000EZ19M086NEST",
            "value": 125.0,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"yoy": 2.10, "mom": 0.20, "central_bank": "ECB"},
        },
        {
            "currency": "USD",
            "series_id": "CPIAUCSL",
            "value": 310.0,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"yoy": 3.20, "mom": 0.30, "central_bank": "Federal Reserve"},
        },
        {
            "currency": "JPY",
            "series_id": "JPNCPIALLMINMEI",
            "value": 108.0,
            "status": "ok",
            "error_message": "",
            "as_of_utc": "2026-01-31T00:00:00+00:00",
            "aux": {"yoy": 1.00, "mom": 0.10, "central_bank": "Bank of Japan"},
        },
    ]

    db.replace_macro_snapshot("policy", policy_rows)
    db.replace_macro_snapshot("inflation", inflation_rows)


class ContractSnapshotTests(unittest.TestCase):
    def test_metrics_formula_snapshot_v1(self):
        policy_latest = {"EUR": 3.0, "USD": 5.0, "JPY": 0.1}
        policy_trend = {"EUR": "Rising", "USD": "Flat", "JPY": "Falling"}
        inflation_yoy = {"EUR": 2.1, "USD": 3.2, "JPY": 1.0}
        swap_map = {"EURUSD": 10.0}

        eurusd = compute_pair_differentials("EURUSD", policy_latest, policy_trend, inflation_yoy, swap_map)
        usdjpy = compute_pair_differentials("USDJPY", policy_latest, policy_trend, inflation_yoy, swap_map)

        payload = {
            "pip_size": {
                "EURUSD": pip_size_for_symbol("EURUSD"),
                "USDJPY": pip_size_for_symbol("USDJPY"),
            },
            "pip_value": {
                "EURUSD": round(float(pip_value("EURUSD", 0.0014) or 0.0), 4),
                "USDJPY": round(float(pip_value("USDJPY", 0.20) or 0.0), 4),
            },
            "differentials": {
                "EURUSD": {
                    "rate_diff": round(float(eurusd.rate_diff), 2) if eurusd.rate_diff is not None else None,
                    "rate_trend": eurusd.rate_trend,
                    "inflation_diff": round(float(eurusd.inflation_diff), 2) if eurusd.inflation_diff is not None else None,
                    "carry_estimator": round(float(eurusd.carry_estimator), 2) if eurusd.carry_estimator is not None else None,
                    "strength_meter": round(float(eurusd.strength_meter), 4) if eurusd.strength_meter is not None else None,
                },
                "USDJPY": {
                    "rate_diff": round(float(usdjpy.rate_diff), 2) if usdjpy.rate_diff is not None else None,
                    "rate_trend": usdjpy.rate_trend,
                    "inflation_diff": round(float(usdjpy.inflation_diff), 2) if usdjpy.inflation_diff is not None else None,
                    "carry_estimator": round(float(usdjpy.carry_estimator), 2) if usdjpy.carry_estimator is not None else None,
                    "strength_meter": round(float(usdjpy.strength_meter), 4) if usdjpy.strength_meter is not None else None,
                },
            },
        }

        _assert_or_update_snapshot("metrics_formula.v1.json", payload)

    def test_dashboard_cards_contract_snapshot_v1(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="test-key") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]

                ingest = client.post(
                    "/v1/ingest/price",
                    headers={"x-session-token": token},
                    params={"source_timezone": "UTC", "async_job": False},
                    files={"file": ("price.csv", _build_price_csv(), "text/csv")},
                )
                self.assertEqual(ingest.status_code, 200)

                _seed_macro_snapshot(client)

                set_swap = client.post(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    json={"symbol": "EURUSD", "swap_drag_bps": 10.0},
                )
                self.assertEqual(set_swap.status_code, 200)

                resp = client.get(
                    "/v1/dashboard/cards",
                    headers={"x-session-token": token},
                    params={"sort_by": "symbol_az", "card_limit": 50, "inflation_mode": "yoy"},
                )
                self.assertEqual(resp.status_code, 200)
                payload = resp.json()["data"]
                payload["cards"] = sorted(payload.get("cards", []), key=lambda row: str(row.get("symbol", "")))

                _assert_or_update_snapshot("dashboard_cards.v1.json", payload)

    def test_dashboard_cards_schema_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="test-key") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]

                ingest = client.post(
                    "/v1/ingest/price",
                    headers={"x-session-token": token},
                    params={"source_timezone": "UTC", "async_job": False},
                    files={"file": ("price.csv", _build_price_csv(), "text/csv")},
                )
                self.assertEqual(ingest.status_code, 200)

                _seed_macro_snapshot(client)
                client.post(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    json={"symbol": "EURUSD", "swap_drag_bps": 10.0},
                )

                resp = client.get(
                    "/v1/dashboard/cards",
                    headers={"x-session-token": token},
                    params={"sort_by": "symbol_az", "card_limit": 50},
                )
                self.assertEqual(resp.status_code, 200)
                _validate_schema("dashboard-cards.response.schema.json", resp.json())

    def test_checklist_overview_schema_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.get("/v1/checklist/overview", headers={"x-session-token": token})
                self.assertEqual(resp.status_code, 200)
                _validate_schema("checklist-overview.response.schema.json", resp.json())


    def test_fundamental_differential_schema_validation(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="test-key") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                _seed_macro_snapshot(client)

                resp = client.get(
                    "/v1/fundamental/differential",
                    headers={"x-session-token": token},
                    params={"pair": "USDJPY", "inflation_mode": "yoy"},
                )
                self.assertEqual(resp.status_code, 200)
                _validate_schema("fundamental-differential.response.schema.json", resp.json())


if __name__ == "__main__":
    unittest.main()