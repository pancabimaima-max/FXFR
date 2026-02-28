from __future__ import annotations

from pathlib import Path
from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

from .constants import (
    DEFAULT_WORKER_POOL_SIZE,
    DISPLAY_TZ_DEFAULT,
    SERVER_TZ_DEFAULT,
    resolve_data_root,
)


DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost",
    "http://127.0.0.1",
    "tauri://localhost",
]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_ignore_empty=True, extra="ignore")

    environment: str = "dev"
    host: str = "127.0.0.1"
    port: int = 8765

    data_root: str = Field(default_factory=lambda: str(resolve_data_root()))
    ui_timezone_default: str = DISPLAY_TZ_DEFAULT
    server_timezone_default: str = SERVER_TZ_DEFAULT

    worker_pool_size: int = DEFAULT_WORKER_POOL_SIZE
    fred_api_key: str = ""
    allow_test_client_host: bool = False
    allowed_origins: str = ",".join(DEFAULT_ALLOWED_ORIGINS)

    releases_base_url: str = "https://github.com/fyodor/fxfr_desktop/releases"

    log_max_bytes: int = 10 * 1024 * 1024
    log_backup_count: int = 10

    @property
    def data_root_path(self) -> Path:
        return Path(self.data_root).expanduser().resolve()

    @property
    def db_path(self) -> Path:
        return self.data_root_path / "db" / "engine.db"

    @property
    def log_dir(self) -> Path:
        return self.data_root_path / "logs"

    @property
    def crash_dir(self) -> Path:
        return self.data_root_path / "crash"

    @property
    def parquet_dir(self) -> Path:
        return self.data_root_path / "parquet"

    @property
    def cors_allow_origins(self) -> list[str]:
        parsed = [entry.strip() for entry in str(self.allowed_origins or "").split(",") if entry.strip()]
        return parsed if parsed else list(DEFAULT_ALLOWED_ORIGINS)

    @property
    def macro_enabled(self) -> bool:
        return bool(str(self.fred_api_key or "").strip())

    @property
    def macro_disabled_reason(self) -> str:
        if self.macro_enabled:
            return ""
        return "FRED API key missing. Macro modules are disabled."


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
