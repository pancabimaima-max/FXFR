import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import type { WsEvent } from "@fxfr/contracts";

import {
  type CalendarPreviewParams,
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

type PricePreviewMeta = {
  resolvedSymbol: string;
  newestCandleUtc: string;
  newestCandleLocal: string;
  totalRows: number;
  sourceRows: number;
  filteredRows: number;
  droppedInvalidTimeRows: number;
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

function formatDateTime(value: string): string {
  if (!value) return "n/a";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString([], { hour12: false });
}

const policyOfficialNotes: Record<string, string> = {
  AUD: "Official 3.85% (RBA target, 4 Feb 2026)",
  CAD: "Official 2.25% (BoC target, 28 Jan 2026)",
  EUR: "Official 2.00% deposit (ECB, 27 Feb 2026)",
  GBP: "Official 3.75% (BoE, Feb 2026)",
  JPY: "Official 0.75% (BOJ, Jan 2026)",
  USD: "Official 3.50–3.75% (Fed, effective 3.64%)",
};

function toDisplayNumber(value: unknown, digits = 2): string {
  const asNum = Number(value);
  if (!Number.isFinite(asNum)) return "n/a";
  return asNum.toFixed(digits);
}

function toObservationsArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === "number") return entry;
      if (typeof entry === "string") return Number(entry);
      if (entry && typeof entry === "object") {
        const maybeObj = entry as Record<string, unknown>;
        return Number(maybeObj.value ?? maybeObj.v ?? maybeObj.index ?? NaN);
      }
      return Number.NaN;
    })
    .filter((num) => Number.isFinite(num));
}

function computeInflationDeltasFromObservations(observations: number[]): { yoy: number | null; mom: number | null } {
  if (observations.length < 13) {
    return { yoy: null, mom: null };
  }
  const latest = observations[observations.length - 1];
  const previousMonth = observations[observations.length - 2];
  const previousYear = observations[observations.length - 13];
  if (!Number.isFinite(latest) || !Number.isFinite(previousMonth) || !Number.isFinite(previousYear)) {
    return { yoy: null, mom: null };
  }
  if (previousMonth === 0 || previousYear === 0) {
    return { yoy: null, mom: null };
  }
  const yoy = ((latest / previousYear) - 1) * 100;
  const mom = ((latest / previousMonth) - 1) * 100;
  return {
    yoy: Number.isFinite(yoy) ? Number(yoy.toFixed(1)) : null,
    mom: Number.isFinite(mom) ? Number(mom.toFixed(1)) : null,
  };
}

function normalizeFredRow(row: Record<string, unknown>) {
  return {
    currency: String(row.currency ?? "").trim().toUpperCase(),
    seriesId: String(row.series_id ?? ""),
    value: row.value,
    aux: row.aux,
    asOfUtc: String(row.as_of_utc ?? ""),
    status: String(row.status ?? ""),
    errorMessage: String(row.error_message ?? ""),
    refreshedAtUtc: String(row.refreshed_at_utc ?? ""),
  };
}

function statusToneClass(status: string): string {
  const token = status.trim().toLowerCase();
  if (token === "ok") return "text-emerald-400";
  if (token === "error") return "text-red-400";
  return "text-amber-300";
}

function formatPercent(value: number | null): string {
  if (value === null) return "n/a";
  return `${value.toFixed(1)}%`;
}

type CalendarDatePreset = "all_dates" | "yesterday" | "today" | "tomorrow" | "this_week" | "next_week" | "custom";

const calendarDatePresetItems: Array<{ value: CalendarDatePreset; label: string }> = [
  { value: "all_dates", label: "All Dates" },
  { value: "yesterday", label: "Yesterday" },
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "this_week", label: "This Week" },
  { value: "next_week", label: "Next Week" },
  { value: "custom", label: "Custom Date" },
];

const currencyToFlagCode: Record<string, string> = {
  AUD: "au",
  CAD: "ca",
  CHF: "ch",
  CNY: "cn",
  EUR: "eu",
  GBP: "gb",
  JPY: "jp",
  NZD: "nz",
  USD: "us",
};

