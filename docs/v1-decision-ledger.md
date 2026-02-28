# V1 Decision Ledger (Immutable Baseline)

Last updated: 2026-02-26
Owner: Fyodor
Scope: FX Fundamentals Refresher Desktop V1

## Canonical Runtime and Repo
- Active repo root: `C:\dev\fxfr_desktop`
- Legacy repo: `C:\dev\fx_fundamentals_refresher_legacy_archive` (read-only parity reference)
- Python baseline: `3.12.10`
- Stack lock: Tauri v2 + React/TypeScript + Zustand + FastAPI/WebSocket sidecar

## Product and Scope Locks
- V1: Windows desktop only, personal/small private usage.
- Domain: FX only.
- Goal: Decision quality + workflow speed.
- Migration strategy: Big-bang cutover from Streamlit; no parallel feature growth on legacy.
- Mobile companion: deferred after desktop stabilizes.

## Architecture and Data Boundaries
- UI never runs heavy compute.
- Backend computes metrics and exposes contract-first `/v1/*` APIs.
- Storage canonical timezone: UTC.
- Default display timezone: Asia/Jakarta.
- Default server/source timezone: Asia/Gaza.
- Pair universe source: auto-derived from uploaded symbols.

## Ingestion and Freshness Policies
- Sources: MT5 H1 candles CSV + MT5 economic calendar export + FRED macro.
- Gap warning threshold: >= 2 missing H1 candles.
- Gap handling: warn-only, no auto-fill.
- Closed candle cadence: refresh/schedule with +5 minute safety delay.
- Freshness thresholds:
  - Price: ready <=2h, warn <=6h, else error.
  - Calendar: ready <=24h, warn <=72h, else error.
  - Macro: ready <=7d, warn <=30d, else error.
- Checklist weights:
  - Price 40, Calendar 25, Macro 25, Timezone 10.

## Core Metric Locks
- Rate differential: Base - Quote.
- Inflation differential: Base - Quote (YoY default; MoM toggle supported).
- Carry estimator: annualized rate diff - annualized swap drag.
- Daily ATR % average: `(ATR14_H1 * 24 / ADR20) * 100`.
- Strength meter: `0.7 * z(policy_rate) + 0.3 * z(-cpi_yoy)`.
- Display precision: 2 decimals for differentials.

## ATR/Pip Standardization
- FX pip policy: JPY quote pairs pip = 0.01; others pip = 0.0001.
- Non-FX policy: keep raw units + normalized view where applicable.

## Security and Operational
- Local API: localhost-only + random session token.
- Secret handling: Windows credential manager abstraction path (FRED secret in V1).
- Macro missing-key policy: app remains usable; macro modules disabled with explicit warning.

## Packaging and Release
- EXE primary, MSI optional artifact.
- Stable + Beta channels.
- Auto-update preferred with manual fallback.
- Unsigned internal builds acceptable for V1.

## Reliability and Quality Gates
- Coverage target: >=75%.
- PR gates: lint + type + tests mandatory.
- Dashboard load target: <3s.
- Soak: 24h before release cut.
- Release gate: Sev1/Sev2 zero for 7 days + 7-day paper-trading dry run.

## Governance
- Mandatory ADR for high-impact architecture decisions.
- Feature freeze after Week 12, then bugfix/polish only.

## Notes
- This ledger is immutable by default.
- Any change requires explicit superseding entry with date, rationale, and impact scope.
- Use [Decision Change Control](C:/dev/fxfr_desktop/docs/decision-change-control.md) for the required process.
- Record each approved change in [Decision Changelog](C:/dev/fxfr_desktop/docs/decision-changelog.md).
