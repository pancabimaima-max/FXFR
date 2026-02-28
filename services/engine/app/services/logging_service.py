from __future__ import annotations

import logging
from typing import Any

from app.db.database import Database


class LoggingService:
    def __init__(self, logger: logging.Logger, db: Database):
        self._logger = logger
        self._db = db

    def write(self, level: str, message: str, context: dict[str, Any] | None = None) -> None:
        level_norm = str(level).upper()
        payload = context or {}
        if level_norm == "ERROR":
            self._logger.error("%s | context=%s", message, payload)
        elif level_norm == "WARN":
            self._logger.warning("%s | context=%s", message, payload)
        elif level_norm == "DEBUG":
            self._logger.debug("%s | context=%s", message, payload)
        else:
            self._logger.info("%s | context=%s", message, payload)
        self._db.add_log(level_norm, message, payload)

