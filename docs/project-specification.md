# Project Specification: FX Fundamentals Refresher (FXFR)

This document outlines the technical requirements, stack, and dependencies for the FX Fundamentals Refresher project.

## 1. System Requirements

- **Operating System:** Windows (V1 Target)
- **Node.js:** 20.x
- **pnpm:** 9.12.3
- **Python:** 3.12.10 (pinned)
- **Rust:** Latest stable (implied by Tauri 2)

## 2. Tech Stack Overview

### Frontend (Desktop UI)

- **Framework:** [React 18.3.1](https://react.dev/)
- **Language:** [TypeScript 5.6.3](https://www.typescriptlang.org/)
- **Build Tool:** [Vite 5.4.10](https://vitejs.dev/)
- **Styling:** [TailwindCSS 3.4.17](https://tailwindcss.com/) with [PostCSS 8.4.49](https://postcss.org/)
- **State Management:** [Zustand 5.0.0](https://github.com/pmndrs/zustand)

### Desktop Runtime

- **Shell:** [Tauri 2.0.2](https://tauri.app/)
- **Backend Bridge:** Rust-based Tauri Core

### Compute Engine (Sidecar)

- **Framework:** [FastAPI 0.116.1](https://fastapi.tiangolo.com/)
- **Server:** [Uvicorn 0.35.0](https://www.uvicorn.org/)
- **Communication:** REST API + WebSockets

## 3. Dependencies

### Node.js (Apps & Packages)


| Dependency        | Version   | Description                  |
| ----------------- | --------- | ---------------------------- |
| `react`           | `^18.3.1` | UI Library                   |
| `zustand`         | `^5.0.0`  | State Management             |
| `flag-icons`      | `^7.5.0`  | Currency/Country flags       |
| `@tauri-apps/api` | `^2.0.0`  | Tauri Frontend API           |
| `typescript`      | `^5.6.3`  | Static Typing                |
| `tailwindcss`     | `3.4.17`  | Utility-first CSS            |
| `vite`            | `^5.4.10` | Development Server & Bundler |


### Python (Engine)


| Dependency   | Version   | Description            |
| ------------ | --------- | ---------------------- |
| `fastapi`    | `0.116.1` | Web Framework          |
| `pydantic`   | `2.11.9`  | Data Validation        |
| `pandas`     | `2.3.3`   | Data Manipulation      |
| `numpy`      | `2.3.3`   | Numerical Computing    |
| `pyarrow`    | `19.0.1`  | Parquet Support        |
| `fredapi`    | `0.5.2`   | FRED Economic Data API |
| `httpx`      | `0.28.1`  | Async HTTP Client      |
| `jsonschema` | `4.23.0`  | Schema Validation      |


### Rust (Tauri Core)


| Dependency | Version  | Description                   |
| ---------- | -------- | ----------------------------- |
| `tauri`    | `2.0.2`  | Desktop Framework             |
| `serde`    | `1.0`    | Serialization/Deserialization |
| `ureq`     | `2.10.1` | Simple HTTP Client            |


## 4. Development Commands

- **Doctor/Diagnostics:** `pnpm doctor`
- **Fullstack Dev:** `pnpm dev:fullstack`
- **Desktop Only:** `pnpm dev:desktop`
- **Engine Build:** `pnpm build:engine-sidecar`

## 5. Key Directories

- `apps/desktop`: React + Tauri frontend application.
- `services/engine`: Python FastAPI sidecar for heavy data processing.
- `packages/contracts`: Shared schemas and types between TS and Python.
- `scripts/desktop`: PowerShell automation scripts for build and dev.