const currencyToCountryLabel: Record<string, string> = {
  AUD: "Australia",
  CAD: "Canada",
  CHF: "Switzerland",
  CNY: "China",
  EUR: "Europe",
  GBP: "United Kingdom",
  JPY: "Japan",
  NZD: "New Zealand",
  USD: "United States",
};

function getRowValue(row: Record<string, unknown>, keys: string[]): unknown {
  const keyMap = new Map<string, string>();
  for (const existingKey of Object.keys(row)) {
    keyMap.set(existingKey.toLowerCase(), existingKey);
  }
  for (const key of keys) {
    if (key in row) {
      return row[key];
    }
    const matchedKey = keyMap.get(key.toLowerCase());
    if (matchedKey) {
      return row[matchedKey];
    }
  }
  return undefined;
}

function asDisplayText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
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
  const [pricePreviewMeta, setPricePreviewMeta] = useState<PricePreviewMeta>({
    resolvedSymbol: "",
    newestCandleUtc: "",
    newestCandleLocal: "",
    totalRows: 0,
    sourceRows: 0,
    filteredRows: 0,
    droppedInvalidTimeRows: 0,
  });
  const [calendarPreviewRows, setCalendarPreviewRows] = useState<Record<string, unknown>[]>([]);
  const [calendarFilteredCount, setCalendarFilteredCount] = useState(0);
  const [calendarFilterOptions, setCalendarFilterOptions] = useState<{
    currencies: string[];
    categories: string[];
    impacts: string[];
  }>({
    currencies: [],
    categories: [],
    impacts: [],
  });
  const [calendarPreset, setCalendarPreset] = useState<CalendarDatePreset>("all_dates");
  const [calendarCustomFrom, setCalendarCustomFrom] = useState("");
  const [calendarCustomTo, setCalendarCustomTo] = useState("");
  const [calendarCountry, setCalendarCountry] = useState("ALL");
  const [calendarCategory, setCalendarCategory] = useState("ALL");
  const [calendarImpact, setCalendarImpact] = useState("ALL");
  const [calendarSortBy] = useState<"event_time_utc" | "server_datetime">("event_time_utc");
  const [calendarSortDir] = useState<"asc" | "desc">("desc");
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [fredPolicyRows, setFredPolicyRows] = useState<Record<string, unknown>[]>([]);
  const [fredInflRows, setFredInflRows] = useState<Record<string, unknown>[]>([]);
  const [policyManualOverrides, setPolicyManualOverrides] = useState<Record<string, number>>({});
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

  const buildCalendarPreviewParams = useCallback((): CalendarPreviewParams => {
    const localAnchor = String(overview?.market_session?.local_time ?? "").trim();
    return {
      sort_by: calendarSortBy,
      sort_dir: calendarSortDir,
      date_preset: calendarPreset,
      date_from: calendarPreset === "custom" ? calendarCustomFrom : "",
      date_to: calendarPreset === "custom" ? calendarCustomTo : "",
      local_anchor: localAnchor,
      currencies_csv: calendarCountry !== "ALL" ? calendarCountry : "",
      categories_csv: calendarCategory !== "ALL" ? calendarCategory : "",
      impacts_csv: calendarImpact !== "ALL" ? calendarImpact : "",
    };
  }, [
    overview?.market_session?.local_time,
    calendarSortBy,
    calendarSortDir,
    calendarPreset,
    calendarCustomFrom,
    calendarCustomTo,
    calendarCountry,
    calendarCategory,
    calendarImpact,
  ]);

  const loadCalendarPreview = useCallback(async () => {
    setCalendarLoading(true);
    try {
      const calendarRes = await fetchCalendarPreview(sessionToken, 50, buildCalendarPreviewParams());
      const data = calendarRes.data ?? {};
      setCalendarPreviewRows(data.rows ?? []);
      setCalendarFilteredCount(Number(data.filtered_count ?? 0));
      setCalendarFilterOptions({
        currencies: Array.isArray(data.filter_options?.currencies) ? data.filter_options.currencies.map(String) : [],
        categories: Array.isArray(data.filter_options?.categories) ? data.filter_options.categories.map(String) : [],
        impacts: Array.isArray(data.filter_options?.impacts) ? data.filter_options.impacts.map(String) : [],
      });
    } finally {
      setCalendarLoading(false);
    }
  }, [sessionToken, buildCalendarPreviewParams]);

  async function loadPreviews() {
    const priceRes = await fetchPricePreview(sessionToken, 50, activePair);
    const priceData = priceRes.data ?? {};
    const newestUtc = String(priceData.preview_max_time_utc ?? "");
    setPricePreviewRows(priceData.rows ?? []);
    setPricePreviewMeta({
      resolvedSymbol: String(priceData.resolved_symbol ?? ""),
      newestCandleUtc: newestUtc,
      newestCandleLocal: newestUtc ? formatDateTime(newestUtc) : "",
      totalRows: Number(priceData.count ?? 0),
      sourceRows: Number(priceData.debug?.source_rows ?? 0),
      filteredRows: Number(priceData.debug?.filtered_rows ?? 0),
      droppedInvalidTimeRows: Number(priceData.debug?.dropped_invalid_time_rows ?? 0),
    });
    await loadCalendarPreview();
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
    if (loading || error || activeTab !== "Economic Calendar Data") {
      return;
    }
    void loadCalendarPreview();
  }, [activeTab, loading, error, loadCalendarPreview]);

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
      setCalendarPreset("all_dates");
      setCalendarCustomFrom("");
      setCalendarCustomTo("");
      setCalendarCountry("ALL");
      setCalendarCategory("ALL");
      setCalendarImpact("ALL");
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
  const overallScoreRaw = Number(overview?.total_score);
  const overallScorePct = Number.isFinite(overallScoreRaw) ? Math.max(0, Math.min(100, Math.round(overallScoreRaw))) : 0;
  const normalizedPolicyRows = useMemo(() => fredPolicyRows.map(normalizeFredRow), [fredPolicyRows]);
  const normalizedInflRows = useMemo(
    () =>
      fredInflRows.map((row) => {
        const normalized = normalizeFredRow(row);
        const auxObj = (row.aux ?? {}) as Record<string, unknown>;
        const observations = toObservationsArray(auxObj.observations);
        const deltas = computeInflationDeltasFromObservations(observations);
        return {
          ...normalized,
          seriesId: normalized.currency === "AUD" ? "AUSCPALTT01IXNBQ" : normalized.seriesId,
          yoy: deltas.yoy,
          mom: deltas.mom,
        };
      }),
    [fredInflRows],
  );
  const normalizedCalendarRows = useMemo(
    () =>
      calendarPreviewRows.map((row) => {
        const currency = String(getRowValue(row, ["CURRENCY", "currency"]) ?? "").trim().toUpperCase();
        const category = String(getRowValue(row, ["CATEGORY", "category", "EVENT", "event"]) ?? "").trim();
        const impact = String(getRowValue(row, ["IMPACT", "impact", "PRIORITY", "priority"]) ?? "").trim();
        return {
          row,
          currency: currency || "n/a",
          country: currencyToCountryLabel[currency] ?? (currency || "n/a"),
          category: category || "n/a",
          impact: impact || "n/a",
          event: asDisplayText(getRowValue(row, ["EVENT", "event"])),
          period: asDisplayText(getRowValue(row, ["PERIOD", "period"])),
          actual: asDisplayText(getRowValue(row, ["ACTUAL", "actual"])),
          forecast: asDisplayText(getRowValue(row, ["FORECAST", "forecast"])),
          previous: asDisplayText(getRowValue(row, ["PREVIOUS", "previous"])),
          eventTimeUtc: asDisplayText(getRowValue(row, ["EVENTTIMEUTC", "EventTimeUTC", "TimeUTC", "time_utc"])),
          serverDateTime: asDisplayText(getRowValue(row, ["SERVERDATETIME", "ServerDateTime"])),
          timeMode: asDisplayText(getRowValue(row, ["TIMEMODE", "TimeMode"])),
          flagCode: currencyToFlagCode[currency],
        };
      }),
    [calendarPreviewRows],
  );

  function updatePolicyOverride(currency: string, rawInput: string) {
    const token = currency.trim().toUpperCase();
    if (!token) return;
    const next = rawInput.trim();
    setPolicyManualOverrides((prev) => {
      if (!next) {
        const cloned = { ...prev };
        delete cloned[token];
        return cloned;
      }
      const parsed = Number(next);
      if (!Number.isFinite(parsed)) {
        return prev;
      }
      return { ...prev, [token]: parsed };
    });
  }

  function clearPolicyOverride(currency: string) {
    const token = currency.trim().toUpperCase();
    setPolicyManualOverrides((prev) => {
      if (!(token in prev)) return prev;
      const cloned = { ...prev };
      delete cloned[token];
      return cloned;
    });
  }

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
              <div className="health-score-widget">
                <div className="health-score-ring" style={{ "--health-score": `${overallScorePct}%` } as CSSProperties}>
                  <span>{overallScorePct}%</span>
                </div>
                <p className="muted overview-kpi-caption">Section health score</p>
              </div>
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
            <p className="muted">
              Newest candle (UTC): {pricePreviewMeta.newestCandleUtc || "n/a"} | Local: {pricePreviewMeta.newestCandleLocal || "n/a"} | Symbol served:{" "}
              {pricePreviewMeta.resolvedSymbol || "n/a"} | Rows: {pricePreviewMeta.totalRows}
            </p>
            {pricePreviewMeta.resolvedSymbol && pricePreviewMeta.resolvedSymbol !== activePair && (
              <p className="muted">
                Symbol mismatch detected (requested {activePair}, served {pricePreviewMeta.resolvedSymbol}) - verify runtime is using latest engine build.
              </p>
            )}
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
            <h2 className="ops-card-title">Calendar Preview</h2>
            <p className="muted">
              Local clock anchor: {String(overview?.market_session?.local_time ?? "n/a")} | Rows shown: {normalizedCalendarRows.length} / {calendarFilteredCount}
            </p>
            <div className="calendar-preset-row">
              {calendarDatePresetItems.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={`btn btn-ghost ${calendarPreset === preset.value ? "active" : ""}`}
                  onClick={() => setCalendarPreset(preset.value)}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            {calendarPreset === "custom" && (
              <div className="form-grid calendar-custom-range">
                <div className="form-field">
                  <label>Custom From</label>
                  <input className="control-field" type="date" value={calendarCustomFrom} onChange={(e) => setCalendarCustomFrom(e.target.value)} />
                </div>
                <div className="form-field">
                  <label>Custom To</label>
                  <input className="control-field" type="date" value={calendarCustomTo} onChange={(e) => setCalendarCustomTo(e.target.value)} />
                </div>
              </div>
            )}
            <div className="form-grid calendar-filter-grid">
              <div className="form-field">
                <label>Country</label>
                <select className="control-field" value={calendarCountry} onChange={(e) => setCalendarCountry(e.target.value)}>
                  <option value="ALL">All Countries</option>
                  {calendarFilterOptions.currencies.map((token) => (
                    <option key={token} value={token}>
                      {currencyToCountryLabel[token] ? `${token} - ${currencyToCountryLabel[token]}` : token}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Category</label>
                <select className="control-field" value={calendarCategory} onChange={(e) => setCalendarCategory(e.target.value)}>
                  <option value="ALL">All Categories</option>
                  {calendarFilterOptions.categories.map((token) => (
                    <option key={token} value={token}>
                      {token}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-field">
                <label>Impact</label>
                <select className="control-field" value={calendarImpact} onChange={(e) => setCalendarImpact(e.target.value)}>
                  <option value="ALL">All Impacts</option>
                  {calendarFilterOptions.impacts.map((token) => (
                    <option key={token} value={token}>
                      {token}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {calendarLoading ? (
              <p className="muted">Loading calendar preview...</p>
            ) : normalizedCalendarRows.length === 0 ? (
              <div className="panel muted empty-state-card">No calendar data loaded.</div>
            ) : (
              <div className="table-wrap calendar-preview-wrap ui-scroll-region">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Flag</th>
                      <th>Country</th>
                      <th>Category</th>
                      <th>Impact</th>
                      <th>Event</th>
                      <th>Period</th>
                      <th>Actual</th>
                      <th>Forecast</th>
                      <th>Previous</th>
                      <th>EventTimeUTC</th>
                      <th>ServerDateTime</th>
                      <th>TimeMode</th>
                    </tr>
                  </thead>
                  <tbody>
                    {normalizedCalendarRows.map((row, idx) => (
                      <tr key={`${row.currency}-${row.eventTimeUtc}-${idx}`}>
                        <td>
                          {row.flagCode ? (
                            <span className={`fi fi-${row.flagCode} calendar-flag`} title={row.country} />
                          ) : (
                            <span className="calendar-flag-fallback">{row.currency}</span>
                          )}
                        </td>
                        <td>{row.country}</td>
                        <td>{row.category}</td>
                        <td>{row.impact}</td>
                        <td>{row.event}</td>
                        <td>{row.period}</td>
                        <td>{row.actual}</td>
                        <td>{row.forecast}</td>
                        <td>{row.previous}</td>
                        <td>{row.eventTimeUtc}</td>
                        <td>{row.serverDateTime}</td>
                        <td>{row.timeMode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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
              {normalizedPolicyRows.length === 0 ? (
                <div className="rounded-md border border-red-400/30 bg-zinc-950/40 px-3 py-4 text-sm text-zinc-400">
                  No policy snapshot rows.
                </div>
              ) : (
                <div className="w-full overflow-x-auto rounded-md border border-red-500/30 bg-zinc-950/40">
                  <table className="min-w-[1120px] table-auto text-left text-xs text-zinc-200">
                    <thead className="border-b border-red-500/30 bg-zinc-900/90 text-[11px] uppercase tracking-wide text-zinc-300">
                      <tr>
                        <th className="px-3 py-2">CURRENCY</th>
                        <th className="px-3 py-2">SERIES_ID</th>
                        <th className="px-3 py-2">VALUE</th>
                        <th className="px-3 py-2">
                          <span className="inline-flex items-center gap-1">
                            MANUAL OVERRIDE
                            <span
                              className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-zinc-600 text-[10px] text-zinc-400"
                              title="Overrides FRED value. Persists across refreshes."
                            >
                              i
                            </span>
                          </span>
                        </th>
                        <th className="px-3 py-2">AUX</th>
                        <th className="px-3 py-2">AS_OF_UTC</th>
                        <th className="px-3 py-2">STATUS</th>
                        <th className="px-3 py-2">ERROR_MESSAGE</th>
                        <th className="px-3 py-2">OFFICIAL NOTE</th>
                        <th className="px-3 py-2">REFRESHED_AT_UTC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {normalizedPolicyRows.map((row) => {
                        const overrideValue = policyManualOverrides[row.currency];
                        const hasManualOverride = Number.isFinite(overrideValue);
                        return (
                          <tr key={`${row.currency}-${row.seriesId}-${row.refreshedAtUtc}`} className="align-top">
                            <td className="px-3 py-2 font-semibold text-zinc-100">{row.currency || "n/a"}</td>
                            <td className="px-3 py-2 font-mono text-zinc-300">{row.seriesId || "n/a"}</td>
                            <td className="px-3 py-2">
                              {hasManualOverride ? (
                                <span className="font-bold text-emerald-400">
                                  {toDisplayNumber(overrideValue, 2)} (manual)
                                </span>
                              ) : (
                                <span>{toDisplayNumber(row.value, 2)}</span>
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="inline-flex items-center gap-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  placeholder="—"
                                  className="w-24 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100 focus:border-red-400 focus:outline-none"
                                  value={hasManualOverride ? String(overrideValue) : ""}
                                  onChange={(e) => updatePolicyOverride(row.currency, e.target.value)}
                                />
                                {hasManualOverride && (
                                  <button
                                    type="button"
                                    className="rounded border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300 hover:border-red-400 hover:text-red-300"
                                    onClick={() => clearPolicyOverride(row.currency)}
                                    aria-label={`Clear override for ${row.currency}`}
                                  >
                                    ×
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-3 py-2 text-zinc-300">{String(row.aux ?? "")}</td>
                            <td className="px-3 py-2 text-zinc-300">{row.asOfUtc || "n/a"}</td>
                            <td className={`px-3 py-2 font-semibold ${statusToneClass(row.status)}`}>{row.status || "n/a"}</td>
                            <td className="max-w-[220px] px-3 py-2 text-red-300">{row.errorMessage || "—"}</td>
                            <td className="max-w-[280px] px-3 py-2 text-zinc-300">{policyOfficialNotes[row.currency] ?? "n/a"}</td>
                            <td className="px-3 py-2 text-zinc-300">{row.refreshedAtUtc || "n/a"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div className="panel ops-card">
              <h3 className="ops-card-title">Inflation</h3>
              {normalizedInflRows.length === 0 ? (
                <div className="rounded-md border border-red-400/30 bg-zinc-950/40 px-3 py-4 text-sm text-zinc-400">
                  No inflation snapshot rows.
                </div>
              ) : (
                <div className="w-full overflow-x-auto rounded-md border border-red-500/30 bg-zinc-950/40">
                  <table className="min-w-[1140px] table-auto text-left text-xs text-zinc-200">
                    <thead className="border-b border-red-500/30 bg-zinc-900/90 text-[11px] uppercase tracking-wide text-zinc-300">
                      <tr>
                        <th className="px-3 py-2">CURRENCY</th>
                        <th className="px-3 py-2">SERIES_ID</th>
                        <th className="px-3 py-2">INDEX</th>
                        <th className="px-3 py-2">YoY %</th>
                        <th className="px-3 py-2">MoM %</th>
                        <th className="px-3 py-2">AUX</th>
                        <th className="px-3 py-2">AS_OF_UTC</th>
                        <th className="px-3 py-2">STATUS</th>
                        <th className="px-3 py-2">ERROR_MESSAGE</th>
                        <th className="px-3 py-2">REFRESHED_AT_UTC</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {normalizedInflRows.map((row) => {
                        const yoyClass = row.yoy !== null && row.yoy > 2
                          ? "text-emerald-400"
                          : row.yoy !== null && row.yoy < 1
                            ? "text-red-400"
                            : "text-zinc-200";
                        return (
                          <tr key={`${row.currency}-${row.seriesId}-${row.refreshedAtUtc}`} className="align-top">
                            <td className="px-3 py-2 font-semibold text-zinc-100">{row.currency || "n/a"}</td>
                            <td className="px-3 py-2 font-mono text-zinc-300">{row.seriesId || "n/a"}</td>
                            <td className="px-3 py-2">{toDisplayNumber(row.value, 2)}</td>
                            <td className={`px-3 py-2 font-semibold ${yoyClass}`}>{formatPercent(row.yoy)}</td>
                            <td className="px-3 py-2">{formatPercent(row.mom)}</td>
                            <td className="px-3 py-2 text-zinc-300">{String(row.aux ?? "")}</td>
                            <td className="px-3 py-2 text-zinc-300">{row.asOfUtc || "n/a"}</td>
                            <td className={`px-3 py-2 font-semibold ${statusToneClass(row.status)}`}>{row.status || "n/a"}</td>
                            <td className="max-w-[220px] px-3 py-2 text-red-300">{row.errorMessage || "—"}</td>
                            <td className="px-3 py-2 text-zinc-300">{row.refreshedAtUtc || "n/a"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}



















