from __future__ import annotations

import threading
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class JobCancelledError(RuntimeError):
    pass


@dataclass
class JobRecord:
    job_id: str
    name: str
    status: str
    created_at_utc: str
    updated_at_utc: str
    progress: float = 0.0
    message: str = ""
    result: dict[str, Any] = field(default_factory=dict)
    error: str = ""
    cancel_requested: bool = False


@dataclass
class JobContext:
    _manager: "JobManager"
    job_id: str

    def set_progress(self, progress: float, message: str | None = None) -> None:
        pct = max(0.0, min(1.0, float(progress)))
        self._manager._update(self.job_id, progress=pct, message=message)

    def is_cancelled(self) -> bool:
        return self._manager._is_cancel_requested(self.job_id)

    def raise_if_cancelled(self) -> None:
        if self.is_cancelled():
            raise JobCancelledError("Job cancelled by user.")


class JobManager:
    def __init__(self, max_workers: int, on_update: Callable[[JobRecord], None] | None = None):
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="fxfr-worker")
        self._jobs: dict[str, JobRecord] = {}
        self._futures: dict[str, Future] = {}
        self._cancel_requested: set[str] = set()
        self._lock = threading.Lock()
        self._on_update = on_update

    def submit(self, name: str, fn: Callable[[JobContext], dict[str, Any]]) -> str:
        job_id = uuid4().hex
        now = _utc_now_iso()
        record = JobRecord(job_id=job_id, name=name, status="queued", created_at_utc=now, updated_at_utc=now)
        with self._lock:
            self._jobs[job_id] = record
        self._notify_update(record)

        def _runner() -> dict[str, Any]:
            ctx = JobContext(_manager=self, job_id=job_id)
            self._update(job_id, status="running", progress=0.05, message="Started")
            try:
                ctx.raise_if_cancelled()
                result = fn(ctx)
                if self._is_cancel_requested(job_id):
                    self._update(job_id, status="cancelled", message="Cancelled", progress=1.0, cancel_requested=True)
                    return {"cancelled": True}
                self._update(job_id, status="completed", progress=1.0, message="Completed", result=result)
                return result
            except JobCancelledError:
                self._update(job_id, status="cancelled", message="Cancelled", progress=1.0, cancel_requested=True)
                return {"cancelled": True}
            except Exception as exc:
                self._update(job_id, status="failed", progress=1.0, message="Failed", error=str(exc))
                raise

        fut = self._pool.submit(_runner)
        with self._lock:
            self._futures[job_id] = fut
        return job_id

    def _notify_update(self, record: JobRecord) -> None:
        if self._on_update is None:
            return
        try:
            self._on_update(JobRecord(**record.__dict__))
        except Exception:
            # Never let callback issues affect job execution.
            return

    def _is_cancel_requested(self, job_id: str) -> bool:
        with self._lock:
            return job_id in self._cancel_requested

    def _update(
        self,
        job_id: str,
        *,
        status: str | None = None,
        progress: float | None = None,
        message: str | None = None,
        result: dict[str, Any] | None = None,
        error: str | None = None,
        cancel_requested: bool | None = None,
    ) -> None:
        snapshot: JobRecord | None = None
        with self._lock:
            rec = self._jobs.get(job_id)
            if rec is None:
                return
            if status is not None:
                rec.status = status
            if progress is not None:
                rec.progress = float(progress)
            if message is not None:
                rec.message = message
            if result is not None:
                rec.result = result
            if error is not None:
                rec.error = error
            if cancel_requested is not None:
                rec.cancel_requested = bool(cancel_requested)
            rec.updated_at_utc = _utc_now_iso()
            snapshot = JobRecord(**rec.__dict__)
        if snapshot is not None:
            self._notify_update(snapshot)

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            fut = self._futures.get(job_id)
            rec = self._jobs.get(job_id)
            if rec is None:
                return False
            self._cancel_requested.add(job_id)
            rec.cancel_requested = True
            rec.updated_at_utc = _utc_now_iso()

        if fut is not None and fut.cancel():
            self._update(job_id, status="cancelled", message="Cancelled", progress=1.0, cancel_requested=True)
            return True

        with self._lock:
            latest = self._jobs.get(job_id)
            if latest is None:
                return False
            if latest.status in {"completed", "failed", "cancelled"}:
                return False

        self._update(job_id, status="cancel_requested", message="Cancellation requested", cancel_requested=True)
        return True

    def get(self, job_id: str) -> JobRecord | None:
        with self._lock:
            rec = self._jobs.get(job_id)
            if rec is None:
                return None
            return JobRecord(**rec.__dict__)

    def list_recent(self, limit: int = 20) -> list[JobRecord]:
        with self._lock:
            rows = list(self._jobs.values())
        rows = sorted(rows, key=lambda x: x.updated_at_utc, reverse=True)
        return [JobRecord(**r.__dict__) for r in rows[:limit]]

    def shutdown(self, wait: bool = False, cancel_futures: bool = True) -> None:
        self._pool.shutdown(wait=wait, cancel_futures=cancel_futures)
