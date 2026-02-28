import { useEffect, useState } from "react";

import {
  fetchDashboardCards,
  fetchFredSnapshot,
  fetchFundamentalDifferential,
  fetchSwapConfig,
  postPromoteMetric,
  postSwapConfig,
} from "@/api/client";
import { DataTable } from "@/components/DataTable";
import { isValidFxPair, useAppStore } from "@/store/useAppStore";

type Props = {
  sessionToken: string;
};

type ToolTab = "Calculator" | "Source Tables" | "Sanity Check" | "Carry Config";

type CarryConfigRow = {
  symbol: string;
  swap_drag_bps: number;
  source: "configured" | "default_zero";
  updated_at_utc?: string;
};

const tabs: ToolTab[] = ["Calculator", "Source Tables", "Sanity Check", "Carry Config"];
const currencies = ["USD", "EUR", "JPY", "GBP", "AUD", "CAD"];

function splitPair(value: string): [string, string] | null {
  const token = String(value || "").trim().toUpperCase();
  if (!isValidFxPair(token)) {
    return null;
  }
  return [token.slice(0, 3), token.slice(3, 6)];
}

function trendBadgeClass(trend: unknown): string {
  const token = String(trend ?? "n/a").trim().toLowerCase();
  if (token === "rising") return "ready";
  if (token === "falling") return "error";
  if (token === "flat") return "warn";
  if (token === "mixed") return "warn";
  return "warn";
}

function formatSigned(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "n/a";
  }
  const asNum = Number(value);
  if (!Number.isFinite(asNum)) {
    return "n/a";
  }
  return asNum > 0 ? `+${asNum.toFixed(2)}` : asNum.toFixed(2);
}

function getPolicyRateForCurrency(rows: Record<string, unknown>[], currency: string): string {
  const token = String(currency || "").trim().toUpperCase();
  if (!token) return "n/a";
  const row = rows.find((item) => String(item?.currency ?? "").trim().toUpperCase() === token);
  if (!row || String(row.status ?? "").toLowerCase() !== "ok") {
    return "n/a";
  }
  const raw = Number(row.value);
  return Number.isFinite(raw) ? `${raw.toFixed(2)}%` : "n/a";
}

function getInflationForCurrency(rows: Record<string, unknown>[], currency: string, mode: "yoy" | "mom"): string {
  const token = String(currency || "").trim().toUpperCase();
  if (!token) return "n/a";
  const row = rows.find((item) => String(item?.currency ?? "").trim().toUpperCase() === token);
  if (!row || String(row.status ?? "").toLowerCase() !== "ok") {
    return "n/a";
  }
  const aux = (row.aux ?? {}) as Record<string, unknown>;
  const raw = Number(aux[mode]);
  return Number.isFinite(raw) ? `${raw.toFixed(2)}%` : "n/a";
}

