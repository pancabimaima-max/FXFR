# FX Fundamentals Refresher

Primary control document: `docs/MASTER_CONTROL.md`

Use `MASTER_CONTROL.md` as the single source of truth for:
- mission and priorities
- environment baseline
- locked decisions
- progress and next tranche
- tab responsibilities
- operator flow

## Active Repo

- Active: `C:\dev\fxfr_desktop`
- Legacy archive: `C:\dev\fx_fundamentals_refresher_legacy_archive`

## One-Command Dev (Recommended)

```powershell
pnpm doctor
pnpm dev:fullstack
```

## Contract Snapshots

Engine contract snapshots are in `services/engine/tests/fixtures/snapshots` and are validated by tests.

Refresh snapshots intentionally:

```powershell
$env:UPDATE_SNAPSHOTS='1'
cd services\engine
.\.venv\Scripts\python -m unittest tests.test_contract_snapshots -v
```

Then rerun the same tests without `UPDATE_SNAPSHOTS`.

## Packaging Lane Commands

```powershell
pnpm build:engine-sidecar
pnpm --filter @fxfr/desktop tauri:build
pnpm verify:package
```

## Soak and Release Gate

1. Run startup-cycle soak (both packaged + dev by default):

```powershell
pnpm soak:startup
```

2. Run long-run soak helper (defaults to packaged mode):

```powershell
pnpm soak:24h
```

3. Fill attestation template at `docs/templates/release-attestation.template.json` (copy it and set required booleans/approvals).

4. Generate release gate report:

```powershell
pnpm gate:release
```

5. Attach generated artifacts under `artifacts/` to the release decision.
