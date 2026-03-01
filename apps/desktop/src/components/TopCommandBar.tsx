import { pages, type AppPage } from "@/store/useAppStore";

type Props = {
  activePage: AppPage;
  onNavigate: (page: AppPage) => void;
  marketSession: Record<string, unknown> | null;
};

function isFxMarketClosed(nowUtc: Date): boolean {
  const weekday = nowUtc.getUTCDay(); // Sunday=0 ... Saturday=6
  const hour = nowUtc.getUTCHours();
  if (weekday === 6) return true; // Saturday
  if (weekday === 0 && hour < 22) return true; // Sunday before reopen
  if (weekday === 5 && hour >= 22) return true; // Friday after close
  return false;
}

export function TopCommandBar({ activePage, onNavigate, marketSession }: Props) {
  const localClockText = String(marketSession?.local_clock_display ?? marketSession?.local_time ?? "n/a");
  const sessionLabel = String(marketSession?.label ?? "n/a");
  const rawMarketStatus = String(marketSession?.market_status ?? "").toLowerCase();
  const fallbackMarketStatus = isFxMarketClosed(new Date()) ? "closed" : "open";
  const marketStatus = rawMarketStatus === "open" || rawMarketStatus === "closed" ? rawMarketStatus : fallbackMarketStatus;
  const marketStatusText = String(marketSession?.status_text ?? (marketStatus === "open" ? "Open" : "Closed"));
  const marketChipClass = marketStatus === "open" ? "status-chip-live" : "status-chip-muted";

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
        <span className="top-rail-chip status-chip status-chip-muted">Local Clock: {localClockText}</span>
        <span className="top-rail-chip status-chip status-chip-muted">Market Session: {sessionLabel}</span>
        <span className={`top-rail-chip status-chip ${marketChipClass}`}>Market: {marketStatusText}</span>
        <span className="top-rail-chip status-chip status-chip-muted">Active: {activePage}</span>
      </div>
    </header>
  );
}


