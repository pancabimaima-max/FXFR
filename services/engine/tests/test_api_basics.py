from __future__ import annotations

import os
import tempfile
import time
import unittest
from pathlib import Path
import sys

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


def _build_client(tmp_path: Path, fred_key: str = "") -> TestClient:
    os.environ["DATA_ROOT"] = str(tmp_path)
    os.environ["FRED_API_KEY"] = fred_key
    os.environ["ENVIRONMENT"] = "test"
    os.environ["ALLOW_TEST_CLIENT_HOST"] = "1"
    os.environ["ALLOWED_ORIGINS"] = "http://localhost:5173,http://127.0.0.1:5173,http://localhost,http://127.0.0.1,tauri://localhost"
    get_settings.cache_clear()
    app = create_app()
    return TestClient(app)


def _seed_policy_snapshot(client: TestClient) -> None:
    db = client.app.state.services["db"]
    db.replace_macro_snapshot(
        "policy",
        [
            {
                "currency": "EUR",
                "series_id": "ECBDFR",
                "value": 3.0,
                "status": "ok",
                "error_message": "",
                "as_of_utc": "2026-02-26T00:00:00+00:00",
                "aux": {"trend": "Rising"},
            },
            {
                "currency": "USD",
                "series_id": "FEDFUNDS",
                "value": 5.0,
                "status": "ok",
                "error_message": "",
                "as_of_utc": "2026-02-26T00:00:00+00:00",
                "aux": {"trend": "Flat"},
            },
            {
                "currency": "JPY",
                "series_id": "IRSTCI01JPM156N",
                "value": 0.1,
                "status": "ok",
                "error_message": "",
                "as_of_utc": "2026-02-26T00:00:00+00:00",
                "aux": {"trend": "Falling"},
            },
        ],
    )
    db.set_setting("macro_last_refresh_utc", "2026-02-26T00:00:00+00:00")



