# ADR 0001: Desktop Architecture Baseline

- Status: Accepted
- Date: 2026-02-26

## Context

The prior server-rendered prototype was feature-rich but tightly coupled to runtime internals and does not fit long-term desktop goals.

## Decision

Adopt a clean-break architecture:

- Desktop shell: Tauri v2 + React + TypeScript.
- Compute engine: FastAPI + WebSocket sidecar in Python 3.12.10.
- Shared API contracts in a dedicated package.
- Localhost-only token-auth API boundary between UI and engine.

## Consequences

- Faster long-term feature iteration and better UI control.
- Additional operational complexity from multi-runtime packaging.
- Requires strict contract versioning discipline.

