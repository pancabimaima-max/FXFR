from __future__ import annotations

import asyncio
import sys
import traceback
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import router as v1_router
from app.core.config import get_settings
from app.core.logging_setup import close_logging, setup_logging, write_crash_dump
from app.core.runtime import new_trace_id
from app.core.security import create_session_token
from app.db.database import Database
from app.services.backup_service import run_backup, should_run_backup
from app.services.event_bus import EventBus
from app.services.logging_service import LoggingService
from app.services.state_service import StateService
from app.workers.job_manager import JobManager


def _install_crash_hook(crash_dir: Path, logger_service: LoggingService) -> None:
    def _hook(exc_type, exc_value, exc_tb):
        tb = "".join(traceback.format_exception(exc_type, exc_value, exc_tb))
        path = write_crash_dump(
            crash_dir=crash_dir,
            exc_type=getattr(exc_type, "__name__", str(exc_type)),
            message=str(exc_value),
            traceback_text=tb,
            context={"component": "engine"},
        )
        logger_service.write("ERROR", "Unhandled exception captured.", {"crash_dump": str(path)})

    sys.excepthook = _hook


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="FXFR Engine", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_allow_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    settings.data_root_path.mkdir(parents=True, exist_ok=True)
    settings.log_dir.mkdir(parents=True, exist_ok=True)
    settings.crash_dir.mkdir(parents=True, exist_ok=True)
    settings.parquet_dir.mkdir(parents=True, exist_ok=True)

    logger = setup_logging(settings.log_dir, settings.log_max_bytes, settings.log_backup_count)
    db = Database(settings.db_path)
    db.initialize()
    state_service = StateService(db)
    persisted_fred_api_key = state_service.load_fred_api_key()
    if not str(settings.fred_api_key or "").strip() and persisted_fred_api_key:
        settings.fred_api_key = persisted_fred_api_key

    logger_service = LoggingService(logger, db)
    event_bus = EventBus()

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

    def _on_job_update(record) -> None:
        loop = getattr(app.state, "event_loop", None)
        bus = getattr(app.state, "event_bus", None)
        if loop is None or bus is None:
            return
        if loop.is_closed():
            return

        payload = _event_payload(
            "job.progress",
            {
                "job_id": record.job_id,
                "name": record.name,
                "status": record.status,
                "progress": record.progress,
                "message": record.message,
                "error": record.error,
                "cancel_requested": record.cancel_requested,
                "updated_at_utc": record.updated_at_utc,
            },
        )

        try:
            future = asyncio.run_coroutine_threadsafe(bus.broadcast("job.progress", payload), loop)

            def _consume_future_error(done_future):
                try:
                    done_future.result()
                except Exception:
                    return

            future.add_done_callback(_consume_future_error)
        except Exception:
            return

    jobs = JobManager(max_workers=int(settings.worker_pool_size), on_update=_on_job_update)

    app.state.session_token = create_session_token()
    app.state.event_bus = event_bus
    app.state.event_loop = None
    app.state.services = {
        "settings": settings,
        "db": db,
        "state": state_service,
        "logger_service": logger_service,
        "jobs": jobs,
    }

    _install_crash_hook(settings.crash_dir, logger_service)
    logger_service.write(
        "INFO",
        "Engine booted.",
        {
            "data_root": str(settings.data_root_path),
            "macro_enabled": settings.macro_enabled,
            "worker_pool_size": settings.worker_pool_size,
        },
    )

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        _app.state.event_loop = asyncio.get_running_loop()
        runtime = state_service.load_runtime_state()
        if not runtime.display_timezone:
            db.set_setting("display_timezone", settings.ui_timezone_default)
        if not runtime.server_timezone:
            db.set_setting("server_timezone", settings.server_timezone_default)
        if not str(db.get_setting("release_channel", "") or "").strip():
            db.set_setting("release_channel", "stable")
        last_backup_utc = str(db.get_setting("last_backup_utc", ""))
        if should_run_backup(last_backup_utc):
            backup_path = run_backup(settings.data_root_path, keep_last=14)
            db.set_setting("last_backup_utc", datetime.now(timezone.utc).isoformat(timespec="seconds"))
            logger_service.write("INFO", "Daily backup completed.", {"backup_path": str(backup_path)})
        try:
            yield
        finally:
            jobs.shutdown(wait=False, cancel_futures=True)
            close_logging(logger)

    app.router.lifespan_context = lifespan

    @app.middleware("http")
    async def trace_middleware(request: Request, call_next: Callable):
        request.state.trace_id = request.headers.get("x-trace-id", "") or new_trace_id()
        response = await call_next(request)
        response.headers["x-trace-id"] = str(request.state.trace_id)
        return response

    @app.middleware("http")
    async def localhost_guard(request: Request, call_next: Callable):
        host = request.client.host if request.client else ""
        allowed_hosts = {"127.0.0.1", "::1", "localhost"}
        if settings.allow_test_client_host and settings.environment.lower() == "test":
            allowed_hosts.add("testclient")
        if host not in allowed_hosts:
            return JSONResponse(status_code=403, content={"error": "Localhost access only."})
        return await call_next(request)

    @app.websocket("/ws/events")
    async def ws_events(websocket: WebSocket):
        token = str(websocket.query_params.get("token", "")).strip()
        if token != str(app.state.session_token):
            await websocket.close(code=1008)
            return

        bus: EventBus = app.state.event_bus
        await bus.connect(websocket)
        await websocket.send_json(
            {
                "schema_version": "1.0.0",
                "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "trace_id": new_trace_id(),
                "event_name": "job.progress",
                "payload": _event_payload("job.progress", {"message": "Connected to event stream."}),
            }
        )
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            await bus.disconnect(websocket)
        except Exception:
            await bus.disconnect(websocket)

    app.include_router(v1_router)
    return app


app = create_app()
