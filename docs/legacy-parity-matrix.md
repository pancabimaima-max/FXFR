# Legacy to Desktop Parity Matrix

Status legend: `todo`, `in_progress`, `done`, `blocked`

| Feature ID | Legacy Source | Target Module | Status | Acceptance Test |
|---|---|---|---|---|
| P0-001 | app.py decision constants | `services/engine/app/core/v1_decisions.py` | done | constants test passes |
| P0-002 | app.py + user decision set | `docs/v1-decision-ledger.md` | done | file exists + reviewed |
| P0-003 | app.py runtime defaults | `core/constants.py` + checklist UI | done | defaults visible in runtime config |
| P1-001 | Data Checklist overview | `checklist_service.py` + `DataChecklistPage.tsx` | done | overview cards + action queue render |
| P1-002 | Human-readable age labels | `checklist_service.py` | done | age text shows hour/min format |
| P1-003 | Freshness timeline | `checklist_service.py` + checklist UI | done | timeline entries render |
| P1-004 | Timezone apply in checklist | `/v1/timezone/apply` + checklist UI | done | apply updates runtime config |
| P1-005 | Runtime settings apply | `/v1/config/runtime/apply` + checklist UI | done | settings persist and reflect |
| P1-006 | Manual price upload | `/v1/ingest/price` + checklist H1 tab | done | upload success + preview |
| P1-007 | Manual calendar upload | `/v1/ingest/calendar` + checklist calendar tab | done | upload success + preview |
| P1-008 | Auto-fetch apply+sync | `/v1/autofetch/apply-sync` + tabs | done | apply sync updates statuses |
| P1-009 | Auto-fetch next update +5m | `autofetch_service.py` + overview UI | done | next update uses 5m delay |
| P1-010 | Market session + local clock | `checklist_service.py` + overview UI | done | snapshot visible |
| P1-011 | Data naming consistency | Desktop UI labels | done | Price Candle / Economic Calendar labels |
| P2-001 | FRED manual refresh | `/v1/fred/refresh` + checklist macro tab | done | refresh trigger + table updates |
| P2-002 | FRED policy snapshot | `/v1/fred/snapshot?kind=policy` | done | rows/status render |
| P2-003 | FRED inflation snapshot | `/v1/fred/snapshot?kind=inflation` | done | rows/status render |
| P2-004 | Differential calculator | `/v1/fundamental/differential` + tools UI | done | Base-Quote values match |
| P2-005 | Fundamental tools tabs | `FundamentalToolsPage.tsx` | done | Calculator/Source/Sanity tabs |
| P2-006 | Promote metric flow | `/v1/tools/promote-metric` + tools UI | done | promote action writes row |
| P3-001 | Dashboard controls | `DashboardPage.tsx` | done | search/sort/watchlist/card limit |
| P3-002 | Dashboard card metrics | `/v1/dashboard/cards` + UI | done | ATR/rate/infl/carry/strength visible |
| P3-003 | ATR pip standardization | `metrics_service.py` + dashboard details | done | JPY vs non-JPY pip rule visible |
| P3-004 | Card limit safety clamp | dashboard UI | done | no value-above-max class crash |
| P4-001 | Logs structured view | `LogsPage.tsx` | done | level/time filter works |
| P4-002 | Logs source toggle | `/v1/logs?source=` + UI | done | session/file/both toggles |
| P4-003 | Local timezone timestamps | logs UI formatter | done | log times shown in local tz |
| P5-001 | Charts beta shell | `ChartsPage.tsx` | done | tabs render |
| P5-002 | Ticker data view | `/v1/charts/series` + charts UI | done | H1 data visible |
| P5-003 | Pane policy display | charts UI constraints note | done | 8 default/16 cap warning |
| P6-001 | Sidecar startup | `src-tauri/src/main.rs` | done | packaged app boots engine |
| P6-002 | Secure token handoff | tauri+frontend bootstrap | done | bootstrap token received |
| P6-003 | Script fallback preserved | `dev_fullstack.ps1` | done | command still operational |

## Progress Rollup
- done: 33
- in_progress: 0
- todo: 0
- blocked: 0
