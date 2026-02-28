from __future__ import annotations

from dataclasses import dataclass

from app.core.constants import DISPLAY_TZ_DEFAULT, SERVER_TZ_DEFAULT
from app.db.database import Database


_ALLOWED_RELEASE_CHANNELS = {"stable", "beta"}


def _normalize_release_channel(value: str | None, default: str = "stable") -> str:
    token = str(value or "").strip().lower()
    if token in _ALLOWED_RELEASE_CHANNELS:
        return token
    return default


@dataclass
class RuntimeState:
    first_launch_complete: bool
    mt5_folder: str
    display_timezone: str
    server_timezone: str
    top_pairs: list[str]
    release_channel: str


class StateService:
    def __init__(self, db: Database):
        self._db = db

    def load_runtime_state(self) -> RuntimeState:
        return RuntimeState(
            first_launch_complete=bool(self._db.get_setting("first_launch_complete", False)),
            mt5_folder=str(self._db.get_setting("mt5_folder", "")),
            display_timezone=str(self._db.get_setting("display_timezone", DISPLAY_TZ_DEFAULT)),
            server_timezone=str(self._db.get_setting("server_timezone", SERVER_TZ_DEFAULT)),
            top_pairs=list(self._db.get_setting("top_pairs", [])),
            release_channel=_normalize_release_channel(
                self._db.get_setting("release_channel", "stable"),
                default="stable",
            ),
        )

    def save_wizard(self, mt5_folder: str, top_pairs: list[str]) -> None:
        self._db.set_setting("first_launch_complete", True)
        self._db.set_setting("mt5_folder", mt5_folder)
        self._db.set_setting("top_pairs", [str(x).upper() for x in top_pairs])

    def save_fred_api_key(self, fred_api_key: str) -> None:
        self._db.set_setting("fred_api_key", str(fred_api_key or "").strip())

    def load_fred_api_key(self) -> str:
        return str(self._db.get_setting("fred_api_key", "") or "").strip()

    def set_mt5_folder(self, mt5_folder: str) -> None:
        self._db.set_setting("mt5_folder", str(mt5_folder or "").strip())

    def set_first_launch_complete(self, complete: bool = True) -> None:
        self._db.set_setting("first_launch_complete", bool(complete))

    def set_release_channel(self, channel: str) -> str:
        normalized = _normalize_release_channel(channel, default="stable")
        self._db.set_setting("release_channel", normalized)
        return normalized

    def apply_timezone(self, display_timezone: str, server_timezone: str) -> dict:
        self._db.set_setting("display_timezone", display_timezone)
        self._db.set_setting("server_timezone", server_timezone)
        return {"display_timezone": display_timezone, "server_timezone": server_timezone}
