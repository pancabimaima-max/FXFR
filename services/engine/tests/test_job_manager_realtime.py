from __future__ import annotations

import threading
import time
import unittest
import sys
from pathlib import Path

ENGINE_ROOT = Path(__file__).resolve().parents[1]
if str(ENGINE_ROOT) not in sys.path:
    sys.path.insert(0, str(ENGINE_ROOT))

from app.workers.job_manager import JobManager


class JobManagerRealtimeTests(unittest.TestCase):
    def test_on_update_callback_receives_running_and_completed(self):
        seen: list[tuple[str, str, float]] = []
        lock = threading.Lock()

        def on_update(record):
            with lock:
                seen.append((record.job_id, record.status, float(record.progress)))

        manager = JobManager(max_workers=1, on_update=on_update)
        try:
            job_id = manager.submit("demo.job", lambda ctx: {"ok": True})

            terminal = None
            for _ in range(120):
                rec = manager.get(job_id)
                if rec and rec.status in {"completed", "failed", "cancelled"}:
                    terminal = rec
                    break
                time.sleep(0.02)

            self.assertIsNotNone(terminal, "Job did not reach terminal state in time.")
            self.assertEqual(terminal.status, "completed")

            with lock:
                statuses = [status for jid, status, _ in seen if jid == job_id]

            self.assertIn("queued", statuses)
            self.assertIn("running", statuses)
            self.assertIn("completed", statuses)
        finally:
            manager.shutdown(wait=True, cancel_futures=True)


if __name__ == "__main__":
    unittest.main()
