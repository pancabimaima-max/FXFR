# Release Gate Checklist (Manual Enforcement)

Use this checklist before publishing a release.

## Automated gates
1. `pnpm doctor`
2. Engine tests:
   - `cd services\\engine`
   - `.\\.venv\\Scripts\\python -m unittest discover -s tests -p "test_*.py" -v`
3. Desktop checks:
   - `pnpm --filter @fxfr/desktop typecheck`
   - `pnpm --filter @fxfr/desktop lint`
4. Contract snapshots:
   - `cd services\\engine`
   - `.\\.venv\\Scripts\\python -m unittest tests.test_contract_snapshots -v`
5. Packaging verify:
   - `pnpm build:engine-sidecar`
   - `pnpm --filter @fxfr/desktop tauri:build`
   - `pnpm verify:package`
6. Startup soak (both targets, 10/10):
   - `pnpm soak:startup`
7. Long-run soak summary (24h target):
   - `pnpm soak:24h`
8. Release gate report:
   - `pnpm gate:release`

## Manual gates
1. Sev1/Sev2 = zero for last 7 days.
2. 7-day paper-trading dry run complete.
3. Owner review of release gate report artifacts.

## Sign-off
| Field | Value |
|---|---|
| Version | |
| Channel (`stable`/`beta`) | |
| Startup soak path | |
| Long-run soak path | |
| Release gate report path | |
| Approved by | |
| Approved at (UTC) | |
| Notes | |
