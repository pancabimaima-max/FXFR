from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

from app.core.constants import SCHEMA_VERSION


class ErrorObject(BaseModel):
    code: str
    message: str
    recoverable: bool = True
    context: dict[str, Any] = Field(default_factory=dict)


class ResponseMeta(BaseModel):
    schema_version: str = SCHEMA_VERSION
    timestamp_utc: datetime
    trace_id: str


T = TypeVar("T")


class Envelope(BaseModel, Generic[T]):
    meta: ResponseMeta
    data: T
    error: ErrorObject | None = None

