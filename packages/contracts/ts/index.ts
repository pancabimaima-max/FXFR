export const SCHEMA_VERSION = "1.0.0" as const;

export type ReadinessState = "ready" | "warn" | "error";

export interface EnvelopeMeta {
  schema_version: typeof SCHEMA_VERSION;
  timestamp_utc: string;
  trace_id: string;
}

export interface ApiError {
  code: string;
  message: string;
  recoverable: boolean;
  context: Record<string, unknown>;
}

export interface ResponseEnvelope<T> {
  meta: EnvelopeMeta;
  data: T;
  error?: ApiError | null;
}

export interface ChecklistSection {
  name: string;
  state: ReadinessState;
  score: number;
  max_score?: number;
  detail: string;
}

export interface ChecklistAction {
  done: boolean;
  text: string;
}

export interface FreshnessPoint {
  section: string;
  state: ReadinessState;
  timestamp_utc: string;
  timestamp_local: string;
  age_text: string;
}

export interface ChecklistOverviewData {
  overall_state: ReadinessState;
  total_score: number;
  sections: ChecklistSection[];
  action_queue: ChecklistAction[];
  freshness_timeline: FreshnessPoint[];
  market_session: Record<string, unknown>;
  auto_fetch_status: Record<string, unknown>;
}

export interface RuntimeConfigData {
  python_version: string;
  timezone_display: string;
  timezone_server: string;
  timezone_storage: string;
  macro_enabled: boolean;
  macro_disabled_reason: string;
  fred_key_configured: boolean;
  worker_pool_size: number;
  first_launch_complete: boolean;
  mt5_folder: string;
  top_pairs: string[];
  release_channel: "stable" | "beta";
  release_base_url: string;
  release_manifest_url: string;
}

export interface RuntimeConfigApplyData {
  saved: boolean;
  mt5_folder: string;
  macro_enabled: boolean;
  macro_disabled_reason: string;
  fred_key_configured: boolean;
  release_channel: "stable" | "beta";
  release_base_url: string;
  release_manifest_url: string;
}

export interface DashboardMetrics {
  rate_differential: number | null;
  rate_trend: string;
  inflation_differential: number | null;
  carry_estimator: number | null;
  daily_atr_pct_average: number | null;
  strength_meter: number | null;
  atr14_h1_raw: number | null;
  atr14_h1_pips: number | null;
  swap_drag_bps: number;
}

export interface DashboardCard {
  symbol: string;
  readiness: ReadinessState;
  readiness_reason: string;
  rate_reason?: string;
  inflation_reason?: string;
  metrics: DashboardMetrics;
}

export interface DashboardCardsData {
  cards: DashboardCard[];
  total_symbols?: number;
  filtered_symbols?: number;
}

export type PairSource = "query" | "base_quote" | "fallback";

export interface RateMetricDetail {
  raw_components: {
    base_rate_pp: number | null;
    quote_rate_pp: number | null;
    formula: string;
  };
  source_series_ids: {
    base: string;
    quote: string;
  };
  as_of_utc: {
    base: string;
    quote: string;
    effective: string;
  };
  last_refreshed_utc: string;
}

export interface RateMetric {
  signed_value: number | null;
  unit: "pp";
  trend_badge: string;
  tooltip: string;
  na_reason: string;
  detail: RateMetricDetail;
}

export interface FundamentalDifferentialData {
  base: string;
  quote: string;
  active_pair: string;
  pair_source: PairSource;
  strength_watchlist_default: string[];
  inflation_mode: "yoy" | "mom";
  rate_differential: number | null;
  rate_reason: string;
  inflation_differential: number | null;
  inflation_reason: string;
  rate_trend: string;
  rate_metric: RateMetric;
}

export interface SwapConfigRow {
  symbol: string;
  swap_drag_bps: number;
  source: "configured" | "default_zero";
  updated_at_utc?: string;
}

export interface SwapConfigData {
  rows: SwapConfigRow[];
}

export interface WsEvent {
  schema_version: typeof SCHEMA_VERSION;
  timestamp_utc: string;
  trace_id: string;
  event_name:
    | "job.started"
    | "job.progress"
    | "job.completed"
    | "job.failed"
    | "job.cancelled"
    | "data.updated"
    | "alerts.state_changed";
  payload: Record<string, unknown>;
}
