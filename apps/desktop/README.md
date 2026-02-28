# Desktop Shell

Tauri v2 + React desktop UI for FX Fundamentals Refresher.

## Run UI only

```powershell
cd apps\desktop
pnpm install
pnpm dev
```

## Run full desktop shell

```powershell
cd apps\desktop
pnpm install
pnpm tauri:dev
```

Set engine URL if needed:

```powershell
$env:VITE_ENGINE_URL = "http://127.0.0.1:8765"
```
