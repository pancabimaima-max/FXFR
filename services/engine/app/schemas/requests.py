from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TimezoneApplyRequest(BaseModel):
    display_timezone: str = Field(min_length=1)
    server_timezone: str = Field(min_length=1)


class WizardSetupRequest(BaseModel):
    mt5_folder: str = ""
    top_pairs: list[str] = Field(default_factory=list)
    fred_api_key: str = ""


class RuntimeConfigApplyRequest(BaseModel):
    mt5_folder: str = ""
    fred_api_key: str | None = None
    release_channel: Literal["stable", "beta"] | None = None


class AutoFetchApplyRequest(BaseModel):
    section: str = "full"
    enabled: bool = True
    mt5_folder: str = ""
    price_pattern: str = "*h1*.csv"
    calendar_pattern: str = "economic_calendar.csv"
    interval_hours: int = 1


class PromoteMetricRequest(BaseModel):
    metric_key: str = Field(min_length=1)
    version_tag: str = Field(min_length=1)


class LogsQuery(BaseModel):
    levels: list[str] = Field(default_factory=lambda: ["WARN", "ERROR"])
    lookback_hours: int = 24
    limit: int = 1000


class SwapConfigRequest(BaseModel):
    symbol: str = Field(min_length=1)
    swap_drag_bps: float = Field(default=0.0, ge=-1000.0, le=1000.0)
