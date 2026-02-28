"""Decision-locked constants for V1 parity and acceptance checks."""

from __future__ import annotations

PYTHON_BASELINE = "3.12.10"

CHECKLIST_SCORE_WEIGHTS = {
    "price": 40,
    "calendar": 25,
    "macro": 25,
    "timezone": 10,
}

FRESHNESS_HOURS = {
    "price": {"ready": 2.0, "warn": 6.0},
    "calendar": {"ready": 24.0, "warn": 72.0},
    "macro": {"ready": 24.0 * 7.0, "warn": 24.0 * 30.0},
}

AUTO_FETCH = {
    "delay_minutes": 5,
    "gap_warn_count": 2,
    "default_interval_hours": 1,
    "default_price_pattern": "*h1*.csv",
    "default_calendar_pattern": "economic_calendar.csv",
}

WORKER_POOL_SIZE = 2

FX_PIP_POLICY = {
    "jpy_quote": 0.01,
    "non_jpy_quote": 0.0001,
}

CHART_POLICY = {
    "default_bars": 1000,
    "default_visible_panes": 8,
    "warn_panes_over": 8,
    "hard_cap_panes": 16,
}

METRIC_FORMULAS = {
    "rate_differential": "base_policy_rate - quote_policy_rate",
    "inflation_differential": "base_cpi - quote_cpi",
    "carry_estimator": "annualized_rate_diff - annualized_swap_drag",
    "daily_atr_pct_average": "(ATR14_H1 * 24 / ADR20) * 100",
    "strength_meter": "0.7 * z(policy_rate) + 0.3 * z(-cpi_yoy)",
}