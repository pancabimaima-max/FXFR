# MASTER CONTROL

Last updated: 2026-02-27
Owner: Fyodor
Active repo: `C:\dev\fxfr_desktop`
Legacy archive: `C:\dev\fx_fundamentals_refresher_legacy_archive` (reference only)

## 1) Mission (Non-negotiable)
1. Fetch Data
2. Calculate Data
3. Serve Result

Anything not directly helping these 3 steps is secondary.

## 2) Runtime Environment Baseline
- OS: Windows only (V1)
- Python: 3.12.10 (pinned)
- Node: 20.x
- pnpm: 9.12.3
- Desktop stack: Tauri v2 + React + TypeScript + Zustand
- Engine stack: FastAPI + WebSocket + SQLite + Parquet cache

Run commands:
```powershell
pnpm doctor
pnpm dev:fullstack
```

## 3) Locked Core Decisions (Condensed)
- Domain: FX only.
- Pair universe: auto-derived from uploaded symbols.
- Canonical storage timezone: UTC.
- Default Local Time: Asia/Jakarta.
- Default Server Time: Asia/Gaza.
- Gap policy: warn at >=2 missing H1 candles, never auto-fill.
- Auto-fetch cadence: closed-candle schedule + 5-minute safety delay.
- Macro key policy: app still runs without FRED key; macro modules show disabled state.
- Core formula direction: Base - Quote for rate and inflation differential.
- Pip policy: JPY quote pairs 0.01, other FX pairs 0.0001.

## 4) Progress Board (Single View)
- Current parity status: 33 done, 0 todo, 0 blocked.
- Completed phases: P0 to P6 (legacy parity restoration and sidecar bootstrap handoff).
- Current health: app boots, sidebar routes work, checklist/dashboard/tools/charts/logs render.

### Tranche status
- Tranche 1 complete: manual uploads + FRED refresh now run as tracked background jobs with progress polling and cancel support.
- Tranche 2 complete: Carry Config swap-drag editor added in Fundamental Tools with row-level Apply; Dashboard Details now show swap drag (bps).
- Tranche 3 complete: Contract snapshot hardening + schema-aligned snapshot tests are green.
- Tranche 4 complete: Packaging lane hardened with sidecar bundle verification, channel-aware release workflow, and artifact naming policy.
- Tranche 5 complete: Soak/release gate automation added (startup cycles, long-run soak helper, release gate report + checklist).
- Tranche 6 complete: AMD Dashboard Cockpit added (hybrid tiles + mini rings, tooltip/readability layer, no logic changes).
- Tranche 7 complete: AMD onboarding + system-state surfaces polished (wizard/bootstrap/empty states), no logic changes.
- Tranche 8 complete: AMD global control language unified (buttons/fields/chips/disclosures), no logic changes.
- Tranche 9 complete: AMD interaction and responsive consistency pass finalized (UI-only, no logic changes).

### Next prioritized tranche
1. Tranche 10: Final consistency pass (full-app dark screenshot spec + 7:1 text contrast verification).

## 5) App Surface and Tab Responsibilities

### Data Checklist (Fetch + quality control)
Purpose: configure inputs, ingest data, verify freshness/health before downstream calculations.

Sub-tabs:
1. Overview
- Runtime Settings: MT5 folder and FRED key apply.
- Timezone Conversion: Local Time / Server Time apply.
- Overall State: aggregate state and score.
- Section Health: per-section readiness details.
- Action Queue: immediate next actions.
- Freshness Timeline: latest timestamps and human-readable ages.

2. H1 Candle Data
- Manual upload: MT5 H1 CSV ingest.
- Auto-fetch: enable/interval/pattern apply.
- Price preview table (default 50 rows).

3. Economic Calendar Data
- Manual upload: CSV/HTM/HTML ingest.
- Auto-fetch: enable/interval/pattern apply.
- Calendar preview table (default 50 rows).

4. FRED Data
- Manual refresh action.
- Policy and Inflation source tables with per-series status/errors.

### Dashboard (Serve result for decisions)
Purpose: view-only decision board for computed edge metrics.

Behavior:
- Controls: symbol search, sort, card limit, watchlist, watchlist-only, inflation mode.
- Pair cards: ATR(14) H1 pips, rate diff, inflation diff, carry estimator, daily ATR % avg, strength meter.
- Readiness badges and reason text.
- Details section with raw ATR units, swap drag (bps), and missing-data reasons.

### Fundamental Tools (Experimental calculate workspace)
Purpose: prototype and validate metrics before promoting to Dashboard.

Sub-tabs:
1. Calculator: rate/inflation differential calculator (base/quote + yoy/mom).
2. Source Tables: policy + inflation raw source tables.
3. Sanity Check: manual promote flow (`metric_key`, `version_tag`).
4. Carry Config: per-symbol swap drag (bps) editor with row-level Apply.

### Charts (BETA)
Purpose: experimental chart workspace and comparison sandbox.

Sub-tabs:
1. Ticker: single symbol series load (default 1000 bars).
2. Compare: dual-symbol load for side-by-side view.
3. Math Lab: placeholder for transformed/derived series.
4. Signals: placeholder for prototype signal surfaces.

### Logs
Purpose: debug and operational visibility.

Behavior:
- Filters: levels, lookback window, limit, source (session/file/both).
- Raw view toggle.
- Timestamps shown in selected Local Time zone.

### Developer Tab
Purpose: UI-only mock/prototype area.
Current state: placeholder only, no production logic.

## 6) User Flow (Operator)
1. Open Data Checklist -> Overview.
2. Apply MT5 folder and optional FRED key.
3. Apply Local/Server timezone.
4. Load Price Candle Data and Economic Calendar Data (manual or auto-fetch apply).
5. Refresh FRED data (if macro enabled).
6. Confirm Overview health/action queue/freshness.
7. Move to Dashboard for decision output.
8. Use Fundamental Tools for experiments; promote only validated metrics.
9. Use Logs when behavior is unexpected.

## 7) Working Protocol with Codex (To prevent sidetracking)
For every request, use this structure:

```text
Tranche: <name>
In scope: <exact items>
Out of scope: <must not touch>
Definition of done: <acceptance checks>
Stop point: <where Codex must stop and wait>
```

Default rule: one tranche at a time, review first, then next tranche.

## 8) Change Rule (Simple)
- This file is the primary control document.
- Any decision tweak must be updated here first.
- If code differs from this file, treat it as a defect and reconcile.












