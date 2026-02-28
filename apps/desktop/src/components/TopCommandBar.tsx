import { pages, type AppPage } from "@/store/useAppStore";

type Props = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
};

export function TopCommandBar({ activePage, onNavigate }: Props) {
  return (
    <header className="top-command-bar top-primary-panel" role="navigation" aria-label="Top command bar">
      <nav className="top-nav-tabs" aria-label="Primary sections">
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            className={`top-nav-tab top-primary-tab ui-interactive ui-hover-lift ${activePage === page ? "active" : ""}`}
            onClick={() => onNavigate(page)}
          >
            {page}
          </button>
        ))}
      </nav>
      <div className="top-rail-meta">
        <span className="top-rail-chip status-chip status-chip-muted">Active: {activePage}</span>
      </div>
    </header>
  );
}


