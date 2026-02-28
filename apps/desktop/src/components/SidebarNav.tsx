import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_MAJOR_USD_PAIRS,
  isValidFxPair,
  pages,
  type AppPage,
  useAppStore,
} from "@/store/useAppStore";

export function SidebarNav() {
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const activePair = useAppStore((s) => s.activePair);
  const setActivePair = useAppStore((s) => s.setActivePair);
  const commandBarMode = useAppStore((s) => s.commandBarMode);
  const bootstrap = useAppStore((s) => s.bootstrap);

  const [pairDraft, setPairDraft] = useState(activePair);

  useEffect(() => {
    setPairDraft(activePair);
  }, [activePair]);

  function applyPair() {
    const next = String(pairDraft || "").trim().toUpperCase();
    if (isValidFxPair(next)) {
      setActivePair(next);
      return;
    }
    setPairDraft(activePair);
  }

  function applyPresetPair(pair: string) {
    setPairDraft(pair);
    setActivePair(pair);
  }

  const macroLabel = useMemo(() => {
    if (!bootstrap) {
      return "Macro: Loading";
    }
    return bootstrap.macroEnabled ? "Macro: Live" : "Macro: Disabled";
  }, [bootstrap]);

  return (
    <aside className="sidebar sidebar-shell">
      <div className="sidebar-brand-block">
        <div className="sidebar-brand-title">FX Fundamentals Refresher</div>
        <div className="sidebar-brand-subtitle">Fundamental Terminal</div>
      </div>

      <div className="sidebar-pair-box sidebar-pair-card">
        <label htmlFor="global-active-pair">Active Pair</label>
        <input
          id="global-active-pair"
          className="control-field"
          value={pairDraft}
          onChange={(event) => setPairDraft(event.target.value.toUpperCase())}
          onBlur={applyPair}
          maxLength={6}
          placeholder={DEFAULT_MAJOR_USD_PAIRS[0]}
        />
        <div className="row sidebar-pair-actions surface-toolbar">
          <button type="button" className="btn btn-primary ui-interactive ui-hover-lift" onClick={applyPair}>Apply Pair</button>
        </div>
        <div className="sidebar-pair-presets">
          {DEFAULT_MAJOR_USD_PAIRS.map((pair) => (
            <button
              key={pair}
              type="button"
              className={`sidebar-pair-chip btn btn-ghost ui-interactive ui-hover-lift ${activePair === pair ? "active" : ""}`}
              onClick={() => applyPresetPair(pair)}
            >
              {pair}
            </button>
          ))}
        </div>
      </div>

      <div className="sidebar-status-card">
        <span className={`sidebar-status-pill status-chip ${bootstrap?.macroEnabled ? "status-chip-live" : "status-chip-muted"}`}>{macroLabel}</span>
        <span className="sidebar-status-pill status-chip status-chip-muted">Top Bar: {commandBarMode}</span>
        <span className="sidebar-status-pill status-chip status-chip-muted">Active: {activePage}</span>
      </div>

      <nav className="nav sidebar-nav-block">
        {pages.map((page) => (
          <button
            key={page}
            className={`nav-btn btn btn-ghost ui-interactive ui-hover-lift ${activePage === page ? "active" : ""}`}
            onClick={() => setActivePage(page as AppPage)}
            type="button"
          >
            {page}
          </button>
        ))}
      </nav>
    </aside>
  );
}
