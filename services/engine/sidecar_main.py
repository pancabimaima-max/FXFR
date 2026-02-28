from __future__ import annotations

import os

import uvicorn


def _env_int(name: str, default: int) -> int:
    raw = str(os.getenv(name, "")).strip()
    if not raw:
        return int(default)
    try:
        return int(raw)
    except ValueError:
        return int(default)


def main() -> None:
    host = str(os.getenv("HOST", "127.0.0.1") or "127.0.0.1")
    port = _env_int("PORT", 8765)
    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=False,
        workers=1,
    )


if __name__ == "__main__":
    main()
