import { useEffect, useState } from "react";

import { fetchChartSeries } from "@/api/client";
import { DataTable } from "@/components/DataTable";

type Props = {
  sessionToken: string;
};

type Tab = "Ticker" | "Compare" | "Math Lab" | "Signals";
const tabs: Tab[] = ["Ticker", "Compare", "Math Lab", "Signals"];

export function ChartsPage({ sessionToken }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("Ticker");
  const [symbol, setSymbol] = useState("EURUSD");
  const [symbolB, setSymbolB] = useState("USDJPY");
  const [rowsA, setRowsA] = useState<Record<string, unknown>[]>([]);
  const [rowsB, setRowsB] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function runTicker() {
    setLoading(true);
    setError("");
    try {
      const res = await fetchChartSeries(sessionToken, symbol, 1000);
      setRowsA(res.data.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load chart series");
    } finally {
      setLoading(false);
    }
  }

  async function runCompare() {
    setLoading(true);
    setError("");
    try {
      const [a, b] = await Promise.all([
        fetchChartSeries(sessionToken, symbol, 1000),
        fetchChartSeries(sessionToken, symbolB, 1000),
      ]);
      setRowsA(a.data.rows ?? []);
      setRowsB(b.data.rows ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load compare series");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runTicker();
  }, [sessionToken]);

  return (
    <section className="charts-page">
      <div className="charts-header-row">
        <div>
          <h1>Charts (BETA)</h1>
          <p className="muted">Default 1000 bars. Workspace pane policy: default 8 visible, warning above 8, hard cap 16.</p>
        </div>
        <div className="charts-status-chips">
          <span className="analytics-chip">Bars: 1000</span>
          <span className="analytics-chip">Panes: 8 default / 16 cap</span>
          <span className="analytics-chip beta">BETA</span>
        </div>
      </div>

      <div className="tab-row">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={`tab-btn btn btn-ghost ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      {error && <div className="panel error charts-error-card">{error}</div>}

      {activeTab === "Ticker" && (
        <>
          <div className="panel ops-card command-deck charts-command-deck">
            <h2 className="ops-section-title">Ticker</h2>
            <div className="form-grid charts-input-row">
              <div className="form-field">
                <label>Symbol</label>
                <input className="control-field" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
            </div>
            <div className="row charts-action-row surface-toolbar">
              <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runTicker()}>{loading ? "Loading..." : "Run"}</button>
            </div>
          </div>

          <div className="panel ops-card surface-card charts-surface-card">
            <h2 className="ops-section-title">Recent Bars ({symbol})</h2>
            <DataTable rows={rowsA.slice(-30)} emptyText="No series rows." variant="dense" />
          </div>
        </>
      )}

      {activeTab === "Compare" && (
        <div className="charts-compare-grid">
          <div className="panel ops-card command-deck charts-compare-deck">
            <h2 className="ops-section-title">Compare Inputs</h2>
            <div className="form-grid charts-input-row">
              <div className="form-field">
                <label>Symbol A</label>
                <input className="control-field" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
              </div>
              <div className="form-field">
                <label>Symbol B</label>
                <input className="control-field" value={symbolB} onChange={(e) => setSymbolB(e.target.value.toUpperCase())} />
              </div>
            </div>
            <div className="row charts-action-row surface-toolbar">
              <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void runCompare()}>{loading ? "Loading..." : "Run Compare"}</button>
            </div>
          </div>
          <div className="panel ops-card surface-card charts-compare-card">
            <h2 className="ops-section-title">{symbol}</h2>
            <DataTable rows={rowsA.slice(-20)} emptyText="No rows." variant="dense" />
          </div>
          <div className="panel ops-card surface-card charts-compare-card">
            <h2 className="ops-section-title">{symbolB}</h2>
            <DataTable rows={rowsB.slice(-20)} emptyText="No rows." variant="dense" />
          </div>
        </div>
      )}

      {activeTab === "Math Lab" && (
        <div className="panel ops-card surface-card charts-placeholder-card">
          <h2 className="charts-placeholder-title">Math Lab</h2>
          <p className="charts-placeholder-caption muted">Placeholder surface for future transformed series, ATR regimes, and spread diagnostics.</p>
        </div>
      )}

      {activeTab === "Signals" && (
        <div className="panel ops-card surface-card charts-placeholder-card">
          <h2 className="charts-placeholder-title">Signals</h2>
          <p className="charts-placeholder-caption muted">Placeholder surface for signal prototypes to be promoted after sanity checks.</p>
        </div>
      )}
    </section>
  );
}
