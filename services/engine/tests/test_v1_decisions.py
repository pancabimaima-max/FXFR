from __future__ import annotations

import unittest
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.core import v1_decisions as d


class V1DecisionConstantTests(unittest.TestCase):
    def test_python_baseline_pin(self):
        self.assertEqual(d.PYTHON_BASELINE, "3.12.10")

    def test_checklist_weights_sum_100(self):
        self.assertEqual(sum(int(v) for v in d.CHECKLIST_SCORE_WEIGHTS.values()), 100)

    def test_freshness_ordering(self):
        for token in ("price", "calendar", "macro"):
            self.assertLessEqual(float(d.FRESHNESS_HOURS[token]["ready"]), float(d.FRESHNESS_HOURS[token]["warn"]))

    def test_chart_policy_bounds(self):
        self.assertLessEqual(int(d.CHART_POLICY["default_visible_panes"]), int(d.CHART_POLICY["hard_cap_panes"]))
        self.assertEqual(int(d.CHART_POLICY["default_bars"]), 1000)


if __name__ == "__main__":
    unittest.main()