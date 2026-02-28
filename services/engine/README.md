# FXFR Engine Service

FastAPI + WebSocket compute engine for the desktop app.

## Runtime Baseline

- Python `3.12.10` (pinned)
- Runs from `C:\dev\fxfr_desktop` only

## Local Run

```powershell
cd services\engine
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --host 127.0.0.1 --port 8765
```

## Notes

- API is localhost-only and guarded by a random session token.
- FRED key is optional; macro modules are disabled when absent.
- Data is stored under `%APPDATA%\\FxFundamentalRefresher`.
