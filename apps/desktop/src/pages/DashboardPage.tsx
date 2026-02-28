import { useEffect, useMemo, useState, type CSSProperties } from "react";

import { fetchDashboardCards } from "@/api/client";

type Props = {
  sessionToken: string;
};

type DashboardMetricValue = number | string | null | undefined;

type DashboardCard = {
  symbol: string;
  readiness: string;
  readiness_reason?: string;
  rate_reason?: string;
  inflation_reason?: string;
  metrics: Record<string, DashboardMetricValue>;
};

const METRIC_TOOLTIP: Record<string, string> = {
  atr14_h1_pips: "Average True Range over 14 H1 candles, converted to pips for quick volatility scan.",
  rate_differential: "Policy rate difference between base and quote currency (base minus quote).",
  inflation_differential: "Inflation difference between base and quote currency using the selected mode.",
  carry_estimator: "Estimated net carry after swap drag input for this pair.",
  daily_atr_pct_average: "How large current ATR behavior is versus average daily movement.",
  strength_meter: "Composite macro strength score used for relative pair bias.",
};

function toNumber(value: DashboardMetricValue): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "n/a" || trimmed === "na" || trimmed === "-") {
    return null;
  }
  const parsed = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasMetricValue(value: DashboardMetricValue): boolean {
  return toNumber(value) !== null || (typeof value === "string" && value.trim() !== "" && value.trim().toLowerCase() !== "n/a");
}

function displayMetric(value: DashboardMetricValue): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || "n/a";
  }
  if (Number.isFinite(value)) {
    return String(value);
  }
  return "n/a";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function ringPercent(metricKey: string, value: DashboardMetricValue): number | null {
  const numeric = toNumber(value);
  if (numeric === null) {
    return null;
  }

  if (metricKey === "atr14_h1_pips") {
    return clamp((Math.abs(numeric) / 50) * 100, 0, 100);
  }
  if (metricKey === "daily_atr_pct_average") {
    return clamp((Math.max(0, numeric) / 200) * 100, 0, 100);
  }
  if (metricKey === "strength_meter") {
    return clamp((Math.abs(numeric) / 4) * 100, 0, 100);
  }
  return clamp((Math.abs(numeric) / 5) * 100, 0, 100);
}

function ringStyle(percent: number | null): CSSProperties | undefined {
  if (percent === null) {
    return undefined;
  }
  return { ["--metric-ring-value" as string]: `${percent}%` } as CSSProperties;
}

