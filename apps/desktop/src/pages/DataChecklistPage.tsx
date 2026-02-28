import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WsEvent } from "@fxfr/contracts";

import {
  fetchCalendarPreview,
  fetchChecklist,
  fetchFredSnapshot,
  fetchJob,
  fetchPricePreview,
  fetchRuntimeConfig,
  postCancelJob,
  postFredRefresh,
  postIngestCalendar,
  postIngestPrice,
  postRuntimeConfigApply,
  postTimezoneApply,
} from "@/api/client";
import { DataTable } from "@/components/DataTable";
import { connectEngineEvents } from "@/realtime/engineEvents";
import { useAppStore } from "@/store/useAppStore";

type Props = {
  sessionToken: string;
};

type Tab = "Overview" | "H1 Candle Data" | "Economic Calendar Data" | "FRED Data";
type JobStatus = "queued" | "running" | "cancel_requested" | "completed" | "failed" | "cancelled";
type EngineStreamState = "connecting" | "live" | "reconnecting" | "offline";

type ActiveJob = {
  job_id: string;
  name: string;
  status: JobStatus;
  progress: number;
  message: string;
  error: string;
  cancel_requested: boolean;
  updated_at_utc: string;
};

const tabs: Tab[] = ["Overview", "H1 Candle Data", "Economic Calendar Data", "FRED Data"];
const terminalStatuses: JobStatus[] = ["completed", "failed", "cancelled"];
const trackedJobNames = new Set(["ingest.price", "ingest.calendar", "fred.refresh"]);

const fallbackTimezoneOptions = [
  "UTC",
  "Asia/Jakarta",
  "Asia/Gaza",
  "Europe/London",
  "America/New_York",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function resolveTimezoneOptions(): string[] {
  try {
    const maybeSupportedValuesOf = (Intl as typeof Intl & {
      supportedValuesOf?: (key: "timeZone") => string[];
    }).supportedValuesOf;
    if (typeof maybeSupportedValuesOf === "function") {
      const zones = maybeSupportedValuesOf("timeZone").filter((zone) => zone.trim().length > 0);
      if (zones.length > 0) {
        const unique = Array.from(new Set(zones));
        if (!unique.includes("UTC")) {
          unique.unshift("UTC");
        }
        return unique;
      }
    }
  } catch {
    // Fallback list is used when supportedValuesOf is unavailable.
  }
  return fallbackTimezoneOptions;
}

function timezoneUtcPrefix(timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
    }).formatToParts(new Date());
    const zone = parts.find((part) => part.type === "timeZoneName")?.value ?? "UTC";
    const normalized = zone.replace("GMT", "UTC");
    return normalized === "UTC" ? "UTC+0" : normalized;
  } catch {
    return "UTC";
  }
}

function isTerminalStatus(status: JobStatus) {
  return terminalStatuses.includes(status);
}

function toJobStatus(input: unknown): JobStatus {
  const token = String(input ?? "queued").trim().toLowerCase();
  if (token === "running") return "running";
  if (token === "cancel_requested") return "cancel_requested";
  if (token === "completed") return "completed";
  if (token === "failed") return "failed";
  if (token === "cancelled") return "cancelled";
  return "queued";
}

function statusBadgeClass(status: JobStatus): string {
  if (status === "completed") return "ready";
  if (status === "failed") return "error";
  return "warn";
}

function statusLabel(status: JobStatus): string {
  if (status === "cancel_requested") return "cancel requested";
  return status;
}

function formatClock(value: string): string {
  if (!value) return "n/a";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleTimeString([], { hour12: false });
}