export function FundamentalToolsPage({ sessionToken }: Props) {
  const [activeTab, setActiveTab] = useState<ToolTab>("Calculator");
  const activePair = useAppStore((s) => s.activePair);

  const [base, setBase] = useState("EUR");
  const [quote, setQuote] = useState("USD");
  const [mode, setMode] = useState<"yoy" | "mom">("yoy");
  const [result, setResult] = useState<any>(null);
  const [policyRows, setPolicyRows] = useState<Record<string, unknown>[]>([]);
  const [inflRows, setInflRows] = useState<Record<string, unknown>[]>([]);
  const [metricKey, setMetricKey] = useState("rate_diff.experimental");
  const [versionTag, setVersionTag] = useState("v0.1.0");

  const [carryRows, setCarryRows] = useState<CarryConfigRow[]>([]);
  const [carryInputs, setCarryInputs] = useState<Record<string, string>>({});
  const [carryLoading, setCarryLoading] = useState(false);
  const [carrySavingSymbol, setCarrySavingSymbol] = useState("");
  const [carryRowSuccess, setCarryRowSuccess] = useState<Record<string, string>>({});
  const [carryRowError, setCarryRowError] = useState<Record<string, string>>({});

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const basePolicyRate = getPolicyRateForCurrency(policyRows, base);
  const quotePolicyRate = getPolicyRateForCurrency(policyRows, quote);
  const baseInflation = getInflationForCurrency(inflRows, base, mode);
  const quoteInflation = getInflationForCurrency(inflRows, quote, mode);

  async function loadSources() {
    const [policy, inflation] = await Promise.all([
      fetchFredSnapshot(sessionToken, "policy"),
      fetchFredSnapshot(sessionToken, "inflation"),
    ]);
    setPolicyRows(policy.data.rows ?? []);
    setInflRows(inflation.data.rows ?? []);
  }

  async function hydrateCarryConfig() {
    setCarryLoading(true);
    setCarryRowSuccess({});
    setCarryRowError({});
    try {
      const dashboard = await fetchDashboardCards(sessionToken, {
        sort_by: "symbol_az",
        card_limit: 500,
      });
      const symbols = Array.from(
        new Set(
          (dashboard.data.cards ?? [])
            .map((card: any) => String(card?.symbol ?? "").trim().toUpperCase())
            .filter((sym: string) => sym.length >= 6),
        ),
      ).sort();

      if (symbols.length === 0) {
        setCarryRows([]);
        setCarryInputs({});
        return;
      }

      const swapRes = await fetchSwapConfig(sessionToken, {
        symbols_csv: symbols.join(","),
      });

      const rows = ((swapRes.data?.rows ?? []) as CarryConfigRow[])
        .map((row) => ({
          symbol: String(row.symbol ?? "").toUpperCase(),
          swap_drag_bps: Number(row.swap_drag_bps ?? 0),
          source: (row.source === "configured" ? "configured" : "default_zero") as CarryConfigRow["source"],
          updated_at_utc: String(row.updated_at_utc ?? ""),
        }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol));

      const inputs: Record<string, string> = {};
      for (const row of rows) {
        inputs[row.symbol] = String(row.swap_drag_bps);
      }

      setCarryRows(rows);
      setCarryInputs(inputs);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Carry Config");
    } finally {
      setCarryLoading(false);
    }
  }

  async function runCalculator() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const res = await fetchFundamentalDifferential(sessionToken, {
        base,
        quote,
        pair: activePair,
        inflation_mode: mode,
      });
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate differential");
    } finally {
      setBusy(false);
    }
  }

  async function promoteMetric() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await postPromoteMetric(sessionToken, {
        metric_key: metricKey,
        version_tag: versionTag,
      });
      setSuccess("Metric promoted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Promote failed");
    } finally {
      setBusy(false);
    }
  }

  async function applyCarryRow(symbol: string) {
    const raw = String(carryInputs[symbol] ?? "0").trim();
    const parsed = Number(raw);

    setCarryRowSuccess((prev) => ({ ...prev, [symbol]: "" }));
    setCarryRowError((prev) => ({ ...prev, [symbol]: "" }));

    if (Number.isNaN(parsed)) {
      setCarryRowError((prev) => ({ ...prev, [symbol]: "Enter a valid number." }));
      return;
    }

    if (parsed < -1000 || parsed > 1000) {
      setCarryRowError((prev) => ({ ...prev, [symbol]: "Value must be between -1000 and 1000 bps." }));
      return;
    }

    setCarrySavingSymbol(symbol);
    try {
      await postSwapConfig(sessionToken, {
        symbol,
        swap_drag_bps: parsed,
      });

      const nowUtc = new Date().toISOString();
      setCarryRows((prev) =>
        prev.map((row) =>
          row.symbol === symbol
            ? {
                ...row,
                swap_drag_bps: parsed,
                source: "configured",
                updated_at_utc: nowUtc,
              }
            : row,
        ),
      );
      setCarryInputs((prev) => ({ ...prev, [symbol]: String(parsed) }));
      setCarryRowSuccess((prev) => ({ ...prev, [symbol]: "Saved." }));
    } catch (err) {
      setCarryRowError((prev) => ({
        ...prev,
        [symbol]: err instanceof Error ? err.message : "Failed to save swap drag",
      }));
    } finally {
      setCarrySavingSymbol("");
    }
  }

  useEffect(() => {
    void loadSources();
    void runCalculator();
    void hydrateCarryConfig();
  }, [sessionToken]);

  useEffect(() => {
    const next = splitPair(activePair);
    if (!next) {
      return;
    }
    if (base !== next[0]) {
      setBase(next[0]);
    }
    if (quote !== next[1]) {
      setQuote(next[1]);
    }
    void runCalculator();
  }, [activePair]);

  useEffect(() => {
    if (activeTab === "Carry Config") {
      void hydrateCarryConfig();
    }
  }, [activeTab]);

  return (
    <section className="tools-page">
      <div className="tools-header-row">
        <h1>Fundamental Tools</h1>
      </div>
      <div className="tab-row">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={`tab-btn btn btn-ghost ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {error && <div className="panel error">{error}</div>}
      {success && <div className="panel success-text">{success}</div>}

      {activeTab === "Calculator" && (
        <div className="panel ops-card tools-calculator-shell">
          <h2 className="ops-section-title">Differential Calculator</h2>
          <p className="muted">Active pair context: <strong>{activePair}</strong> ({result?.pair_source ?? "n/a"})</p>
          <div className="form-grid tools-input-grid">
            <div className="form-field">
              <label>Base</label>
              <select className="control-field" value={base} onChange={(e) => setBase(e.target.value)}>
                {currencies.map((ccy) => (
                  <option key={ccy} value={ccy}>
                    {ccy}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Quote</label>
              <select className="control-field" value={quote} onChange={(e) => setQuote(e.target.value)}>
                {currencies.map((ccy) => (
                  <option key={ccy} value={ccy}>
                    {ccy}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-field">
              <label>Inflation Mode</label>
              <select className="control-field" value={mode} onChange={(e) => setMode(e.target.value as "yoy" | "mom")}>
                <option value="yoy">YoY</option>
                <option value="mom">MoM</option>
              </select>
            </div>
          </div>
          <div className="tools-precalc-context">
            <div className="panel tools-context-card">
              <h3>Base ({base})</h3>
              <p className="muted">Policy rate: <strong>{basePolicyRate}</strong></p>
              <p className="muted">Inflation ({mode.toUpperCase()}): <strong>{baseInflation}</strong></p>
            </div>
            <div className="panel tools-context-card">
              <h3>Quote ({quote})</h3>
              <p className="muted">Policy rate: <strong>{quotePolicyRate}</strong></p>
              <p className="muted">Inflation ({mode.toUpperCase()}): <strong>{quoteInflation}</strong></p>
            </div>
          </div>
          <div className="row surface-toolbar">
            <button type="button" className="btn btn-primary" onClick={() => void runCalculator()} disabled={busy}>
              {busy ? "Calculating..." : "Recalculate"}
            </button>
          </div>

          <div className="panel-grid tools-hero-metrics">
            <div className="panel ops-card tools-metric-card">
              <h3 className="ops-section-title">
                Rate Differential (Base - Quote)
                <span className="help-tip" title={String(result?.rate_metric?.tooltip ?? "Interest rate differential compares policy rates between base and quote currency.")}>?</span>
              </h3>
              <div className="metric-hero">
                <span className="metric-value tools-metric-value">{formatSigned(result?.rate_metric?.signed_value ?? result?.rate_differential)}</span>
                <span className="metric-unit tools-metric-unit">{result?.rate_metric?.unit ?? "pp"}</span>
                <span className={`state ${trendBadgeClass(result?.rate_metric?.trend_badge ?? result?.rate_trend)}`}>
                  {result?.rate_metric?.trend_badge ?? result?.rate_trend ?? "n/a"}
                </span>
              </div>
              <p className="muted">{result?.rate_metric?.na_reason || result?.rate_reason || "n/a"}</p>
              <div className="metric-detail-grid tools-metric-detail">
                <p className="muted">
                  Raw: {result?.rate_metric?.detail?.raw_components?.base_rate_pp ?? "n/a"} - {result?.rate_metric?.detail?.raw_components?.quote_rate_pp ?? "n/a"}
                </p>
                <p className="muted">
                  Source IDs: {result?.rate_metric?.detail?.source_series_ids?.base ?? "n/a"} / {result?.rate_metric?.detail?.source_series_ids?.quote ?? "n/a"}
                </p>
                <p className="muted">
                  As-of UTC: {result?.rate_metric?.detail?.as_of_utc?.effective ?? "n/a"}
                </p>
                <p className="muted">
                  Last refreshed: {result?.rate_metric?.detail?.last_refreshed_utc ?? "n/a"}
                </p>
              </div>
            </div>
            <div className="panel ops-card tools-metric-card">
              <h3 className="ops-section-title">Inflation Differential ({mode.toUpperCase()})</h3>
              <div className="tools-metric-value">{result?.inflation_differential ?? "n/a"}</div>
              <p className="muted">{result?.inflation_reason ?? "n/a"}</p>
            </div>
          </div>
        </div>
      )}

      {activeTab === "Source Tables" && (
        <div className="panel-grid">
          <div className="panel ops-card">
            <h2 className="ops-section-title">Policy Source Table</h2>
            <DataTable rows={policyRows} emptyText="No policy source rows." variant="dense" />
          </div>
          <div className="panel ops-card">
            <h2 className="ops-section-title">Inflation Source Table</h2>
            <DataTable rows={inflRows} emptyText="No inflation source rows." variant="dense" />
          </div>
        </div>
      )}

      {activeTab === "Sanity Check" && (
        <div className="panel ops-card">
          <h2 className="ops-section-title">Promotion</h2>
          <p className="muted">Promote an experimental metric revision to Dashboard catalog.</p>
          <div className="form-grid tools-input-grid">
            <div className="form-field">
              <label>Metric Key</label>
              <input className="control-field" value={metricKey} onChange={(e) => setMetricKey(e.target.value)} />
            </div>
            <div className="form-field">
              <label>Version Tag</label>
              <input className="control-field" value={versionTag} onChange={(e) => setVersionTag(e.target.value)} />
            </div>
          </div>
          <div className="row surface-toolbar">
            <button type="button" className="btn btn-primary" onClick={() => void promoteMetric()} disabled={busy || !metricKey || !versionTag}>
              {busy ? "Saving..." : "Promote to Dashboard"}
            </button>
          </div>
        </div>
      )}

      {activeTab === "Carry Config" && (
        <div className="panel ops-card">
          <h2 className="ops-section-title">Carry Config</h2>
          <p className="muted">Set per-symbol swap drag (bps). Carry estimator uses this value immediately after Apply.</p>
          <div className="carry-toolbar">
            <div className="row row-start">
              <button type="button" className="btn btn-secondary" onClick={() => void hydrateCarryConfig()} disabled={carryLoading || carrySavingSymbol.length > 0}>
                {carryLoading ? "Refreshing..." : "Refresh list"}
              </button>
            </div>
          </div>

          {carryLoading && <p className="muted">Loading carry config...</p>}

          {!carryLoading && carryRows.length === 0 && (
            <div className="panel">No uploaded symbols yet. Load Price Candle Data first.</div>
          )}

          {!carryLoading && carryRows.length > 0 && (
            <div className="table-wrap carry-table-shell">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Swap drag (bps)</th>
                    <th>Source</th>
                    <th>Updated (UTC)</th>
                    <th>Action</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {carryRows.map((row) => {
                    const isSaving = carrySavingSymbol === row.symbol;
                    return (
                      <tr key={row.symbol}>
                        <td>{row.symbol}</td>
                        <td>
                          <input className="control-field"
                            type="number"
                            min={-1000}
                            max={1000}
                            step={0.01}
                            value={carryInputs[row.symbol] ?? "0"}
                            onChange={(e) =>
                              setCarryInputs((prev) => ({
                                ...prev,
                                [row.symbol]: e.target.value,
                              }))
                            }
                            disabled={isSaving}
                          />
                        </td>
                        <td>{row.source}</td>
                        <td>{row.updated_at_utc || "n/a"}</td>
                        <td>
                          <button type="button" className="btn btn-primary" onClick={() => void applyCarryRow(row.symbol)} disabled={isSaving}>
                            {isSaving ? "Saving..." : "Apply"}
                          </button>
                        </td>
                        <td>
                          {carryRowError[row.symbol] ? (
                            <span className="error-text">{carryRowError[row.symbol]}</span>
                          ) : (
                            <span className="muted">{carryRowSuccess[row.symbol] || ""}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
