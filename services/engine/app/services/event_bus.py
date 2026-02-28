from __future__ import annotations

import asyncio
from typing import Any

from fastapi import WebSocket

from app.core.runtime import new_trace_id, utc_now_iso
from app.core.constants import SCHEMA_VERSION


class EventBus:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            if websocket in self._connections:
                self._connections.remove(websocket)

    async def broadcast(self, event_name: str, payload: dict[str, Any] | None = None, trace_id: str | None = None) -> None:
        event = {
            "schema_version": SCHEMA_VERSION,
            "timestamp_utc": utc_now_iso(),
            "trace_id": trace_id or new_trace_id(),
            "event_name": event_name,
            "payload": payload or {},
        }
        async with self._lock:
            targets = list(self._connections)
        dead: list[WebSocket] = []
        for ws in targets:
            try:
                await ws.send_json(event)
            except Exception:
                dead.append(ws)
        if dead:
            async with self._lock:
                for ws in dead:
                    self._connections.discard(ws)

