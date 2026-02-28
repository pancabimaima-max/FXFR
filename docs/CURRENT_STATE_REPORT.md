# CURRENT_STATE_REPORT

## 1) What this app is (today)
FX Fundamentals Refresher is a Windows desktop app (Tauri + React frontend + FastAPI engine sidecar) intended to be a local forex fundamentals terminal with data ingestion, macro/fundamental calculations, dashboards, charts, and logs. As currently implemented in this repo, it boots a desktop shell, authenticates via a session token, loads operational pages (Data Checklist, Dashboard, Fundamental Tools, Charts (BETA), Logs, Developer Tab), ingests MT5 price/calendar files, fetches FRED macro data when key is configured, computes dashboard/fundamental metrics, stores state/data locally (SQLite + Parquet), and streams job/data updates over WebSocket.

## 2) How to run (exact commands)
- UI dev command(s):
  - `pnpm --filter @fxfr/desktop dev`
  - from app folder: `cd apps\\desktop && pnpm dev`
- UI build command(s):
  - `pnpm --filter @fxfr/desktop build`
  - root alias: `pnpm build:desktop`
- Desktop run command (if different):
  - `pnpm --filter @fxfr/desktop tauri:dev`
  - root full stack helper: `pnpm dev:fullstack`
- Backend dev command(s):
  - `cd services\\engine`
  - `python -m venv .venv`
  - `.\\.venv\\Scripts\\activate`
  - `pip install -r requirements.txt`
  - `uvicorn app.main:app --reload --host 127.0.0.1 --port 8765`
- Required scripts/commands from `package.json`:
  - `pnpm doctor`
  - `pnpm dev:fullstack`
  - `pnpm build:engine-sidecar`
  - `pnpm verify:package`
  - `pnpm soak:startup`
  - `pnpm soak:24h`
  - `pnpm gate:release`
- Expected ports/URLs:
  - HTTP API: `http://127.0.0.1:8765`
  - WebSocket: `ws://127.0.0.1:8765/ws/events?token=<session_token>`
  - Vite dev UI: `http://localhost:5173`

Status note:
- Commands listed from repo scripts/config.
- Runtime behavior of each command in this report is **NOT VERIFIED BY RUN** unless explicitly stated otherwise.

## 3) Repo structure (tree) + purpose
### Tree (depth 4, important files)
```text
.
+-- .github
¦   +-- workflows
¦       +-- ci.yml
¦       +-- release-desktop.yml
+-- apps
¦   +-- desktop
¦       +-- src
¦       ¦   +-- api
¦       ¦   ¦   +-- client.ts
¦       ¦   +-- components
¦       ¦   ¦   +-- DataTable.tsx
¦       ¦   ¦   +-- SidebarNav.tsx
¦       ¦   ¦   +-- TopCommandBar.tsx
¦       ¦   +-- pages
¦       ¦   ¦   +-- ChartsPage.tsx
¦       ¦   ¦   +-- DashboardPage.tsx
¦       ¦   ¦   +-- DataChecklistPage.tsx
¦       ¦   ¦   +-- FundamentalToolsPage.tsx
¦       ¦   ¦   +-- LogsPage.tsx
¦       ¦   ¦   +-- PlaceholderPage.tsx
¦       ¦   ¦   +-- WizardPage.tsx
¦       ¦   +-- realtime
¦       ¦   ¦   +-- engineEvents.ts
¦       ¦   +-- store
¦       ¦   ¦   +-- useAppStore.ts
¦       ¦   +-- styles
¦       ¦   ¦   +-- app.css
¦       ¦   ¦   +-- themeTokens.ts
¦       ¦   +-- types
¦       ¦   ¦   +-- theme.ts
¦       ¦   +-- App.tsx
¦       ¦   +-- main.tsx
¦       +-- src-tauri
¦       ¦   +-- resources
¦       ¦   ¦   +-- engine
¦       ¦   +-- src
¦       ¦   ¦   +-- main.rs
¦       ¦   +-- Cargo.toml
¦       ¦   +-- tauri.conf.json
¦       +-- package.json
¦       +-- vite.config.ts
+-- artifacts
¦   +-- release-gate
¦   +-- soak
¦   +-- fxfr-desktop-0.1.0-stable-msi.msi
¦   +-- fxfr-desktop-0.1.0-stable-nsis.exe
+-- docs
¦   +-- adr
¦   +-- templates
¦   +-- MASTER_CONTROL.md
¦   +-- v1-backlog.md
¦   +-- v1-decision-ledger.md
+-- packages
¦   +-- contracts
¦   ¦   +-- python
¦   ¦   +-- schemas
¦   ¦   +-- ts
¦   +-- design-tokens
¦       +-- tokens.json
+-- scripts
¦   +-- desktop
¦       +-- dev_fullstack.ps1
¦       +-- doctor.ps1
¦       +-- soak_24h.ps1
¦       +-- verify_package_artifacts.ps1
+-- services
¦   +-- engine
¦       +-- app
¦       ¦   +-- api
¦       ¦   +-- core
¦       ¦   +-- db
¦       ¦   +-- schemas
¦       ¦   +-- services
¦       ¦   +-- workers
¦       ¦   +-- main.py
¦       +-- tests
¦       +-- .env.example
¦       +-- pyproject.toml
¦       +-- requirements.txt
¦       +-- sidecar_main.py
+-- .python-version
+-- package.json
+-- pnpm-workspace.yaml
+-- README.md
```

