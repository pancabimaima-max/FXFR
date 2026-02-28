import { useCallback, useEffect, useState } from "react";

import { fetchBootstrap } from "@/api/client";
import { SidebarNav } from "@/components/SidebarNav";
import { TopCommandBar } from "@/components/TopCommandBar";
import { ChartsPage } from "@/pages/ChartsPage";
import { DashboardPage } from "@/pages/DashboardPage";
import { DataChecklistPage } from "@/pages/DataChecklistPage";
import { FundamentalToolsPage } from "@/pages/FundamentalToolsPage";
import { LogsPage } from "@/pages/LogsPage";
import { DEFAULT_MAJOR_USD_PAIRS, isValidFxPair, useAppStore } from "@/store/useAppStore";

type EngineRuntimeInfo = {
  engine_url: string;
  sidecar_mode: string;
  sidecar_managed: boolean;
  last_error: string;
};

type EngineBootstrapHandoff = {
  session_token: string;
  first_launch_complete: boolean;
  display_timezone: string;
  server_timezone: string;
  macro_enabled: boolean;
  macro_disabled_reason: string;
  worker_pool_size: number;
  data_root: string;
};

async function fetchEngineRuntimeInfo(): Promise<EngineRuntimeInfo | null> {
  const tauriInvoke = (window as any)?.__TAURI__?.core?.invoke;
  if (typeof tauriInvoke !== "function") {
    return null;
  }
  try {
    return (await tauriInvoke("engine_runtime_info")) as EngineRuntimeInfo;
  } catch {
    return null;
  }
}

async function fetchBootstrapFromSidecar(): Promise<EngineBootstrapHandoff | null> {
  const tauriInvoke = (window as any)?.__TAURI__?.core?.invoke;
  if (typeof tauriInvoke !== "function") {
    return null;
  }
  try {
    return (await tauriInvoke("engine_bootstrap_handoff")) as EngineBootstrapHandoff;
  } catch {
    return null;
  }
}

function classifyBootstrapError(error: unknown): { message: string; diagnostic: string } {
  const message = error instanceof Error ? error.message : "Bootstrap failed";
  const normalized = message.toLowerCase();

  if (normalized.includes("cannot reach engine")) {
    return {
      message,
      diagnostic:
        "Engine is not reachable from the UI. Check engine process health and CORS origins (localhost:5173/127.0.0.1:5173).",
    };
  }

  if (normalized.includes("request failed (403)")) {
    return {
      message,
      diagnostic: "Engine responded with 403. This usually indicates CORS/origin rejection or localhost guard policy.",
    };
  }

  if (normalized.includes("request failed (401)")) {
    return {
      message,
      diagnostic: "Engine is reachable but session auth failed. Retry bootstrap to refresh the session token.",
    };
  }

  if (normalized.includes("request failed (")) {
    return {
      message,
      diagnostic: "Engine responded with a non-OK HTTP status. Inspect engine logs and startup diagnostics.",
    };
  }

  return {
    message,
    diagnostic: "Unknown bootstrap error. Verify engine startup logs and retry bootstrap.",
  };
}

function resolveInitialActivePair(currentPair: string): string {
  const url = new URL(window.location.href);
  const queryPair = String(url.searchParams.get("pair") ?? "").trim().toUpperCase();
  if (isValidFxPair(queryPair)) {
    return queryPair;
  }

  const existing = String(currentPair || "").trim().toUpperCase();
  if (isValidFxPair(existing)) {
    return existing;
  }

  return DEFAULT_MAJOR_USD_PAIRS[0];
}

function MainSurface() {
  const activePage = useAppStore((s) => s.activePage);
  const bootstrap = useAppStore((s) => s.bootstrap);
  if (!bootstrap) {
    return null;
  }
  const token = bootstrap.sessionToken;

  if (activePage === "Data Checklist") return <DataChecklistPage sessionToken={token} />;
  if (activePage === "Dashboard") return <DashboardPage sessionToken={token} />;
  if (activePage === "Fundamental Tools") return <FundamentalToolsPage sessionToken={token} />;
  if (activePage === "Charts (BETA)") return <ChartsPage sessionToken={token} />;
  if (activePage === "Logs") return <LogsPage sessionToken={token} />;
  return null;
}

