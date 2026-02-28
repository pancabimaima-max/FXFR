import { useMemo } from "react";

import {
  pages,
  type AppPage,
  useAppStore,
} from "@/store/useAppStore";

export function SidebarNav() {
  const activePage = useAppStore((s) => s.activePage);
  const setActivePage = useAppStore((s) => s.setActivePage);
  const commandBarMode = useAppStore((s) => s.commandBarMode);
  const bootstrap = useAppStore((s) => s.bootstrap);

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
