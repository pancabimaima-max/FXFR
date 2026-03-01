import type {
  FundamentalDifferentialData,
  ResponseEnvelope,
  RuntimeConfigApplyData,
  RuntimeConfigData,
  SwapConfigData,
} from "@fxfr/contracts";

function resolveApiBase() {
  if (typeof window !== "undefined") {
    const runtimeUrl = (window as Window & { __FXFR_ENGINE_URL?: string }).__FXFR_ENGINE_URL;
    if (runtimeUrl && runtimeUrl.trim().length > 0) {
      return runtimeUrl;
    }
  }
  return import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8765";
}

function withQuery(path: string, params?: Record<string, string | number | boolean | undefined>) {
  if (!params) return path;
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    search.set(k, String(v));
  }
  const q = search.toString();
  return q ? `${path}?${q}` : path;
}

async function request<T>(
  path: string,
  opts: RequestInit = {},
  sessionToken?: string,
): Promise<ResponseEnvelope<T>> {
  const apiBase = resolveApiBase();
  const headers = new Headers(opts.headers ?? {});
  if (sessionToken) {
    headers.set("x-session-token", sessionToken);
  }

  const isFormData = typeof FormData !== "undefined" && opts.body instanceof FormData;
  if (!isFormData && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBase}${path}`, {
      ...opts,
      headers,
    });
  } catch {
    throw new Error(`Cannot reach engine at ${apiBase}. Start the engine service and retry.`);
  }

  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.text()).trim();
    } catch {
      detail = "";
    }
    const suffix = detail ? `: ${detail.slice(0, 240)}` : "";
    throw new Error(`Request failed (${response.status})${suffix}`);
  }

  return (await response.json()) as ResponseEnvelope<T>;
}

export async function fetchBootstrap() {
  return request<{
    session_token: string;
    first_launch_complete: boolean;
    display_timezone: string;
    server_timezone: string;
    macro_enabled: boolean;
    macro_disabled_reason: string;
    worker_pool_size: number;
    data_root: string;
  }>("/v1/bootstrap");
}

export async function fetchChecklist(sessionToken: string, symbol?: string) {
  return request<any>(withQuery("/v1/checklist/overview", { symbol }), { method: "GET" }, sessionToken);
}

export async function fetchRuntimeConfig(sessionToken: string) {
  return request<RuntimeConfigData>("/v1/config/runtime", { method: "GET" }, sessionToken);
}

export async function postRuntimeConfigApply(
  sessionToken: string,
  payload: { mt5_folder: string; fred_api_key?: string; release_channel?: "stable" | "beta" },
) {
  return request<RuntimeConfigApplyData>(
    "/v1/config/runtime/apply",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function postTimezoneApply(
  sessionToken: string,
  payload: { display_timezone: string; server_timezone: string },
) {
  return request<{ applied: { display_timezone: string; server_timezone: string } }>(
    "/v1/timezone/apply",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function postIngestPrice(
  sessionToken: string,
  file: File,
  sourceTimezone: string,
  asyncJob = true,
) {
  const form = new FormData();
  form.append("file", file);
  return request<any>(
    withQuery("/v1/ingest/price", {
      source_timezone: sourceTimezone,
      async_job: asyncJob,
    }),
    {
      method: "POST",
      body: form,
    },
    sessionToken,
  );
}

export async function postIngestCalendar(
  sessionToken: string,
  file: File,
  sourceTimezone: string,
  asyncJob = true,
) {
  const form = new FormData();
  form.append("file", file);
  return request<any>(
    withQuery("/v1/ingest/calendar", {
      source_timezone: sourceTimezone,
      async_job: asyncJob,
    }),
    {
      method: "POST",
      body: form,
    },
    sessionToken,
  );
}

export async function postAutoFetchApplySync(
  sessionToken: string,
  payload: {
    section: "full" | "price" | "calendar";
    enabled: boolean;
    mt5_folder: string;
    price_pattern: string;
    calendar_pattern: string;
    interval_hours: number;
  },
) {
  return request<any>(
    "/v1/autofetch/apply-sync",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function fetchPricePreview(sessionToken: string, limit = 50, symbol?: string) {
  return request<{
    rows: Record<string, unknown>[];
    count: number;
    resolved_symbol?: string;
    preview_max_time_utc?: string;
    debug?: {
      source_rows?: number;
      filtered_rows?: number;
      dropped_invalid_time_rows?: number;
    };
  }>(
    withQuery("/v1/preview/price", { limit, symbol }),
    { method: "GET" },
    sessionToken,
  );
}

export type CalendarPreviewParams = {
  sort_by?: "event_time_utc" | "server_datetime";
  sort_dir?: "asc" | "desc";
  date_preset?: "all_dates" | "yesterday" | "today" | "tomorrow" | "this_week" | "next_week" | "custom";
  date_from?: string;
  date_to?: string;
  local_anchor?: string;
  currencies_csv?: string;
  categories_csv?: string;
  impacts_csv?: string;
};

export async function fetchCalendarPreview(sessionToken: string, limit = 50, params: CalendarPreviewParams = {}) {
  return request<{
    rows: Record<string, unknown>[];
    count: number;
    filtered_count?: number;
    filter_options?: {
      currencies?: string[];
      categories?: string[];
      impacts?: string[];
    };
  }>(
    withQuery("/v1/preview/calendar", { limit, ...params }),
    { method: "GET" },
    sessionToken,
  );
}

export async function postFredRefresh(sessionToken: string) {
  return request<any>("/v1/fred/refresh", { method: "POST" }, sessionToken);
}

export async function fetchFredSnapshot(sessionToken: string, kind: "policy" | "inflation") {
  return request<any>(withQuery("/v1/fred/snapshot", { kind }), { method: "GET" }, sessionToken);
}

export async function fetchFundamentalDifferential(
  sessionToken: string,
  payload: { base: string; quote: string; pair?: string; inflation_mode: "yoy" | "mom" },
) {
  return request<FundamentalDifferentialData>(
    withQuery("/v1/fundamental/differential", payload),
    { method: "GET" },
    sessionToken,
  );
}

export async function fetchDashboardCards(
  sessionToken: string,
  params?: {
    symbol_query?: string;
    sort_by?: string;
    watchlist_csv?: string;
    watchlist_only?: boolean;
    card_limit?: number;
    inflation_mode?: "yoy" | "mom";
  },
) {
  return request<any>(withQuery("/v1/dashboard/cards", params), { method: "GET" }, sessionToken);
}

export async function fetchSwapConfig(
  sessionToken: string,
  params?: { symbols_csv?: string },
) {
  return request<SwapConfigData>(withQuery("/v1/swap-config", params), { method: "GET" }, sessionToken);
}

export async function fetchChartSeries(sessionToken: string, symbol: string, limit = 1000) {
  return request<any>(withQuery("/v1/charts/series", { symbol, limit }), { method: "GET" }, sessionToken);
}

export async function fetchLogs(
  sessionToken: string,
  params?: { levels?: string; lookback_hours?: number; limit?: number; source?: "session" | "file" | "both" },
) {
  return request<any>(withQuery("/v1/logs", params), { method: "GET" }, sessionToken);
}

export async function postPromoteMetric(
  sessionToken: string,
  payload: { metric_key: string; version_tag: string },
) {
  return request<any>(
    "/v1/tools/promote-metric",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function postSwapConfig(
  sessionToken: string,
  payload: { symbol: string; swap_drag_bps: number },
) {
  return request<any>(
    "/v1/swap-config",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function postWizardSetup(
  sessionToken: string,
  payload: { mt5_folder: string; top_pairs: string[]; fred_api_key: string },
) {
  return request<any>(
    "/v1/wizard/setup",
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
    sessionToken,
  );
}

export async function checkDesktopUpdateManifest(manifestUrl: string): Promise<Record<string, unknown>> {
  const url = String(manifestUrl || "").trim();
  if (!url) {
    throw new Error("Release manifest URL is empty. Configure release feed first.");
  }

  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store" });
  } catch {
    throw new Error(`Unable to fetch release manifest: ${url}`);
  }

  if (!response.ok) {
    throw new Error(`Release manifest request failed (${response.status})`);
  }

  const payload = (await response.json()) as Record<string, unknown>;
  return payload;
}

export async function fetchJob(sessionToken: string, jobId: string) {
  return request<any>(withQuery(`/v1/jobs/${jobId}`), { method: "GET" }, sessionToken);
}

export async function postCancelJob(sessionToken: string, jobId: string) {
  return request<any>(
    withQuery(`/v1/jobs/${jobId}/cancel`),
    {
      method: "POST",
    },
    sessionToken,
  );
}
