from __future__ import annotations

from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, Field

SCHEMA_VERSION = "1.0.0"


class EnvelopeMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=SCHEMA_VERSION)
    timestamp_utc: datetime
    trace_id: str


class ApiError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str
    message: str
    recoverable: bool
    context: dict[str, Any] = Field(default_factory=dict)


T = TypeVar("T")


class ResponseEnvelope(BaseModel, Generic[T]):
    model_config = ConfigDict(extra="forbid")

    meta: EnvelopeMeta
    data: T
    error: ApiError | None = None


class ChecklistSection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    state: Literal["ready", "warn", "error"]
    score: float
    detail: str


class ChecklistAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    done: bool
    text: str


class FreshnessPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    section: str
    state: Literal["ready", "warn", "error"]
    timestamp_utc: str
    timestamp_local: str
    age_text: str


class ChecklistOverviewData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    overall_state: Literal["ready", "warn", "error"]
    total_score: float
    sections: list[ChecklistSection]
    action_queue: list[ChecklistAction]
    freshness_timeline: list[FreshnessPoint] = Field(default_factory=list)
    market_session: dict[str, Any] = Field(default_factory=dict)
    auto_fetch_status: dict[str, Any] = Field(default_factory=dict)


class RuntimeConfigData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    python_version: str
    timezone_display: str
    timezone_server: str
    timezone_storage: str
    macro_enabled: bool
    macro_disabled_reason: str = ""
    fred_key_configured: bool
    worker_pool_size: int
    first_launch_complete: bool
    mt5_folder: str
    top_pairs: list[str] = Field(default_factory=list)
    release_channel: Literal["stable", "beta"] = "stable"
    release_base_url: str = ""
    release_manifest_url: str = ""


class RuntimeConfigApplyData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    saved: bool
    mt5_folder: str
    macro_enabled: bool
    macro_disabled_reason: str = ""
    fred_key_configured: bool
    release_channel: Literal["stable", "beta"] = "stable"
    release_base_url: str = ""
    release_manifest_url: str = ""


class DashboardMetrics(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rate_differential: float | None = None
    rate_trend: str = "n/a"
    inflation_differential: float | None = None
    carry_estimator: float | None = None
    daily_atr_pct_average: float | None = None
    strength_meter: float | None = None
    atr14_h1_raw: float | None = None
    atr14_h1_pips: float | None = None
    swap_drag_bps: float = 0.0


class DashboardCard(BaseModel):
    model_config = ConfigDict(extra="forbid")

    symbol: str
    readiness: Literal["ready", "warn", "error"]
    readiness_reason: str
    rate_reason: str | None = None
    inflation_reason: str | None = None
    metrics: DashboardMetrics


class DashboardCardsData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    cards: list[DashboardCard]
    total_symbols: int | None = None
    filtered_symbols: int | None = None


class RateMetricDetailRawComponents(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base_rate_pp: float | None = None
    quote_rate_pp: float | None = None
    formula: str


class RateMetricDetailSeriesIds(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base: str
    quote: str


class RateMetricDetailAsOf(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base: str
    quote: str
    effective: str


class RateMetricDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    raw_components: RateMetricDetailRawComponents
    source_series_ids: RateMetricDetailSeriesIds
    as_of_utc: RateMetricDetailAsOf
    last_refreshed_utc: str


class RateMetric(BaseModel):
    model_config = ConfigDict(extra="forbid")

    signed_value: float | None = None
    unit: Literal["pp"] = "pp"
    trend_badge: str
    tooltip: str
    na_reason: str = ""
    detail: RateMetricDetail


class FundamentalDifferentialData(BaseModel):
    model_config = ConfigDict(extra="forbid")

    base: str
    quote: str
    active_pair: str
    pair_source: Literal["query", "base_quote", "fallback"]
    strength_watchlist_default: list[str] = Field(default_factory=list)
    inflation_mode: Literal["yoy", "mom"] = "yoy"
    rate_differential: float | None = None
    rate_reason: str
    inflation_differential: float | None = None
    inflation_reason: str
    rate_trend: str
    rate_metric: RateMetric


class WsEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: str = Field(default=SCHEMA_VERSION)
    timestamp_utc: datetime
    trace_id: str
    event_name: Literal[
        "job.started",
        "job.progress",
        "job.completed",
        "job.failed",
        "job.cancelled",
        "data.updated",
        "alerts.state_changed",
    ]
    payload: dict[str, Any] = Field(default_factory=dict)
