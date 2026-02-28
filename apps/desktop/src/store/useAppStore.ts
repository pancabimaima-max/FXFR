import { create } from "zustand";

export type AppPage =
  | "Data Checklist"
  | "Dashboard"
  | "Fundamental Tools"
  | "Charts (BETA)"
  | "Logs"
  | "Developer Tab";

export type CommandBarMode = "full" | "slim" | "hidden";

const UI_PREFS_STORAGE_KEY = "fxfr_ui_prefs_v1";

export const DEFAULT_MAJOR_USD_PAIRS = [
  "EURUSD",
  "GBPUSD",
  "AUDUSD",
  "NZDUSD",
  "USDCAD",
  "USDCHF",
  "USDJPY",
] as const;

export const DEFAULT_STRENGTH_WATCHLIST = ["EUR", "GBP", "JPY", "AUD", "NZD", "CAD", "CHF", "USD"] as const;

export function isValidFxPair(value: string | null | undefined): value is string {
  return /^[A-Z]{6}$/.test(String(value ?? "").trim().toUpperCase());
}

function isCommandBarMode(value: unknown): value is CommandBarMode {
  return value === "full" || value === "slim" || value === "hidden";
}

function readStoredCommandBarMode(): CommandBarMode {
  if (typeof window === "undefined") {
    return "full";
  }
  try {
    const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
    if (!raw) {
      return "full";
    }
    const parsed = JSON.parse(raw) as { commandBarMode?: unknown };
    if (isCommandBarMode(parsed.commandBarMode)) {
      return parsed.commandBarMode;
    }
  } catch {
    // Ignore malformed local preference payload and keep defaults.
  }
  return "full";
}

function persistCommandBarMode(mode: CommandBarMode): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const next = { ...parsed, commandBarMode: mode };
    window.localStorage.setItem(UI_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage write errors to avoid blocking UI state updates.
  }
}

type BootstrapState = {
  sessionToken: string;
  firstLaunchComplete: boolean;
  displayTimezone: string;
  serverTimezone: string;
  macroEnabled: boolean;
  macroDisabledReason: string;
};

type AppState = {
  initialized: boolean;
  loading: boolean;
  activePage: AppPage;
  activePair: string;
  commandBarMode: CommandBarMode;
  bootstrap: BootstrapState | null;
  setInitialized: (ready: boolean) => void;
  setLoading: (loading: boolean) => void;
  setActivePage: (page: AppPage) => void;
  setActivePair: (pair: string) => void;
  setCommandBarMode: (mode: CommandBarMode) => void;
  setBootstrap: (payload: BootstrapState) => void;
};

export const pages: AppPage[] = [
  "Data Checklist",
  "Dashboard",
  "Fundamental Tools",
  "Charts (BETA)",
  "Logs",
  "Developer Tab",
];

const defaultCommandBarMode = readStoredCommandBarMode();

export const useAppStore = create<AppState>((set) => ({
  initialized: false,
  loading: true,
  activePage: "Data Checklist",
  activePair: DEFAULT_MAJOR_USD_PAIRS[0],
  commandBarMode: defaultCommandBarMode,
  bootstrap: null,
  setInitialized: (ready) => set({ initialized: ready }),
  setLoading: (loading) => set({ loading }),
  setActivePage: (page) => set({ activePage: page }),
  setActivePair: (pair) =>
    set({
      activePair: isValidFxPair(pair) ? String(pair).trim().toUpperCase() : DEFAULT_MAJOR_USD_PAIRS[0],
    }),
  setCommandBarMode: (mode) => {
    const normalized = isCommandBarMode(mode) ? mode : "full";
    persistCommandBarMode(normalized);
    set({ commandBarMode: normalized });
  },
  setBootstrap: (payload) => set({ bootstrap: payload }),
}));