### Top-level folder purposes
- `/.github`: CI/CD workflows for test/build/release automation.
- `/apps`: Desktop frontend app (React/Vite) plus Tauri wrapper.
- `/artifacts`: Generated soak/release-gate outputs and packaged installers.
- `/docs`: Product/control documentation, ADRs, and release templates.
- `/packages`: Shared contracts (schemas/models/TS types) and design tokens.
- `/scripts`: PowerShell operator scripts for dev/build/soak/release workflows.
- `/services`: Backend engine service (FastAPI/WebSocket, storage, jobs, tests).

## 4) Frontend (Face) — what exists right now
- Main entry file(s):
  - `apps/desktop/src/main.tsx`
  - `apps/desktop/src/App.tsx`
- Screen/page list (implemented via `activePage` state, not URL router):
  - Data Checklist
  - Dashboard
  - Fundamental Tools
  - Charts (BETA)
  - Logs
  - Developer Tab (placeholder)
- Key components:
  - `DataTable.tsx` (tabular display)
  - `SidebarNav.tsx` (left nav + active pair controls)
  - `TopCommandBar.tsx` (top tabs/chips/search shell)
  - `engineEvents.ts` (WebSocket client connection utility)
- Zustand store:
  - `useAppStore` in `apps/desktop/src/store/useAppStore.ts`
  - Holds: initialization/loading flags, `activePage`, `activePair`, `commandBarMode`, bootstrap payload (`sessionToken`, launch/timezone/macro flags), and mutators.
  - Also persists UI pref `commandBarMode` to localStorage key `fxfr_ui_prefs_v1`.
- Frontend ? backend communication:
  - HTTP: native `fetch` wrapper in `apps/desktop/src/api/client.ts`.
  - WebSocket: native `WebSocket` in `apps/desktop/src/realtime/engineEvents.ts`.
  - Tauri invoke bridge (desktop runtime info/bootstrap handoff): calls to `window.__TAURI__.core.invoke` in `App.tsx`.

## 5) Backend (Brain) — what exists right now
- Main entry file:
  - `services/engine/app/main.py` (creates FastAPI app, middleware, websocket, lifespan init)
- Internal modules:
  - `app/api/v1.py`: REST endpoints for bootstrap/config/ingest/fred/checklist/dashboard/charts/logs/jobs/tools.
  - `app/api/helpers.py`: standard envelope response builder.
  - `app/core/config.py`: env-backed settings and resolved paths.
  - `app/core/constants.py`: static constants (thresholds, series IDs, defaults).
  - `app/core/security.py`: session-token auth guard.
  - `app/core/logging_setup.py`: rotating logger + crash dump writer.
  - `app/db/database.py`: SQLite schema/init and data access methods.
  - `app/services/ingest_service.py`: MT5 file parse/normalize/write parquet.
  - `app/services/fred_service.py`: FRED fetch + mapping helpers.
  - `app/services/checklist_service.py`: checklist health/freshness/action queue build.
  - `app/services/metrics_service.py`: ATR/ADR/pip and differential computations.
  - `app/services/autofetch_service.py`: apply+sync from folder patterns + schedule snapshot.
  - `app/services/event_bus.py`: websocket connection manager and broadcast.
  - `app/services/state_service.py`: runtime state persistence in DB settings.
  - `app/workers/job_manager.py`: threadpool job queue/progress/cancel/state.