export function DashboardPage({ sessionToken }: Props) {
  const [cards, setCards] = useState<DashboardCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("readiness_symbol");
  const [cardLimit, setCardLimit] = useState(24);
  const [watchlistCsv, setWatchlistCsv] = useState("");
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [inflationMode, setInflationMode] = useState<"yoy" | "mom">("yoy");

  const watchCount = useMemo(
    () =>
      watchlistCsv
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean).length,
    [watchlistCsv],
  );

  async function loadCards() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchDashboardCards(sessionToken, {
        symbol_query: search,
        sort_by: sortBy,
        watchlist_csv: watchlistCsv,
        watchlist_only: watchlistOnly,
        card_limit: Math.max(1, cardLimit),
        inflation_mode: inflationMode,
      });
      setCards((res.data.cards ?? []) as DashboardCard[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadCards();
  }, [sessionToken, sortBy, watchlistOnly, inflationMode]);

  return (
    <section className="dashboard-page">
      <div className="dashboard-header-row">
        <div>
          <h1>Dashboard</h1>
          <p className="muted">View-only decision board for computed pair edge metrics.</p>
        </div>
        <div className="dashboard-status-strip">
          <span className="dashboard-status-chip">Cards: {cards.length}</span>
          <span className="dashboard-status-chip">Watchlist symbols: {watchCount}</span>
          <span className="dashboard-status-chip">Inflation mode: {inflationMode.toUpperCase()}</span>
        </div>
      </div>

      <div className="panel dashboard-command-deck">
        <div className="dashboard-filter-grid">
          <div className="form-field dashboard-filter-block">
            <label>Search symbol</label>
            <input className="control-field" value={search} onChange={(e) => setSearch(e.target.value.toUpperCase())} placeholder="EURUSD" />
          </div>
          <div className="form-field dashboard-filter-block">
            <label>Sort</label>
            <select className="control-field" value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
              <option value="readiness_symbol">Readiness then Symbol</option>
              <option value="symbol_az">Symbol A-Z</option>
              <option value="symbol_za">Symbol Z-A</option>
              <option value="atr_desc">ATR high-low</option>
            </select>
          </div>
          <div className="form-field dashboard-filter-block">
            <label>Card count</label>
            <input className="control-field" type="number" min={1} max={500}
              value={cardLimit}
              onChange={(e) => setCardLimit(Math.max(1, Number(e.target.value || 1)))}
            />
          </div>
          <div className="form-field dashboard-filter-block">
            <label>Inflation mode</label>
            <select className="control-field" value={inflationMode} onChange={(e) => setInflationMode(e.target.value as "yoy" | "mom")}>
              <option value="yoy">YoY</option>
              <option value="mom">MoM</option>
            </select>
          </div>
          <div className="form-field dashboard-filter-block">
            <label>Watchlist (CSV)</label>
            <input className="control-field" value={watchlistCsv} onChange={(e) => setWatchlistCsv(e.target.value.toUpperCase())} placeholder="EURUSD,USDJPY" />
          </div>
          <div className="form-field dashboard-filter-block">
            <label>Watchlist only</label>
            <select className="control-field" value={watchlistOnly ? "yes" : "no"} onChange={(e) => setWatchlistOnly(e.target.value === "yes")}>
              <option value="no">No</option>
              <option value="yes">Yes</option>
            </select>
          </div>
        </div>
        <div className="row row-start surface-toolbar ui-toolbar-tight">
          <button type="button" className="btn btn-primary ui-interactive ui-hover-lift" onClick={() => void loadCards()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </button>
        </div>
      </div>

      {error && <div className="panel error">{error}</div>}
      {loading && <div className="panel">Loading cards...</div>}

      {!loading && !error && (
        <div className="card-grid dashboard-card-grid">
          {cards.map((card) => {
            const rateRing = ringPercent("rate_differential", card.metrics.rate_differential);
            const atrRing = ringPercent("atr14_h1_pips", card.metrics.atr14_h1_pips);
            const inflRing = ringPercent("inflation_differential", card.metrics.inflation_differential);
            const carryRing = ringPercent("carry_estimator", card.metrics.carry_estimator);
            const dailyAtrRing = ringPercent("daily_atr_pct_average", card.metrics.daily_atr_pct_average);
            const strengthRing = ringPercent("strength_meter", card.metrics.strength_meter);

            return (
              <article className="card dashboard-cockpit-card ui-card-elevated" key={card.symbol}>
                <header className="dashboard-cockpit-header">
                  <strong className="dashboard-symbol">{card.symbol}</strong>
                  <span className={`state dashboard-readiness-chip ${card.readiness}`}>{card.readiness}</span>
                </header>

                <div className="dashboard-hero-row">
                  <div>
                    <div className="dashboard-metric-label" title={METRIC_TOOLTIP.rate_differential}>
                      Rate Differential
                    </div>
                    <div className="dashboard-hero-metric">{displayMetric(card.metrics.rate_differential)}</div>
                  </div>
                  <div className={`metric-mini-ring ${rateRing === null ? "is-na" : ""}`} style={ringStyle(rateRing)} aria-hidden>
                    <span className="metric-mini-ring-track" />
                    <span className="metric-mini-ring-fill" />
                  </div>
                </div>

                <div className="dashboard-metrics-grid">
                  <div className="dashboard-metric-tile">
                    <label className="dashboard-metric-label" title={METRIC_TOOLTIP.atr14_h1_pips}>
                      ATR(14) H1 (pips)
                    </label>
                    <div className="dashboard-metric-main">
                      <div className="dashboard-metric-value">{displayMetric(card.metrics.atr14_h1_pips)}</div>
                      <div className={`metric-mini-ring ${atrRing === null ? "is-na" : ""}`} style={ringStyle(atrRing)} aria-hidden>
                        <span className="metric-mini-ring-track" />
                        <span className="metric-mini-ring-fill" />
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-metric-tile">
                    <label className="dashboard-metric-label" title={METRIC_TOOLTIP.inflation_differential}>
                      Inflation Differential
                    </label>
                    <div className="dashboard-metric-main">
                      <div className="dashboard-metric-value">{displayMetric(card.metrics.inflation_differential)}</div>
                      <div className={`metric-mini-ring ${inflRing === null ? "is-na" : ""}`} style={ringStyle(inflRing)} aria-hidden>
                        <span className="metric-mini-ring-track" />
                        <span className="metric-mini-ring-fill" />
                      </div>
                    </div>
                    {!hasMetricValue(card.metrics.inflation_differential) && card.inflation_reason && (
                      <span className="dashboard-na-reason" title={card.inflation_reason}>
                        n/a: {card.inflation_reason}
                      </span>
                    )}
                  </div>

                  <div className="dashboard-metric-tile">
                    <label className="dashboard-metric-label" title={METRIC_TOOLTIP.carry_estimator}>
                      Carry Estimator
                    </label>
                    <div className="dashboard-metric-main">
                      <div className="dashboard-metric-value">{displayMetric(card.metrics.carry_estimator)}</div>
                      <div className={`metric-mini-ring ${carryRing === null ? "is-na" : ""}`} style={ringStyle(carryRing)} aria-hidden>
                        <span className="metric-mini-ring-track" />
                        <span className="metric-mini-ring-fill" />
                      </div>
                    </div>
                    {!hasMetricValue(card.metrics.carry_estimator) && (
                      <span className="dashboard-na-reason" title={card.readiness_reason ?? "Metric is unavailable."}>
                        n/a: {card.readiness_reason ?? "Metric unavailable."}
                      </span>
                    )}
                  </div>

                  <div className="dashboard-metric-tile">
                    <label className="dashboard-metric-label" title={METRIC_TOOLTIP.daily_atr_pct_average}>
                      Daily ATR % Average
                    </label>
                    <div className="dashboard-metric-main">
                      <div className="dashboard-metric-value">{displayMetric(card.metrics.daily_atr_pct_average)}</div>
                      <div className={`metric-mini-ring ${dailyAtrRing === null ? "is-na" : ""}`} style={ringStyle(dailyAtrRing)} aria-hidden>
                        <span className="metric-mini-ring-track" />
                        <span className="metric-mini-ring-fill" />
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-metric-tile">
                    <label className="dashboard-metric-label" title={METRIC_TOOLTIP.strength_meter}>
                      Strength Meter
                    </label>
                    <div className="dashboard-metric-main">
                      <div className="dashboard-metric-value">{displayMetric(card.metrics.strength_meter)}</div>
                      <div className={`metric-mini-ring ${strengthRing === null ? "is-na" : ""}`} style={ringStyle(strengthRing)} aria-hidden>
                        <span className="metric-mini-ring-track" />
                        <span className="metric-mini-ring-fill" />
                      </div>
                    </div>
                  </div>
                </div>

                <p className="muted">{card.readiness_reason}</p>
                {!hasMetricValue(card.metrics.rate_differential) && card.rate_reason && (
                  <span className="dashboard-na-reason" title={card.rate_reason}>
                    n/a: {card.rate_reason}
                  </span>
                )}

                <details className="dashboard-details dashboard-details-panel">
                  <summary>Details</summary>
                  <p className="dashboard-detail-row">
                    <span className="muted">Rate reason</span>
                    <span>{card.rate_reason ?? "n/a"}</span>
                  </p>
                  <p className="dashboard-detail-row">
                    <span className="muted">Inflation reason</span>
                    <span>{card.inflation_reason ?? "n/a"}</span>
                  </p>
                  <p className="dashboard-detail-row">
                    <span className="muted">Swap drag (bps)</span>
                    <span>{Number(card.metrics.swap_drag_bps ?? 0).toFixed(2)}</span>
                  </p>
                  <p className="dashboard-detail-row">
                    <span className="muted">ATR raw (price units)</span>
                    <span>{displayMetric(card.metrics.atr14_h1_raw)}</span>
                  </p>
                  <p className="dashboard-detail-row">
                    <span className="muted">Rate trend</span>
                    <span>{displayMetric(card.metrics.rate_trend)}</span>
                  </p>
                </details>
              </article>
            );
          })}
          {cards.length === 0 && <div className="panel">No cards yet. Load Price Candle Data in Data Checklist first.</div>}
        </div>
      )}
    </section>
  );
}
