# V1 Implementation Backlog (Execution Tracker)

## Completed in this tranche

- Monorepo scaffold (`apps/desktop`, `services/engine`, `packages/contracts`, `packages/design-tokens`).
- Engine foundation:
  - Localhost-only FastAPI service with token-auth boundary.
  - `/v1/*` core endpoints and `/ws/events`.
  - SQLite persistence, ingestion metadata, macro snapshots, swap config, promotions, logs.
  - Price/calendar ingest with UTC normalization and H1 gap detection.
  - Macro degraded mode when FRED key is missing.
  - Dashboard card metric baseline (5 core metrics fields).
  - Daily backup snapshots with keep-last-14 retention.
  - Rotating logs + crash dump writing.
- Desktop foundation:
  - React + Zustand shell with sidebar and page surfaces.
  - First-launch 3-step wizard (MT5 folder, optional FRED key, top pairs).
  - Data Checklist and Dashboard wired to engine endpoints.
- CI baseline for Python + desktop type/lint lanes.
- Shared contracts and JSON schemas bootstrapped.

## Next tranche

1. [done] Convert manual/refresh actions to cancellable background jobs with visible progress and cancel controls in UI.
2. [done] Implement swap-drag editor UI and wire it to `/v1/swap-config`.
3. [done] Add endpoint contract snapshot tests for core metric formulas and dashboard cards.
4. [done] Finish packaged release lane:
   - sidecar binary placement in Tauri bundle
   - stable/beta channel update flow wiring
   - EXE primary + MSI optional smoke packaging
5. [done] Add operational soak scripts (10-cycle startup + 24h soak helpers) and release gate checklist.

## Completed in this restoration tranche

- Decision lock artifacts added:
  - `docs/v1-decision-ledger.md`
  - `docs/legacy-parity-matrix.md`
  - `services/engine/app/core/v1_decisions.py`
- API surface expanded for parity restoration:
  - `POST /v1/autofetch/apply-sync`
  - `GET /v1/fred/snapshot`
  - `GET /v1/fundamental/differential`
  - `GET /v1/preview/price`
  - `GET /v1/preview/calendar`
  - `GET /v1/logs` now supports `source=session|file|both`
  - `GET /v1/dashboard/cards` now supports sort/search/watchlist/query options
- Data Checklist now implements four operational tabs in desktop UI:
  - Overview
  - H1 Candle Data
  - Economic Calendar Data
  - FRED Data
- Fundamental Tools page is now functional (calculator/source/sanity tabs).
- Logs page is now functional (filters + source toggle + raw view).
- Charts (BETA) now has active workspace tabs and live series loading via API.
- Engine tests extended and passing for new functionality.
- Sidecar orchestration is now implemented (engine auto-start/reuse + native bootstrap handoff in Tauri).