- API endpoints (all under `/v1`, responses wrapped as `{meta,data,error}`):
  - `GET /health`: engine status/version/macro_enabled/worker_pool_size.
  - `GET /bootstrap`: session token + first launch + timezone/macro/runtime summary.
  - `POST /wizard/setup`: save mt5 folder/top pairs/FRED key.
  - `GET /config/runtime`: runtime config including timezones, release channel, key configured.
  - `POST /config/runtime/apply`: apply mt5 folder/fred key/release channel.
  - `POST /timezone/apply`: set display/server timezone.
  - `POST /ingest/price`: ingest price CSV (sync or async job).
  - `POST /ingest/calendar`: ingest calendar CSV/HTML (sync or async job).
  - `POST /autofetch/apply-sync`: save autofetch settings and optionally sync files.
  - `POST /fred/refresh`: async macro refresh job (or disabled response if no key).
  - `GET /fred/snapshot`: policy/inflation snapshot rows.
  - `GET /fundamental/differential`: pair-aware rate/inflation differential payload.
  - `GET /checklist/overview`: weighted health + timeline + actions + market session + autofetch status.
  - `GET /preview/price`: preview rows from `price_latest.parquet`.
  - `GET /preview/calendar`: preview rows from `calendar_latest.parquet`.
  - `GET /dashboard/cards`: computed cards for symbol set.
  - `GET /charts/series`: OHLC series for symbol.
  - `GET /logs`: session/file/both logs filtered by level/lookback/limit.
  - `POST /tools/promote-metric`: insert promotion record.
  - `GET /swap-config`: list swap drag rows (with defaults when filtered symbols requested).
  - `POST /swap-config`: upsert swap drag bps per symbol.
  - `GET /jobs/{job_id}`: job record state.
  - `GET /jobs`: recent jobs list.
  - `POST /jobs/{job_id}/cancel`: request/mark job cancellation.
- WebSocket routes + message types:
  - Route: `/ws/events?token=<session_token>`.
  - Message envelope (implemented):
    - `schema_version`, `timestamp_utc`, `trace_id`, `event_name`, `payload`.
  - Event names emitted in code:
    - `job.started`, `job.progress`, `job.completed`, `job.failed`, `job.cancelled`, `data.updated`.
  - Payload structure normalized by `_event_payload`:
    - `{ topic, kind, event_version: "1", data: { ... } }`.
  - Example payload frame (as implemented shape):
```json
{
  "schema_version": "1.0.0",
  "timestamp_utc": "2026-02-27T12:00:00+00:00",
  "trace_id": "abc123",
  "event_name": "job.progress",
  "payload": {
    "topic": "jobs",
    "kind": "job.update",
    "event_version": "1",
    "data": {
      "job_id": "...",
      "name": "ingest.price",
      "status": "running",
      "progress": 0.7,
      "message": "Parsed candle data"
    }
  }
}
```
- Background jobs/schedulers:
  - `JobManager` threadpool (`max_workers` from config; default 2) handles async ingest/FRED jobs.
  - Daily backup check runs in app lifespan startup (`backup_service.should_run_backup/run_backup`).
  - No separate cron daemon found in repo; autofetch schedule state is computed and acted on by API calls.

## 6) Storage & data
- SQLite:
  - Path: `<DATA_ROOT>/db/engine.db` (resolved in `app/core/config.py`).
  - Created/initialized in `Database.initialize()` (`app/db/database.py`).
  - Tables present: `app_settings`, `ingestion_runs`, `macro_snapshot`, `swap_config`, `metric_promotions`, `logs`, `migration_journal`.
  - Stored content:
    - runtime settings, mt5 folder, release channel, FRED key, timezone state,
    - ingestion metadata,
    - macro snapshots,
    - swap drag config,
    - promotion history,
    - structured log rows,
    - migration journal entries.
- Parquet cache:
  - Folder: `<DATA_ROOT>/parquet`.
  - Files written by ingest code:
    - `price_latest.parquet`
    - `calendar_latest.parquet`
  - Writes happen in `ingest_price_csv` and `ingest_calendar_file`.
  - Reads happen in preview, dashboard, and charts endpoints.
- Other storage:
  - Log files: `<DATA_ROOT>/logs/engine.log` with rotation (`log_max_bytes`, `log_backup_count`).
  - Crash dumps: `<DATA_ROOT>/crash/crash-<timestamp>.json`.
  - Backups: `<DATA_ROOT>/backups/snapshot-<timestamp>` (created by backup service).
  - Frontend local UI prefs: browser/tauri localStorage key `fxfr_ui_prefs_v1`.

