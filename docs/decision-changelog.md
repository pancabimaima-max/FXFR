# Decision Changelog (Append-Only)

Use this file to record every approved tweak to V1 decisions.

## Entries
| Change ID | Date (UTC) | Type | Status | Changed By | Approved By | Affected Areas | Summary | Compatibility | Validation |
|---|---|---|---|---|---|---|---|---|---|
| DEC-000 | 2026-02-26 | Baseline | active | Codex | Fyodor | Ledger + parity docs | Initial decision lock established in clean desktop repo. | n/a | parity matrix + tests green |
| DEC-001 | 2026-02-26 | Type A | active | Codex | Fyodor | apps/desktop/src/pages/FundamentalToolsPage.tsx, services/engine/app/api/v1.py, docs/MASTER_CONTROL.md | Swap drag tranche completed and documented; carry config + dashboard traceability live. | additive only | engine tests + desktop typecheck/lint green |
| DEC-002 | 2026-02-27 | Type A | active | Codex | Fyodor | services/engine/tests/test_contract_snapshots.py, packages/contracts/schemas, docs/MASTER_CONTROL.md | Contract snapshot tranche validated and locked. | additive only | snapshot tests + desktop typecheck/lint green |
| DEC-003 | 2026-02-26 | Type A | active | Codex | Fyodor | .github/workflows/ci.yml, .github/workflows/release-desktop.yml, scripts/desktop/build_engine_sidecar.ps1, scripts/desktop/verify_package_artifacts.ps1, docs/MASTER_CONTROL.md | Packaging lane validated and moved to done. | additive only | packaging smoke + local gates green |
| DEC-004 | 2026-02-26 | Type A | active | Codex | Fyodor | scripts/desktop/soak_startup_cycles.ps1, scripts/desktop/soak_24h.ps1, scripts/desktop/release_gate.ps1, docs/release-gate-checklist.md, docs/MASTER_CONTROL.md | Soak + release-gate automation completed with manual enforcement model. | additive only | startup soak + long-run soak helper + release gate report green |

## Notes
1. Never delete or edit historical rows; append new rows only.
2. If a row is superseded, add a new row that references the old `Change ID` in the summary.
3. Keep `Affected Areas` concrete (for example: `v1_decisions.py`, `/v1/dashboard/cards`, `contracts schema`).








