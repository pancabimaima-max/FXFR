import { useEffect, useMemo, useState } from "react";

import { fetchLogs, fetchRuntimeConfig } from "@/api/client";
import { DataTable } from "@/components/DataTable";

type Props = {
  sessionToken: string;
};

export function LogsPage({ sessionToken }: Props) {
  const [levelWarn, setLevelWarn] = useState(true);
  const [levelError, setLevelError] = useState(true);
  const [lookbackHours, setLookbackHours] = useState(24);
  const [limit, setLimit] = useState(500);
  const [source, setSource] = useState<"session" | "file" | "both">("session");
  const [rawView, setRawView] = useState(false);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [displayTz, setDisplayTz] = useState("UTC");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const levels = useMemo(() => {
    const out: string[] = [];
    if (levelWarn) out.push("WARN");
    if (levelError) out.push("ERROR");
    if (!out.length) out.push("WARN", "ERROR");
    return out.join(",");
  }, [levelWarn, levelError]);

  async function loadLogs() {
    setLoading(true);
    setError("");
    try {
      const [runtime, logsRes] = await Promise.all([
        fetchRuntimeConfig(sessionToken),
        fetchLogs(sessionToken, {
          levels,
          lookback_hours: lookbackHours,
          limit,
          source,
        }),
      ]);

      setDisplayTz(String(runtime.data.timezone_display ?? "UTC"));
      const mapped = (logsRes.data.rows ?? []).map((r: any) => {
        const ts = String(r.timestamp_utc ?? "");
        let local = ts;
        try {
          const d = new Date(ts);
          local = new Intl.DateTimeFormat("en-GB", {
            dateStyle: "short",
            timeStyle: "medium",
            hour12: false,
            timeZone: String(runtime.data.timezone_display ?? "UTC"),
          }).format(d);
        } catch {
          local = ts;
        }
        return {
          timestamp_local: local,
          level: String(r.level ?? ""),
          message: String(r.message ?? ""),
          source: String((r.context ?? {}).source ?? "session"),
          context: JSON.stringify(r.context ?? {}),
        };
      });
      setRows(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLogs();
  }, [sessionToken]);

  return (
    <section className="logs-page">
      <div className="logs-header-row">
        <h1>Logs</h1>
        <p className="muted">Default: last 24h warning/error logs.</p>
      </div>

      <div className="panel ops-card command-deck logs-command-deck">
        <div className="logs-filter-grid">
          <div className="form-field logs-filter-block">
            <label>Levels</label>
            <div className="inline-checks control-checks">
              <label><input className="control-field" type="checkbox" checked={levelWarn} onChange={(e) => setLevelWarn(e.target.checked)} /> WARN</label>
              <label><input className="control-field" type="checkbox" checked={levelError} onChange={(e) => setLevelError(e.target.checked)} /> ERROR</label>
            </div>
          </div>
          <div className="form-field logs-filter-block">
            <label>Lookback (hours)</label>
            <input className="control-field" type="number" min={1} max={720} value={lookbackHours} onChange={(e) => setLookbackHours(Math.max(1, Number(e.target.value || 24)))} />
          </div>
          <div className="form-field logs-filter-block">
            <label>Limit</label>
            <input className="control-field" type="number" min={1} max={10000} value={limit} onChange={(e) => setLimit(Math.max(1, Number(e.target.value || 500)))} />
          </div>
          <div className="form-field logs-filter-block">
            <label>Source</label>
            <select className="control-field" value={source} onChange={(e) => setSource(e.target.value as "session" | "file" | "both") }>
              <option value="session">Session</option>
              <option value="file">File</option>
              <option value="both">Both</option>
            </select>
          </div>
        </div>

        <div className="inline-checks logs-toggle-row surface-toolbar">
          <label className={`logs-pill-toggle status-chip ${rawView ? "active status-chip-live" : "status-chip-muted"}`}>
            <input className="control-field" type="checkbox" checked={rawView} onChange={(e) => setRawView(e.target.checked)} />
            Raw view
          </label>
        </div>

        <div className="row surface-toolbar">
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => void loadLogs()}>{loading ? "Loading..." : "Refresh Logs"}</button>
        </div>
      </div>

      <div className="logs-status-strip">
        <span className="logs-status-chip">Timezone: Local ({displayTz})</span>
        <span className="logs-status-chip">Rows loaded: {rows.length}</span>
        <span className="logs-status-chip">Source: {source.toUpperCase()}</span>
      </div>

      {error && <div className="panel error">{error}</div>}

      {!error && !rawView && (
        <div className="panel ops-card surface-card logs-table-card">
          <DataTable rows={rows} emptyText="No log rows for current filters." variant="dense" />
        </div>
      )}

      {!error && rawView && (
        <div className="panel ops-card surface-card logs-raw-card raw-log">
          {rows.length ? rows.map((r, idx) => <div key={idx}>{`${r.timestamp_local} | ${r.level} | ${r.message}`}</div>) : "No log rows for current filters."}
        </div>
      )}
    </section>
  );
}
