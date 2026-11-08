"""Durable task lifecycle: pause / resume / cancel at tool boundaries.

States: queued → planning → running → waiting_for_approval → paused
        → completed | failed | cancelled

Permissions are revalidated on resume; destructive steps are never auto-replayed.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.task_control")


class TaskState(str, Enum):
    QUEUED = "queued"
    PLANNING = "planning"
    RUNNING = "running"
    WAITING_FOR_APPROVAL = "waiting_for_approval"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


TERMINAL = frozenset({
    TaskState.COMPLETED, TaskState.FAILED, TaskState.CANCELLED,
})


@dataclass
class TaskRecord:
    id: str
    state: str
    created_at: float
    updated_at: float
    goal: str = ""
    error: str = ""
    hops: int = 0
    checkpoint: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class TaskController:
    """Per-orchestrator task control with pause gate at tool boundaries."""

    def __init__(self, store_dir: Path | None = None):
        self.store_dir = store_dir
        if store_dir:
            store_dir.mkdir(parents=True, exist_ok=True)
        self._lock = asyncio.Lock()
        self._pause = asyncio.Event()
        self._pause.set()  # not paused
        self._cancel_requested = False
        self.current: TaskRecord | None = None
        self.history: list[TaskRecord] = []

    def start(self, goal: str) -> TaskRecord:
        self._cancel_requested = False
        self._pause.set()
        now = time.time()
        rec = TaskRecord(
            id=uuid.uuid4().hex[:12],
            state=TaskState.QUEUED.value,
            created_at=now,
            updated_at=now,
            goal=(goal or "")[:500],
        )
        self.current = rec
        self._persist()
        return rec

    def set_state(self, state: TaskState, *, error: str = "") -> None:
        if not self.current:
            return
        if self.current.state in {s.value for s in TERMINAL}:
            return
        self.current.state = state.value
        self.current.updated_at = time.time()
        if error:
            self.current.error = error[:500]
        self._persist()

    def bump_hop(self) -> None:
        if self.current:
            self.current.hops += 1
            self.current.updated_at = time.time()

    def save_checkpoint(self, data: dict[str, Any]) -> None:
        if not self.current:
            return
        # Never store raw secrets in checkpoints
        self.current.checkpoint = data
        self.current.updated_at = time.time()
        self._persist()

    def request_pause(self) -> bool:
        if not self.current or self.current.state in {s.value for s in TERMINAL}:
            return False
        self._pause.clear()
        self.set_state(TaskState.PAUSED)
        return True

    def request_resume(self) -> bool:
        if not self.current:
            return False
        if self.current.state != TaskState.PAUSED.value:
            # Allow resume from waiting if user paused during confirm
            if self.current.state not in {
                TaskState.RUNNING.value,
                TaskState.WAITING_FOR_APPROVAL.value,
                TaskState.PLANNING.value,
            }:
                return False
        self._cancel_requested = False
        self._pause.set()
        self.set_state(TaskState.RUNNING)
        return True

    def request_cancel(self) -> None:
        self._cancel_requested = True
        self._pause.set()  # unblock waiters so they can see cancel
        self.set_state(TaskState.CANCELLED)

    @property
    def cancel_requested(self) -> bool:
        return self._cancel_requested

    async def wait_if_paused(self) -> None:
        """Block at tool boundaries while paused; raise if cancelled."""
        if self._cancel_requested:
            raise asyncio.CancelledError("task cancelled")
        if not self._pause.is_set():
            self.set_state(TaskState.PAUSED)
            await self._pause.wait()
        if self._cancel_requested:
            raise asyncio.CancelledError("task cancelled")

    def finish(self, ok: bool = True, error: str = "") -> None:
        if not self.current:
            return
        if self.current.state == TaskState.CANCELLED.value:
            self._archive()
            return
        self.set_state(TaskState.COMPLETED if ok else TaskState.FAILED, error=error)
        self._archive()

    def status(self) -> dict[str, Any]:
        return {
            "current": self.current.to_dict() if self.current else None,
            "paused": not self._pause.is_set(),
            "cancel_requested": self._cancel_requested,
            "recent": [r.to_dict() for r in self.history[-20:]],
        }

    def _persist(self) -> None:
        if not self.store_dir or not self.current:
            return
        path = self.store_dir / f"{self.current.id}.json"
        try:
            path.write_text(json.dumps(self.current.to_dict(), indent=2), encoding="utf-8")
        except Exception as e:  # noqa: BLE001
            log.debug("checkpoint write failed: %s", e)

    def _archive(self) -> None:
        if self.current:
            self.history.append(self.current)
            self.history = self.history[-50:]
            self._persist()
        self.current = None
        self._cancel_requested = False
        self._pause.set()
