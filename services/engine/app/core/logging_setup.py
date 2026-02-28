from __future__ import annotations

import json
import logging
import sys
from datetime import datetime, timezone
from logging.handlers import RotatingFileHandler
from pathlib import Path


def setup_logging(log_dir: Path, max_bytes: int, backup_count: int) -> logging.Logger:
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("fxfr-engine")
    logger.setLevel(logging.INFO)
    for handler in list(logger.handlers):
        try:
            handler.flush()
            handler.close()
        finally:
            logger.removeHandler(handler)

    formatter = logging.Formatter("%(asctime)s | %(levelname)s | %(message)s")

    file_handler = RotatingFileHandler(
        log_dir / "engine.log",
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)

    stream_handler = logging.StreamHandler(sys.stdout)
    stream_handler.setFormatter(formatter)
    logger.addHandler(stream_handler)

    logger.propagate = False
    return logger


def close_logging(logger: logging.Logger) -> None:
    for handler in list(logger.handlers):
        try:
            handler.flush()
            handler.close()
        finally:
            logger.removeHandler(handler)


def redact_payload(payload: dict) -> dict:
    redacted: dict = {}
    sensitive = {"token", "password", "secret", "api_key", "authorization"}
    for key, value in payload.items():
        if any(s in key.lower() for s in sensitive):
            redacted[key] = "***REDACTED***"
        else:
            redacted[key] = value
    return redacted


def write_crash_dump(crash_dir: Path, exc_type: str, message: str, traceback_text: str, context: dict) -> Path:
    crash_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = crash_dir / f"crash-{ts}.json"
    payload = {
        "timestamp_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "exception_type": exc_type,
        "message": message,
        "traceback": traceback_text,
        "context": redact_payload(context),
    }
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return out_path
