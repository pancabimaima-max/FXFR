# Decision Change Control

This process is mandatory for every decision tweak so changes remain consistent and traceable.

## Source of Truth
- Product baseline: [v1-decision-ledger.md](C:/dev/fxfr_desktop/docs/v1-decision-ledger.md)
- Change history (append-only): [decision-changelog.md](C:/dev/fxfr_desktop/docs/decision-changelog.md)
- Runtime constants: `services/engine/app/core/v1_decisions.py`
- Architecture deltas: `docs/adr/*`
- Delivery impact: [v1-backlog.md](C:/dev/fxfr_desktop/docs/v1-backlog.md)

## Change Types
### Type A: Value tweak (low risk)
Examples: threshold, default value, display precision.
Required updates:
1. Decision changelog entry.
2. Ledger line update.
3. Matching constant update in `v1_decisions.py`.
4. Test update/addition if behavior changes.

### Type B: Contract tweak (medium risk)
Examples: endpoint payload field, schema field, validation rule.
Required updates:
1. Everything in Type A.
2. Update JSON schema + TS/Python contract models.
3. Update API docs/comments and affected UI/engine tests.
4. Note compatibility impact in changelog.

### Type C: Architecture/scope change (high risk)
Examples: stack, runtime boundary, storage model, release policy.
Required updates:
1. Everything in Type B as applicable.
2. New ADR (or superseding ADR) with rationale/tradeoffs.
3. Backlog/phase plan updates.
4. Explicit rollback note.

## Required Workflow (Every Change)
1. Create a change proposal from [decision-change-template.md](C:/dev/fxfr_desktop/docs/templates/decision-change-template.md).
2. Approve the proposal (owner decision).
3. Apply code/docs updates.
4. Add append-only row in changelog.
5. Run relevant tests and record pass/fail in changelog.
6. Close the item only when ledger, code, tests, and changelog are all aligned.

## Definition of Done
A decision tweak is complete only if:
1. Ledger reflects new truth.
2. Changelog records who/when/why/impact.
3. Runtime constants and contracts match docs.
4. Tests prove behavior.
5. Backlog reflects any scope/timeline effect.

## Rule
If docs and code disagree, treat it as a defect and reconcile immediately.
