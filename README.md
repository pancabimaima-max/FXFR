### 1) Toolchain (required)

```
Node.js: 20.x (current on your machine: v20.20.0)
pnpm: 9.12.3
Python: 3.12.10
Rust: stable (current on your machine: rustc 1.93.1, cargo 1.93.1)
```

### 2) Desktop app JS deps (`apps/desktop/package.json`)

```
@fxfr/contracts: workspace:*
react: ^18.3.1
react-dom: ^18.3.1
zustand: ^5.0.0
```

### 3) Desktop app dev deps (exact currently required)

```
@tauri-apps/cli: ^2.0.0
@types/react: ^18.3.3
@types/react-dom: ^18.3.0
@typescript-eslint/eslint-plugin: ^8.12.2
@typescript-eslint/parser: ^8.12.2
@vitejs/plugin-react: ^4.3.1
autoprefixer: 10.4.20
eslint: ^9.14.0
postcss: 8.4.49
tailwindcss: 3.4.17
typescript: ^5.6.3
vite: ^5.4.10
```

### 4) Tauri Rust crate versions (`apps/desktop/src-tauri/Cargo.toml`)

```
tauri: 2.0.2
tauri-build: 2.0.1
serde: 1
serde_json: 1
ureq: 2.10.1
```

### 5) Python engine deps (`services/engine/requirements.txt`)

```
fastapi==0.116.1
uvicorn[standard]==0.35.0
pydantic==2.11.9
pydantic-settings==2.11.0
python-multipart==0.0.20
pandas==2.3.3
pyarrow==19.0.1
numpy==2.3.3
pytz==2025.2
fredapi==0.5.2
httpx==0.28.1
jsonschema==4.23.0
```

---

## Copy-paste: verify/install everything

Run from repo root `C:\\dev\\fxfr_desktop`:

```powershell
# Verify toolchain
node -v
pnpm -v
python --version
rustc --version
cargo --version

# Install JS workspace deps exactly from lockfile
pnpm install --frozen-lockfile

# Setup Python engine venv + deps
python -m venv services\\engine\\.venv
services\\engine\\.venv\\Scripts\\python -m pip install --upgrade pip
services\\engine\\.venv\\Scripts\\python -m pip install -r services\\engine\\requirements.txt

# Validate desktop health
pnpm --filter @fxfr/desktop typecheck
pnpm --filter @fxfr/desktop lint
pnpm --filter @fxfr/desktop build
```