## 7) Configuration & environment
- Env vars referenced in engine settings (`app/core/config.py`):
  - `ENVIRONMENT` (default `dev`)
  - `HOST` (default `127.0.0.1`)
  - `PORT` (default `8765`)
  - `DATA_ROOT` (default resolved `%APPDATA%\\FxFundamentalRefresher`)
  - `UI_TIMEZONE_DEFAULT` (default `Asia/Jakarta`)
  - `SERVER_TIMEZONE_DEFAULT` (default `Asia/Gaza`)
  - `WORKER_POOL_SIZE` (default `2`)
  - `FRED_API_KEY` (default empty; macro disabled when empty)
  - `ALLOW_TEST_CLIENT_HOST` (default false)
  - `ALLOWED_ORIGINS` (comma list; default includes localhost + tauri)
  - `RELEASES_BASE_URL` (default GitHub releases URL)
- Additional env usage:
  - `APPDATA` used in `resolve_data_root()` fallback path logic.
  - `VITE_ENGINE_URL` used in frontend API/WS base URL.
  - `PYTHONUNBUFFERED` set by Tauri sidecar launcher process.
- Config files:
  - `services/engine/.env.example`: documented engine env keys.
  - `services/engine/pyproject.toml`: Python project metadata + pinned Python requirement.
  - `services/engine/requirements.txt`: backend dependency pins.
  - `apps/desktop/vite.config.ts`: Vite settings (port 5173 strict).
  - `apps/desktop/src-tauri/tauri.conf.json`: Tauri app window/build/bundle config.
  - `packages/design-tokens/tokens.json`: UI token definitions.

## 8) What is real vs placeholder right now
- Placeholder/stub/hardcoded UI surfaces:
  - Developer Tab is placeholder-only (`PlaceholderPage`, “Static visual prototype lab only”).
  - Charts `Math Lab` and `Signals` tabs are placeholder text panels.
  - Top command bar search is visual-only (`readOnly`, “Search (coming soon)`).
- Real integrations implemented:
  - MT5 file ingestion (CSV/HTML calendar handling) in `ingest_service.py` via `/ingest/price`, `/ingest/calendar`.
  - FRED integration in `fred_service.py` via `/fred/refresh` and macro snapshot endpoints.
  - Real local persistence in SQLite + Parquet + file logs/crash dumps.
  - Real websocket event stream over `/ws/events`.

## 9) Current runtime behavior (facts only)
- App startup behavior (from code):
  - Frontend `App.tsx` attempts Tauri invoke handoff first; if unavailable, it calls `GET /v1/bootstrap` with retry loop.
  - On success, app stores bootstrap state and renders selected page.
  - On failure, it shows a bootstrap error panel with retry button.
  - Backend startup (`main.py`) initializes DB, logging, settings defaults, session token, event bus, job manager, backup check, and middleware.
  - This startup flow is derived from code; **NOT VERIFIED BY RUN** in this report.
- “Refresh” behavior (implemented controls):
  - Logs page: `Refresh Logs` triggers `GET /v1/logs` + runtime config lookup for timezone display.
  - Data Checklist: `Refresh FRED Data` queues async job (`POST /v1/fred/refresh`), and upload/apply actions call corresponding ingest/config endpoints.
  - Dashboard: `Apply` refetches `/v1/dashboard/cards` with filters.
  - Charts: `Run`/`Run Compare` fetch chart series via `/v1/charts/series`.
  - These are code-verified handlers; page-by-page behavior is **NOT VERIFIED BY RUN** in this report.
- Error handling (based on code):
  - Frontend request wrapper converts network failures to “Cannot reach engine…” and non-OK HTTP to explicit status errors.
  - App bootstrap classifies common failures (cannot reach engine / 401 / 403 / generic HTTP).
  - Backend has guarded exceptions in ingest/FRED job flows with log writes and job failure events.
  - Global unhandled Python exceptions are captured into crash dump JSON via `sys.excepthook`.
  - Unknown/Unhandled list from runtime observation is **UNKNOWN** without live fault injection run logs.

---

Exact file path created: `C:\dev\fxfr_desktop\docs\CURRENT_STATE_REPORT.md`

- The app is a Tauri + React desktop shell backed by FastAPI/WebSocket engine with local SQLite/Parquet persistence.
- Core pages and APIs exist for checklist, dashboard, tools, charts, logs, jobs, and runtime config.
- WebSocket event streaming is implemented at `/ws/events` with normalized payload sub-structure.
- Real integrations present: MT5 file ingestion and FRED macro fetch; placeholders remain in Developer Tab and parts of Charts.
- Storage paths are centralized under `<DATA_ROOT>` (`db`, `parquet`, `logs`, `crash`, `backups`) with defaults resolved from `%APPDATA%`.
