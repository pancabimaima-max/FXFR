from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from .constants import SCHEMA_VERSION


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_trace_id() -> str:
    return uuid4().hex


def response_meta(trace_id: str | None = None) -> dict:
    return {
        "schema_version": SCHEMA_VERSION,
        "timestamp_utc": utc_now_iso(),
        "trace_id": trace_id or new_trace_id(),
    }
