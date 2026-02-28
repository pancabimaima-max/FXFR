import { pages, type AppPage, type CommandBarMode } from "@/store/useAppStore";

type Props = {
  mode: CommandBarMode;
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  activePair: string;
  macroEnabled: boolean;
};

export function TopCommandBar({ mode, activePage, onNavigate, activePair, macroEnabled }: Props) {
  if (mode === "hidden") {
    return null;
  }

  const macroLabel = macroEnabled ? "Macro Live" : "Macro Disabled";

  if (mode === "slim") {
    return (
      <header className="top-command-bar slim" role="navigation" aria-label="Top command bar">
        <div className="top-command-left">
          <strong className="top-active-page">{activePage}</strong>
        </div>
        <div className="top-rail-meta">
          <span className="top-rail-chip status-chip status-chip-muted">Pair {activePair}</span>
          <span className={`top-rail-chip status-chip ${macroEnabled ? "status-chip-live" : "status-chip-muted"}`}>{macroLabel}</span>
        </div>
      </header>
    );
  }

  return (
    <header className="top-command-bar full" role="navigation" aria-label="Top command bar">
      <nav className="top-nav-tabs" aria-label="Primary sections">
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            className={`top-nav-tab btn btn-ghost ui-interactive ui-hover-lift ${activePage === page ? "active" : ""}`}
            onClick={() => onNavigate(page)}
          >
            {page}
          </button>
        ))}
      </nav>
      <div className="top-rail-meta">
        <label className="top-rail-search" aria-label="Search (coming soon)">
          <span>Search</span>
          <input className="top-rail-search-input" value="" placeholder="Search" readOnly tabIndex={-1} aria-hidden="true" />
        </label>
        <span className="top-rail-chip status-chip status-chip-muted">Pair {activePair}</span>
        <span className={`top-rail-chip status-chip ${macroEnabled ? "status-chip-live" : "status-chip-muted"}`}>{macroLabel}</span>
      </div>
    </header>
  );
}