export function App() {
  const loading = useAppStore((s) => s.loading);
  const setLoading = useAppStore((s) => s.setLoading);
  const bootstrap = useAppStore((s) => s.bootstrap);
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const activePair = useAppStore((s) => s.activePair);
  const commandBarMode = useAppStore((s) => s.commandBarMode);
  const setBootstrap = useAppStore((s) => s.setBootstrap);
  const setActivePair = useAppStore((s) => s.setActivePair);
  const setInitialized = useAppStore((s) => s.setInitialized);
  const [error, setError] = useState("");
  const [diagnostic, setDiagnostic] = useState("");
  const [sidecarInfo, setSidecarInfo] = useState<EngineRuntimeInfo | null>(null);
  const engineUrl = sidecarInfo?.engine_url ?? (import.meta.env.VITE_ENGINE_URL ?? "http://127.0.0.1:8765");

  const runBootstrap = useCallback(async () => {
    setLoading(true);
    setError("");
    setDiagnostic("");

    const runtimeInfo = await fetchEngineRuntimeInfo();
    setSidecarInfo(runtimeInfo);

    try {
      const sidecarBootstrap = await fetchBootstrapFromSidecar();
      if (sidecarBootstrap) {
        setBootstrap({
          sessionToken: sidecarBootstrap.session_token,
          firstLaunchComplete: sidecarBootstrap.first_launch_complete,
          displayTimezone: sidecarBootstrap.display_timezone,
          serverTimezone: sidecarBootstrap.server_timezone,
          macroEnabled: sidecarBootstrap.macro_enabled,
          macroDisabledReason: sidecarBootstrap.macro_disabled_reason,
        });
        setActivePair(resolveInitialActivePair(useAppStore.getState().activePair));
        setInitialized(true);
        return;
      }

      const maxAttempts = 10;
      let response: Awaited<ReturnType<typeof fetchBootstrap>> | null = null;
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          response = await fetchBootstrap();
          break;
        } catch (err) {
          lastError = err;
          if (attempt < maxAttempts) {
            const backoffMs = attempt <= 5 ? 300 : 700;
            await new Promise((resolve) => window.setTimeout(resolve, backoffMs));
          }
        }
      }

      if (!response) {
        throw lastError ?? new Error("Bootstrap failed");
      }

      setBootstrap({
        sessionToken: response.data.session_token,
        firstLaunchComplete: response.data.first_launch_complete,
        displayTimezone: response.data.display_timezone,
        serverTimezone: response.data.server_timezone,
        macroEnabled: response.data.macro_enabled,
        macroDisabledReason: response.data.macro_disabled_reason,
      });
      setActivePair(resolveInitialActivePair(useAppStore.getState().activePair));
      setInitialized(true);
    } catch (err) {
      const classified = classifyBootstrapError(err);
      const sidecarSuffix = runtimeInfo
        ? ` Sidecar mode=${runtimeInfo.sidecar_mode}, managed=${runtimeInfo.sidecar_managed}, error=${runtimeInfo.last_error || "none"}.`
        : "";
      setError(classified.message);
      setDiagnostic(`${classified.diagnostic}${sidecarSuffix}`.trim());
    } finally {
      setLoading(false);
    }
  }, [setActivePair, setBootstrap, setInitialized, setLoading]);

  useEffect(() => {
    void runBootstrap();
  }, [runBootstrap]);

  useEffect(() => {
    if (!isValidFxPair(activePair)) {
      return;
    }
    const normalized = activePair.toUpperCase();
    const url = new URL(window.location.href);
    if (url.searchParams.get("pair") !== normalized) {
      url.searchParams.set("pair", normalized);
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [activePair]);

  if (loading) {
    return <div className="screen-center">Bootstrapping desktop runtime...</div>;
  }

  if (error) {
    return (
      <div className="screen-center">
        <div className="bootstrap-error bootstrap-state-card">
          <div className="error-text bootstrap-state-title">Bootstrap error: {error}</div>
          <div className="muted bootstrap-state-body">Desktop UI could not connect to the engine service.</div>
          <div className="muted">
            Expected engine URL: <span className="mono">{engineUrl}</span>
          </div>
          <div className="muted">
            Recommended: <span className="mono">pnpm dev:fullstack</span> from <span className="mono">C:\\dev\\fxfr_desktop</span>
          </div>
          {sidecarInfo && (
            <div className="muted">
              Sidecar mode: <span className="mono">{sidecarInfo.sidecar_mode}</span>, managed: {String(sidecarInfo.sidecar_managed)}
            </div>
          )}
          {diagnostic && <div className="muted bootstrap-state-body">Diagnostics: {diagnostic}</div>}
          <div className="bootstrap-actions bootstrap-state-actions">
            <button type="button" className="bootstrap-retry btn btn-primary ui-interactive ui-hover-lift" onClick={() => void runBootstrap()}>
              Retry bootstrap
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!bootstrap) {
    return <div className="screen-center error-text">Missing bootstrap payload.</div>;
  }

  return (
    <main className="app-root">
      <SidebarNav />
      <section className="content">
        <TopCommandBar
          mode={commandBarMode}
          activePage={activePage}
          onNavigate={setActivePage}
          activePair={activePair}
          macroEnabled={bootstrap.macroEnabled}
        />
        {!bootstrap.macroEnabled && (
          <div className="warning-banner runtime-warning-banner">Macro module disabled: {bootstrap.macroDisabledReason}</div>
        )}
        <MainSurface />
      </section>
    </main>
  );
}