class EngineApiBasicTests(unittest.TestCase):
    def test_health_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp)) as client:
                resp = client.get("/v1/health")
                self.assertEqual(resp.status_code, 200)
                payload = resp.json()
                self.assertEqual(payload["data"]["status"], "ok")
                self.assertEqual(payload["meta"]["schema_version"], "1.0.0")

    def test_bootstrap_and_auth_guard(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp)) as client:
                bootstrap = client.get("/v1/bootstrap")
                self.assertEqual(bootstrap.status_code, 200)
                token = bootstrap.json()["data"]["session_token"]
                denied = client.get("/v1/config/runtime")
                self.assertEqual(denied.status_code, 401)
                ok = client.get("/v1/config/runtime", headers={"x-session-token": token})
                self.assertEqual(ok.status_code, 200)

    def test_macro_disabled_when_fred_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.post("/v1/fred/refresh", headers={"x-session-token": token})
                self.assertEqual(resp.status_code, 200)
                body = resp.json()["data"]
                self.assertFalse(body["accepted"])
                self.assertFalse(body["macro_enabled"])

    def test_wizard_fred_key_persists_across_restart(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)

            with _build_client(tmp_path, fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                setup = client.post(
                    "/v1/wizard/setup",
                    headers={"x-session-token": token},
                    json={
                        "mt5_folder": "C:\\MetaQuotes\\Terminal\\Common\\Files",
                        "top_pairs": ["EURUSD", "USDJPY"],
                        "fred_api_key": "persisted-test-key",
                    },
                )
                self.assertEqual(setup.status_code, 200)

            with _build_client(tmp_path, fred_key="") as restarted:
                bootstrap = restarted.get("/v1/bootstrap")
                self.assertEqual(bootstrap.status_code, 200)
                self.assertTrue(bootstrap.json()["data"]["macro_enabled"])

                token = bootstrap.json()["data"]["session_token"]
                runtime = restarted.get("/v1/config/runtime", headers={"x-session-token": token})
                self.assertEqual(runtime.status_code, 200)
                self.assertTrue(runtime.json()["data"]["fred_key_configured"])

    def test_runtime_config_apply_updates_folder_and_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with _build_client(tmp_path, fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]

                apply_resp = client.post(
                    "/v1/config/runtime/apply",
                    headers={"x-session-token": token},
                    json={
                        "mt5_folder": r"C:\\MetaQuotes\\Terminal\\Common\\Files",
                        "fred_api_key": "runtime-test-key",
                        "release_channel": "beta",
                    },
                )
                self.assertEqual(apply_resp.status_code, 200)
                self.assertTrue(apply_resp.json()["data"]["macro_enabled"])
                self.assertEqual(apply_resp.json()["data"]["release_channel"], "beta")

                runtime = client.get("/v1/config/runtime", headers={"x-session-token": token})
                self.assertEqual(runtime.status_code, 200)
                data = runtime.json()["data"]
                self.assertEqual(data["mt5_folder"], r"C:\\MetaQuotes\\Terminal\\Common\\Files")
                self.assertTrue(data["fred_key_configured"])
                self.assertEqual(data["release_channel"], "beta")
                self.assertIn("latest-beta.json", data["release_manifest_url"])

            with _build_client(tmp_path, fred_key="") as restarted:
                bootstrap = restarted.get("/v1/bootstrap")
                self.assertEqual(bootstrap.status_code, 200)
                self.assertTrue(bootstrap.json()["data"]["macro_enabled"])

                token = bootstrap.json()["data"]["session_token"]
                runtime = restarted.get("/v1/config/runtime", headers={"x-session-token": token})
                self.assertEqual(runtime.status_code, 200)
                self.assertEqual(runtime.json()["data"]["release_channel"], "beta")

    def test_checklist_overview_has_extended_fields(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.get("/v1/checklist/overview", headers={"x-session-token": token})
                self.assertEqual(resp.status_code, 200)
                data = resp.json()["data"]
                self.assertIn("total_score", data)
                self.assertIn("freshness_timeline", data)
                self.assertIn("market_session", data)
                self.assertIn("auto_fetch_status", data)
                market_session = data["market_session"]
                self.assertIn("weekday", market_session)
                self.assertIn("local_clock_display", market_session)
                self.assertIn("market_status", market_session)
                self.assertIn("status_text", market_session)
                self.assertIn("closed_until_utc", market_session)
                self.assertIn("closed_until_local", market_session)

    def test_autofetch_apply_sync_endpoint(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with _build_client(tmp_path, fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.post(
                    "/v1/autofetch/apply-sync",
                    headers={"x-session-token": token},
                    json={
                        "section": "full",
                        "enabled": True,
                        "mt5_folder": str(tmp_path),
                        "price_pattern": "*h1*.csv",
                        "calendar_pattern": "economic_calendar.csv",
                        "interval_hours": 1,
                    },
                )
                self.assertEqual(resp.status_code, 200)
                body = resp.json()["data"]
                self.assertTrue(body["saved"])
                self.assertIn("next_update_local", body)

    def test_fundamental_differential_identical_currency(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.get(
                    "/v1/fundamental/differential",
                    headers={"x-session-token": token},
                    params={"base": "USD", "quote": "USD", "inflation_mode": "yoy"},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()["data"]
                self.assertEqual(data["rate_differential"], 0.0)
                self.assertEqual(data["inflation_differential"], 0.0)


    def test_fundamental_differential_pair_query_precedence_and_rate_metric(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                _seed_policy_snapshot(client)

                resp = client.get(
                    "/v1/fundamental/differential",
                    headers={"x-session-token": token},
                    params={"base": "EUR", "quote": "USD", "pair": "USDJPY", "inflation_mode": "yoy"},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()["data"]

                self.assertEqual(data["active_pair"], "USDJPY")
                self.assertEqual(data["pair_source"], "query")
                self.assertEqual(data["base"], "USD")
                self.assertEqual(data["quote"], "JPY")
                self.assertIn("rate_metric", data)
                self.assertEqual(data["rate_metric"]["unit"], "pp")
                self.assertIn("tooltip", data["rate_metric"])
                self.assertIn("detail", data["rate_metric"])
                self.assertIn("source_series_ids", data["rate_metric"]["detail"])

    def test_fundamental_differential_fallback_pair_resolution(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                _seed_policy_snapshot(client)

                resp = client.get(
                    "/v1/fundamental/differential",
                    headers={"x-session-token": token},
                    params={"base": "E", "quote": "U", "inflation_mode": "yoy"},
                )
                self.assertEqual(resp.status_code, 200)
                data = resp.json()["data"]
                self.assertEqual(data["pair_source"], "fallback")
                self.assertEqual(data["active_pair"], "EURUSD")

    def test_async_price_ingest_job_lifecycle(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                csv_bytes = (
                    "Time,Open,High,Low,Close,Symbol\n"
                    "2026-02-26 10:00:00,1.1000,1.1010,1.0990,1.1005,EURUSD\n"
                    "2026-02-26 11:00:00,1.1005,1.1020,1.1000,1.1015,EURUSD\n"
                ).encode("utf-8")

                start = client.post(
                    "/v1/ingest/price",
                    headers={"x-session-token": token},
                    params={"source_timezone": "UTC", "async_job": True},
                    files={"file": ("price.csv", csv_bytes, "text/csv")},
                )
                self.assertEqual(start.status_code, 200)
                data = start.json()["data"]
                self.assertTrue(data["accepted"])
                self.assertEqual(data["mode"], "async")
                job_id = str(data["job_id"])

                status = "queued"
                job_payload = {}
                for _ in range(40):
                    job = client.get(f"/v1/jobs/{job_id}", headers={"x-session-token": token})
                    self.assertEqual(job.status_code, 200)
                    job_payload = job.json()["data"]
                    status = str(job_payload.get("status", ""))
                    if status in {"completed", "failed", "cancelled"}:
                        break
                    time.sleep(0.05)

                self.assertIn(status, {"completed", "failed", "cancelled"})
                self.assertIn("progress", job_payload)
                self.assertGreaterEqual(float(job_payload.get("progress", 0.0)), 1.0)
                self.assertIn("cancel_requested", job_payload)
                if status == "failed":
                    self.assertTrue(str(job_payload.get("error", "")).strip())

                cancel_done = client.post(f"/v1/jobs/{job_id}/cancel", headers={"x-session-token": token})
                self.assertEqual(cancel_done.status_code, 200)

    def test_calendar_ingest_tolerates_bad_csv_rows(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                csv_bytes = (
                    "Time,Currency,Impact,Event,Actual,Forecast,Previous\n"
                    "2026-02-26 10:00:00,USD,High,CPI,2.9,3.0,3.1\n"
                    "2026-02-26 11:00:00,EUR,High,GDP,0.2,0.1,0.0,EXTRA\n"
                    "2026-02-26 12:00:00,JPY,Low,PMI,50.1,49.9,49.8\n"
                ).encode("utf-8")

                resp = client.post(
                    "/v1/ingest/calendar",
                    headers={"x-session-token": token},
                    params={"source_timezone": "UTC", "async_job": False},
                    files={"file": ("economic_calendar.csv", csv_bytes, "text/csv")},
                )
                self.assertEqual(resp.status_code, 200)

                meta = resp.json()["data"]["meta"]
                self.assertEqual(meta["mode"], "csv_tolerant")
                self.assertEqual(int(meta["bad_line_count"]), 1)
                self.assertEqual(int(meta["rows_loaded"]), 2)

    def test_swap_config_accepts_bounds(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                for value in (-1000.0, 0.0, 1000.0):
                    resp = client.post(
                        "/v1/swap-config",
                        headers={"x-session-token": token},
                        json={"symbol": "EURUSD", "swap_drag_bps": value},
                    )
                    self.assertEqual(resp.status_code, 200)
                    self.assertEqual(float(resp.json()["data"]["swap_drag_bps"]), value)

                read_back = client.get(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    params={"symbols_csv": "EURUSD"},
                )
                self.assertEqual(read_back.status_code, 200)
                rows = read_back.json()["data"]["rows"]
                self.assertEqual(len(rows), 1)
                self.assertEqual(rows[0]["symbol"], "EURUSD")
                self.assertEqual(float(rows[0]["swap_drag_bps"]), 1000.0)
                self.assertEqual(rows[0]["source"], "configured")

    def test_swap_config_rejects_out_of_range(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                for value in (-1000.01, 1000.01):
                    resp = client.post(
                        "/v1/swap-config",
                        headers={"x-session-token": token},
                        json={"symbol": "EURUSD", "swap_drag_bps": value},
                    )
                    self.assertEqual(resp.status_code, 422)

    def test_get_swap_config_returns_filtered_defaults(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]

                seed = client.post(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    json={"symbol": "EURUSD", "swap_drag_bps": 12.5},
                )
                self.assertEqual(seed.status_code, 200)

                resp = client.get(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    params={"symbols_csv": "EURUSD,USDJPY,EURUSD"},
                )
                self.assertEqual(resp.status_code, 200)
                rows = resp.json()["data"]["rows"]
                self.assertEqual([row["symbol"] for row in rows], ["EURUSD", "USDJPY"])
                self.assertEqual(rows[0]["source"], "configured")
                self.assertEqual(float(rows[0]["swap_drag_bps"]), 12.5)
                self.assertEqual(rows[1]["source"], "default_zero")
                self.assertEqual(float(rows[1]["swap_drag_bps"]), 0.0)

    def test_dashboard_cards_include_swap_drag_bps(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]

                csv_bytes = (
                    "Time,Open,High,Low,Close,Symbol\n"
                    "2026-02-26 10:00:00,1.1000,1.1010,1.0990,1.1005,EURUSD\n"
                    "2026-02-26 11:00:00,1.1005,1.1020,1.1000,1.1015,EURUSD\n"
                ).encode("utf-8")
                ingest = client.post(
                    "/v1/ingest/price",
                    headers={"x-session-token": token},
                    params={"source_timezone": "UTC", "async_job": False},
                    files={"file": ("price.csv", csv_bytes, "text/csv")},
                )
                self.assertEqual(ingest.status_code, 200)

                saved = client.post(
                    "/v1/swap-config",
                    headers={"x-session-token": token},
                    json={"symbol": "EURUSD", "swap_drag_bps": 11.25},
                )
                self.assertEqual(saved.status_code, 200)

                cards = client.get(
                    "/v1/dashboard/cards",
                    headers={"x-session-token": token},
                    params={"sort_by": "symbol_az", "card_limit": 50},
                )
                self.assertEqual(cards.status_code, 200)
                rows = cards.json()["data"]["cards"]
                eurusd = next((row for row in rows if row.get("symbol") == "EURUSD"), None)
                self.assertIsNotNone(eurusd)
                metrics = eurusd["metrics"]
                self.assertIn("swap_drag_bps", metrics)
                self.assertEqual(float(metrics["swap_drag_bps"]), 11.25)
                self.assertTrue(metrics.get("carry_estimator") is None or isinstance(metrics.get("carry_estimator"), (int, float)))

    def test_logs_source_both(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp), fred_key="") as client:
                token = client.get("/v1/bootstrap").json()["data"]["session_token"]
                resp = client.get(
                    "/v1/logs",
                    headers={"x-session-token": token},
                    params={"source": "both", "lookback_hours": 24, "limit": 100},
                )
                self.assertEqual(resp.status_code, 200)
                self.assertIn("rows", resp.json()["data"])

    def test_cors_preflight_allows_dev_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp)) as client:
                resp = client.options(
                    "/v1/bootstrap",
                    headers={
                        "Origin": "http://localhost:5173",
                        "Access-Control-Request-Method": "GET",
                    },
                )
                self.assertEqual(resp.status_code, 200)
                self.assertEqual(resp.headers.get("access-control-allow-origin"), "http://localhost:5173")

    def test_cors_preflight_rejects_unknown_origin(self):
        with tempfile.TemporaryDirectory() as tmp:
            with _build_client(Path(tmp)) as client:
                resp = client.options(
                    "/v1/bootstrap",
                    headers={
                        "Origin": "http://malicious.example",
                        "Access-Control-Request-Method": "GET",
                    },
                )
                self.assertEqual(resp.status_code, 400)
                self.assertIn("Disallowed CORS origin", resp.text)


if __name__ == "__main__":
    unittest.main()