export function DataChecklistPage({ sessionToken }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<any>(null);
  const [runtimeConfig, setRuntimeConfig] = useState<any>(null);
  const [fredApiKey, setFredApiKey] = useState("");
  const [displayTz, setDisplayTz] = useState("Asia/Jakarta");
  const [serverTz, setServerTz] = useState("Asia/Gaza");
  const [priceFile, setPriceFile] = useState<File | null>(null);
  const [calendarFile, setCalendarFile] = useState<File | null>(null);
  const [pricePreviewRows, setPricePreviewRows] = useState<Record<string, unknown>[]>([]);
  const [calendarPreviewRows, setCalendarPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [fredPolicyRows, setFredPolicyRows] = useState<Record<string, unknown>[]>([]);
  const [fredInflRows, setFredInflRows] = useState<Record<string, unknown>[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);
  const [error, setError] = useState("");
  const [successText, setSuccessText] = useState("");
  const [reloadSeed, setReloadSeed] = useState(0);
  const [eventStreamState, setEventStreamState] = useState<EngineStreamState>("connecting");
  const [lastEventAt, setLastEventAt] = useState("");
  const handledTerminalJobsRef = useRef<Set<string>>(new Set());
  const lastEngineEventAtMsRef = useRef<number>(Date.now());

  const bootstrap = useAppStore((s) => s.bootstrap);
  const setBootstrap = useAppStore((s) => s.setBootstrap);
  const activePair = useAppStore((s) => s.activePair);

  const timezoneOptions = useMemo(() => resolveTimezoneOptions(), []);
  const timezoneOptionItems = useMemo(
    () => timezoneOptions.map((tz) => ({ value: tz, label: `${timezoneUtcPrefix(tz)} ${tz}` })),
    [timezoneOptions],
  );

  const longJobActive = Boolean(activeJob && !isTerminalStatus(activeJob.status));

  const applyLiveJobUpdate = useCallback((payload: Record<string, unknown>) => {
    const incomingName = String(payload.name ?? "").trim();
    setActiveJob((prev) => {
      const name = incomingName || String(prev?.name ?? "").trim();
      if (!name || !trackedJobNames.has(name)) {
        return prev;
      }

      const explicitJobId = String(payload.job_id ?? "").trim();
      const jobId = explicitJobId || (prev && prev.name === name ? prev.job_id : "");
      if (!jobId) {
        return prev;
      }

      if (prev && prev.job_id !== jobId && !isTerminalStatus(prev.status)) {
        return prev;
      }

      const nextProgressRaw = Number(payload.progress ?? prev?.progress ?? 0);
      const nextProgress = Number.isFinite(nextProgressRaw) ? nextProgressRaw : 0;

      return {
        job_id: jobId,
        name,
        status: toJobStatus(payload.status ?? prev?.status ?? "queued"),
        progress: nextProgress,
        message: String(payload.message ?? prev?.message ?? ""),
        error: String(payload.error ?? prev?.error ?? ""),
        cancel_requested: Boolean(payload.cancel_requested ?? prev?.cancel_requested ?? false),
        updated_at_utc: String(payload.updated_at_utc ?? prev?.updated_at_utc ?? ""),
      };
    });
  }, []);

  const handleEngineEvent = useCallback((event: WsEvent) => {
    setLastEventAt(String(event.timestamp_utc ?? ""));
    lastEngineEventAtMsRef.current = Date.now();

    const payload = (event.payload ?? {}) as Record<string, unknown>;
    const eventData = payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : payload;

    if (event.event_name === "job.progress") {
      applyLiveJobUpdate(eventData);
      return;
    }
    if (event.event_name === "job.started") {
      applyLiveJobUpdate({
        ...eventData,
        status: eventData.status ?? "queued",
        progress: eventData.progress ?? 0,
        message: eventData.message ?? "Queued",
      });
      return;
    }
    if (event.event_name === "job.completed") {
      applyLiveJobUpdate({ ...eventData, status: "completed", progress: eventData.progress ?? 1.0 });
      return;
    }
    if (event.event_name === "job.failed") {
      applyLiveJobUpdate({ ...eventData, status: "failed", progress: eventData.progress ?? 1.0 });
      return;
    }
    if (event.event_name === "job.cancelled") {
      applyLiveJobUpdate({ ...eventData, status: "cancelled", progress: eventData.progress ?? 1.0 });
    }
  }, [applyLiveJobUpdate]);

  async function loadCore() {
    const [checklistRes, runtimeRes] = await Promise.all([
      fetchChecklist(sessionToken, activePair),
      fetchRuntimeConfig(sessionToken),
    ]);

    setOverview(checklistRes.data);
    setRuntimeConfig(runtimeRes.data);
    setDisplayTz(String(runtimeRes.data.timezone_display ?? "Asia/Jakarta"));
    setServerTz(String(runtimeRes.data.timezone_server ?? "Asia/Gaza"));
  }

  async function loadPreviews() {
    const [priceRes, calendarRes] = await Promise.all([
      fetchPricePreview(sessionToken, 50, activePair),
      fetchCalendarPreview(sessionToken, 50),
    ]);
    setPricePreviewRows(priceRes.data.rows ?? []);
    setCalendarPreviewRows(calendarRes.data.rows ?? []);
  }

  async function loadFredSnapshots() {
    const [policyRes, inflRes] = await Promise.all([
      fetchFredSnapshot(sessionToken, "policy"),
      fetchFredSnapshot(sessionToken, "inflation"),
    ]);
    setFredPolicyRows(policyRes.data.rows ?? []);
    setFredInflRows(inflRes.data.rows ?? []);
  }

  useEffect(() => {
    let cancelled = false;

    const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

    async function retry(task: () => Promise<void>, attempts = 8, baseDelayMs = 180) {
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          await task();
          return;
        } catch (err) {
          lastError = err;
          if (attempt < attempts) {
            await sleep(baseDelayMs * attempt);
          }
        }
      }
      throw lastError ?? new Error("Failed after retries");
    }

    async function init() {
      setLoading(true);
      setError("");
      try {
        await retry(async () => {
          if (cancelled) return;
          await loadCore();
        });

        const settled = await Promise.allSettled([loadPreviews(), loadFredSnapshots()]);
        const rejected = settled.find((row) => row.status === "rejected") as PromiseRejectedResult | undefined;
        if (!cancelled && rejected) {
          console.warn("Checklist secondary load warning", rejected.reason);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load Data Checklist");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void init();
    return () => {
      cancelled = true;
    };
  }, [sessionToken, reloadSeed, activePair]);

  useEffect(() => {
    let closed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | undefined;
    let retryMs = 700;

    const connect = () => {
      if (closed) {
        return;
      }

      setEventStreamState((prev) => (prev === "live" ? "live" : "connecting"));
      socket = connectEngineEvents(sessionToken, {
        onOpen: () => {
          if (closed) {
            return;
          }
          retryMs = 700;
          lastEngineEventAtMsRef.current = Date.now();
          setEventStreamState("live");
        },
        onEvent: (event) => {
          if (closed) {
            return;
          }
          handleEngineEvent(event);
        },
        onClose: () => {
          if (closed) {
            return;
          }
          setEventStreamState("reconnecting");
          reconnectTimer = window.setTimeout(connect, retryMs);
          retryMs = Math.min(retryMs * 2, 5000);
        },
        onError: () => {
          if (closed) {
            return;
          }
          setEventStreamState("reconnecting");
        },
      });
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== undefined) {
        window.clearTimeout(reconnectTimer);
      }
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        socket.close();
      }
      setEventStreamState("offline");
    };
  }, [sessionToken, handleEngineEvent]);

  useEffect(() => {
    if (!activeJob || isTerminalStatus(activeJob.status)) {
      return;
    }

    let stop = false;
    let timer: number | undefined;

    const pollIntervalMs = () => {
      const streamIsStale = eventStreamState === "live" && Date.now() - lastEngineEventAtMsRef.current > 10_000;
      if (eventStreamState === "live" && !streamIsStale) {
        return 3_500;
      }
      return 900;
    };

    const poll = async () => {
      try {
        const res = await fetchJob(sessionToken, activeJob.job_id);
        if (stop) return;
        const row = res.data ?? {};
        setActiveJob((prev) => {
          if (!prev || prev.job_id !== activeJob.job_id) {
            return prev;
          }
          return {
            ...prev,
            status: toJobStatus(row.status),
            progress: Number(row.progress ?? prev.progress ?? 0),
            message: String(row.message ?? prev.message ?? ""),
            error: String(row.error ?? ""),
            cancel_requested: Boolean(row.cancel_requested ?? prev.cancel_requested ?? false),
            updated_at_utc: String(row.updated_at_utc ?? prev.updated_at_utc ?? ""),
          };
        });
      } catch {
        // Keep polling; transient failures can happen during engine churn.
      }
    };

    const loop = () => {
      timer = window.setTimeout(async () => {
        await poll();
        if (!stop) {
          loop();
        }
      }, pollIntervalMs());
    };

    void poll();
    loop();

    return () => {
      stop = true;
      if (timer !== undefined) {
        window.clearTimeout(timer);
      }
    };
  }, [activeJob?.job_id, activeJob?.status, eventStreamState, sessionToken]);

  useEffect(() => {
    if (!activeJob) return;
    if (!isTerminalStatus(activeJob.status)) return;
    if (handledTerminalJobsRef.current.has(activeJob.job_id)) return;

    handledTerminalJobsRef.current.add(activeJob.job_id);

    const finalize = async () => {
      setBusyAction("");

      if (activeJob.status === "completed") {
        if (activeJob.name === "ingest.price" || activeJob.name === "ingest.calendar") {
          await Promise.all([loadCore(), loadPreviews()]);
          if (activeJob.name === "ingest.price") {
            setSuccessText("Price Candle Data job completed.");
          } else {
            setSuccessText("Economic Calendar Data job completed.");
          }
        } else if (activeJob.name === "fred.refresh") {
          await Promise.all([loadCore(), loadFredSnapshots()]);
          setSuccessText("FRED refresh job completed.");
        }
      } else if (activeJob.status === "cancelled") {
        await loadCore();
        setSuccessText(`Job cancelled: ${activeJob.name}`);
      } else if (activeJob.status === "failed") {
        setError(activeJob.error || `Job failed: ${activeJob.name}`);
      }
    };

    void finalize();
  }, [activeJob]);

  function beginTrackedJob(jobId: string, jobName: string, message: string) {
    setActiveJob({
      job_id: jobId,
      name: jobName,
      status: "queued",
      progress: 0.0,
      message,
      error: "",
      cancel_requested: false,
      updated_at_utc: "",
    });
  }

  async function applyTimezoneSettings() {
    setBusyAction("timezone");
    setError("");
    setSuccessText("");
    try {
      await postTimezoneApply(sessionToken, {
        display_timezone: displayTz,
        server_timezone: serverTz,
      });
      await loadCore();
      setSuccessText("Timezone conversion applied.");
      if (bootstrap) {
        setBootstrap({
          ...bootstrap,
          displayTimezone: displayTz,
          serverTimezone: serverTz,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to apply timezone settings");
    } finally {
      setBusyAction("");
    }
  }

  async function uploadPriceManual() {
    if (!priceFile) return;
    setBusyAction("upload-price");
    setError("");
    setSuccessText("");
    try {
      const res = await postIngestPrice(sessionToken, priceFile, serverTz, true);
      const jobId = String(res?.data?.job_id ?? "");
      if (!jobId) {
        throw new Error("Price upload job did not return a job id.");
      }
      setPriceFile(null);
      beginTrackedJob(jobId, "ingest.price", "Queued for upload");
      setSuccessText("Price Candle Data job started.");
    } catch (err) {
      setBusyAction("");
      setError(err instanceof Error ? err.message : "Failed to upload price file");
    }
  }

  async function uploadCalendarManual() {
    if (!calendarFile) return;
    setBusyAction("upload-calendar");
    setError("");
    setSuccessText("");
    try {
      const res = await postIngestCalendar(sessionToken, calendarFile, serverTz, true);
      const jobId = String(res?.data?.job_id ?? "");
      if (!jobId) {
        throw new Error("Calendar upload job did not return a job id.");
      }
      setCalendarFile(null);
      beginTrackedJob(jobId, "ingest.calendar", "Queued for upload");
      setSuccessText("Economic Calendar Data job started.");
    } catch (err) {
      setBusyAction("");
      setError(err instanceof Error ? err.message : "Failed to upload calendar file");
    }
  }

  async function refreshFred() {
    setBusyAction("fred-refresh");
    setError("");
    setSuccessText("");
    try {
      const key = fredApiKey.trim();
      if (key) {
        const existingMt5Folder = String(runtimeConfig?.mt5_folder ?? "").trim();
        if (!existingMt5Folder) {
          throw new Error("MT5 folder is not configured on runtime config.");
        }
        const applyRes = await postRuntimeConfigApply(sessionToken, {
          mt5_folder: existingMt5Folder,
          fred_api_key: key,
        });
        setFredApiKey("");
        await loadCore();
        if (bootstrap) {
          setBootstrap({
            ...bootstrap,
            firstLaunchComplete: true,
            macroEnabled: Boolean(applyRes.data.macro_enabled),
            macroDisabledReason: String(applyRes.data.macro_disabled_reason ?? ""),
          });
        }
      }

      const res = await postFredRefresh(sessionToken);
      const accepted = Boolean(res?.data?.accepted);
      if (!accepted) {
        setBusyAction("");
        setError(String(res?.data?.message ?? "FRED refresh skipped."));
        return;
      }
      const jobId = String(res?.data?.job_id ?? "");
      if (!jobId) {
        throw new Error("FRED refresh did not return a job id.");
      }
      beginTrackedJob(jobId, "fred.refresh", "Queued for refresh");
      setSuccessText("FRED refresh job started.");
    } catch (err) {
      setBusyAction("");
      setError(err instanceof Error ? err.message : "FRED refresh failed");
    }
  }

  async function cancelActiveJob() {
    if (!activeJob || isTerminalStatus(activeJob.status)) return;
    setError("");
    setSuccessText("");
    try {
      const res = await postCancelJob(sessionToken, activeJob.job_id);
      const ok = Boolean(res?.data?.cancelled);
      if (!ok) {
        setError("Unable to cancel job. It may already be finished.");
        return;
      }
      setSuccessText("Cancellation requested.");
      setActiveJob((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: "cancel_requested",
          cancel_requested: true,
          message: "Cancellation requested",
        };
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel job");
    }
  }

  const jobPct = Math.max(0, Math.min(100, Math.round((activeJob?.progress ?? 0) * 100)));
  const overallStateToken = String(overview?.overall_state ?? "").trim().toUpperCase();
  const overallStateDetail = String(
    overview?.overall_detail ?? overview?.detail ?? overview?.overall_reason ?? overview?.error_detail ?? "",
  ).trim();
  const overallStateDisplay = overallStateToken === "ERROR"
    ? overallStateDetail || "Incomplete data (detail unavailable)"
    : (overview?.overall_state ?? "n/a");

  return (
    <section className="checklist-page">
      <div className="checklist-header-row">
        <h1>Data Checklist</h1>
      </div>
      <div className="tab-row">
        {tabs.map((tab) => (
          <button key={tab} type="button" className={`tab-btn btn btn-ghost ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
            {tab}
          </button>
        ))}
      </div>

      <div className="events-status-row">
        <span className={`events-indicator ${eventStreamState}`}>Events: {eventStreamState}</span>
        <span className={`checklist-macro-chip status-chip ${bootstrap?.macroEnabled ? "status-chip-live" : "status-chip-muted"}`}>
          Macro: {bootstrap?.macroEnabled ? "Live" : "Disabled"}
        </span>
        <span className="muted">Last event: {formatClock(lastEventAt)}</span>
      </div>

      {activeJob && (
        <div className="panel job-panel ops-card ops-job-card">
          <div className="card-header">
            <h2>Background Job</h2>
            <span className={`state ${statusBadgeClass(activeJob.status)}`}>{statusLabel(activeJob.status)}</span>
          </div>
          <p className="muted ops-job-meta">{activeJob.name} | Job ID: {activeJob.job_id}</p>
          <div className="ops-job-progress-row">
            <progress className="job-progress" max={100} value={jobPct} />
            <p className="muted">Progress: {jobPct}% {activeJob.message ? `- ${activeJob.message}` : ""}</p>
          </div>
          {activeJob.error && <p className="error-text">{activeJob.error}</p>}
          {!isTerminalStatus(activeJob.status) && !activeJob.cancel_requested && (
            <div className="row ops-job-actions surface-toolbar">
              <button type="button" className="btn btn-danger" onClick={() => void cancelActiveJob()}>Cancel job</button>
            </div>
          )}
        </div>
      )}

      {loading && <div className="panel">Loading checklist...</div>}
      {error && (
        <div className="panel error">
          <div>{error}</div>
          <div className="row surface-toolbar">
            <button type="button" className="btn btn-primary" onClick={() => setReloadSeed((x) => x + 1)} disabled={loading}>
              Retry checklist load
            </button>
          </div>
        </div>
      )}
      {successText && <div className="panel success-text">{successText}</div>}

      {!loading && !error && activeTab === "Overview" && (
        <>
          <div className="panel ops-card timezone-card">
            <h2 className="ops-card-title">Timezone Conversion</h2>
            <div className="form-grid">
              <div className="form-field">
                <label>Local Time</label>
                <select className="control-field" value={displayTz} onChange={(e) => setDisplayTz(e.target.value)}>
                  {timezoneOptionItems.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Server Time</label>
                <select className="control-field" value={serverTz} onChange={(e) => setServerTz(e.target.value)}>
                  {timezoneOptionItems.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="row surface-toolbar">
              <button type="button" className="btn btn-primary" disabled={busyAction === "timezone" || longJobActive} onClick={() => void applyTimezoneSettings()}>
                {busyAction === "timezone" ? "Applying..." : "Apply timezone conversion"}
              </button>
            </div>
          </div>

          <div className="panel-grid overview-kpi-grid">
            <div className="panel ops-card overview-kpi-card">
              <h2 className="ops-card-title">Overall State</h2>
              <p className="overview-kpi-value">{overallStateDisplay}</p>
              <p className="muted overview-kpi-caption">Total score: {overview?.total_score ?? "n/a"}</p>
              <p className="muted overview-kpi-caption">Local clock: {overview?.market_session?.local_time ?? "n/a"}</p>
              <p className="muted overview-kpi-caption">Market session: {overview?.market_session?.label ?? "n/a"}</p>
            </div>
            <div className="panel ops-card overview-kpi-card">
              <h2 className="ops-card-title">Section Health</h2>
              <ul className="ops-list">
                {(overview?.sections ?? []).map((s: any) => (
                  <li key={s.name} className="ops-list-row">
                    <span className={`ops-list-chip ${String(s?.state ?? "warn").toLowerCase()}`}>{String(s?.state ?? "n/a")}</span>
                    <span>
                      <strong>{s.name}</strong> ({s.score}) - {s.detail}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="panel ops-card overview-kpi-card">
              <h2 className="ops-card-title">Action Queue</h2>
              <ul className="ops-list">
                {(overview?.action_queue ?? []).map((a: any, idx: number) => (
                  <li key={`${idx}-${a.text}`} className="ops-list-row">
                    <span className={`ops-list-chip ${a.done ? "done" : "todo"}`}>{a.done ? "done" : "todo"}</span>
                    <span>{a.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="panel ops-card ops-timeline-card">
            <h2 className="ops-card-title">Freshness Timeline</h2>
            {(overview?.freshness_timeline ?? []).length === 0 ? (
              <p className="muted">No freshness points yet.</p>
            ) : (
              <div className="ops-timeline-list">
                {(overview?.freshness_timeline ?? []).map((r: any, idx: number) => (
                  <div key={`${idx}-${r.section}-${r.timestamp_local}`} className="ops-timeline-row">
                    <span>{r.section}</span>
                    <span className={`ops-timeline-state ${String(r?.state ?? "warn").toLowerCase()}`}>{r.state}</span>
                    <span className="muted">{r.timestamp_local}</span>
                    <span className="muted">{r.age_text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {!loading && !error && activeTab === "H1 Candle Data" && (
        <>
          <div className="panel ops-card">
            <h2 className="ops-card-title">Price Candle Data (Manual Upload)</h2>
            <p className="muted">Upload MT5 H1 candles CSV in manual mode.</p>
            <input className="control-field" type="file" accept=".csv" onChange={(e) => setPriceFile(e.target.files?.[0] ?? null)} />
            <div className="row surface-toolbar">
              <button type="button" className="btn btn-primary" disabled={!priceFile || longJobActive || busyAction === "upload-price"} onClick={() => void uploadPriceManual()}>
                {busyAction === "upload-price" ? "Queuing..." : "Upload Price Candle Data"}
              </button>
            </div>
          </div>

          <div className="panel ops-card">
            <h2 className="ops-card-title">Price Preview (Newest 50 rows for {activePair})</h2>
            <DataTable rows={pricePreviewRows} emptyText="No price data loaded." />
          </div>
        </>
      )}

      {!loading && !error && activeTab === "Economic Calendar Data" && (
        <>
          <div className="panel ops-card">
            <h2 className="ops-card-title">Economic Calendar Data (Manual Upload)</h2>
            <p className="muted">Upload MT5 calendar export (.csv, .htm, .html).</p>
            <input className="control-field" type="file" accept=".csv,.htm,.html" onChange={(e) => setCalendarFile(e.target.files?.[0] ?? null)} />
            <div className="row surface-toolbar">
              <button
                type="button"
                className="btn btn-primary ui-interactive ui-hover-lift"
                disabled={!calendarFile || longJobActive || busyAction === "upload-calendar"}
                onClick={() => void uploadCalendarManual()}
              >
                {busyAction === "upload-calendar" ? "Queuing..." : "Upload Economic Calendar Data"}
              </button>
            </div>
          </div>

          <div className="panel ops-card">
            <h2 className="ops-card-title">Calendar Preview (50 rows)</h2>
            <DataTable rows={calendarPreviewRows} emptyText="No calendar data loaded." />
          </div>
        </>
      )}

      {!loading && !error && activeTab === "FRED Data" && (
        <>
          <div className="panel ops-card">
            <h2 className="ops-card-title">FRED Data</h2>
            <p className="muted">Policy and Inflation source tables with per-series status/error rows.</p>
            <div className="fred-action-row surface-toolbar">
              <div className="fred-key-inline">
                <label htmlFor="fred-key-inline">FRED API Key (optional overwrite)</label>
                <input
                  className="control-field"
                  id="fred-key-inline"
                  type="password"
                  value={fredApiKey}
                  onChange={(e) => setFredApiKey(e.target.value)}
                  placeholder={runtimeConfig?.fred_key_configured ? "Configured. Enter new key to overwrite." : "Enter key to enable macro module"}
                />
              </div>
              <button type="button" className="btn btn-primary" disabled={longJobActive || busyAction === "fred-refresh"} onClick={() => void refreshFred()}>
                {busyAction === "fred-refresh" ? "Queuing..." : "Refresh FRED Data"}
              </button>
            </div>
          </div>

          <div className="panel-grid">
            <div className="panel ops-card">
              <h3 className="ops-card-title">Policy</h3>
              <DataTable rows={fredPolicyRows} emptyText="No policy snapshot rows." variant="dense" />
            </div>
            <div className="panel ops-card">
              <h3 className="ops-card-title">Inflation</h3>
              <DataTable rows={fredInflRows} emptyText="No inflation snapshot rows." variant="dense" />
            </div>
          </div>
        </>
      )}
    </section>
  );
}



















