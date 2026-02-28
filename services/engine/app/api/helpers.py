from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import Request

from app.schemas.common import Envelope, ErrorObject, ResponseMeta


def _trace_id_from_request(request: Request) -> str:
    raw = str(getattr(request.state, "trace_id", "") or "").strip()
    if raw:
        return raw
    return "trace-missing"


def envelope(request: Request, data: Any, error: ErrorObject | None = None) -> Envelope:
    return Envelope(
        meta=ResponseMeta(
            schema_version="1.0.0",
            timestamp_utc=datetime.now(timezone.utc),
            trace_id=_trace_id_from_request(request),
        ),
        data=data,
        error=error,
    )

