"""Thin client for Ollama's native HTTP API (http://127.0.0.1:11434).

Used by the model manager (list / pull with progress / delete / show) and to
start `ollama serve` in the background when JARVIS boots against a local
Ollama endpoint that isn't up yet.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import time
from dataclasses import dataclass, field
from typing import Any

import httpx

log = logging.getLogger("jarvis.ollama")


def native_base(cfg) -> str:
    """Ollama's native root (…:11434) derived from the configured endpoints."""
    for ep in (getattr(cfg.model, "endpoint", None), getattr(cfg.model, "local_endpoint", None)):
        ep = (ep or "").rstrip("/")
        if "11434" in ep:
            return ep[:-3] if ep.endswith("/v1") else ep
    return os.environ.get("OLLAMA_HOST_URL", "http://127.0.0.1:11434").rstrip("/")


def find_ollama_binary() -> str | None:
    found = shutil.which("ollama")
    if found:
        return found
    if sys.platform == "win32":
        # Default per-user install location of the Windows Ollama app.
        local = os.environ.get("LOCALAPPDATA", "")
        for cand in (
            os.path.join(local, "Programs", "Ollama", "ollama.exe"),
            r"C:\Program Files\Ollama\ollama.exe",
        ):
            if cand and os.path.isfile(cand):
                return cand
    return None


async def is_up(base: str, timeout: float = 1.5) -> bool:
    try:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(f"{base}/api/version")
            return r.status_code == 200
    except Exception:  # noqa: BLE001
        return False


async def version(base: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as c:
            r = await c.get(f"{base}/api/version")
            if r.status_code == 200:
                return (r.json() or {}).get("version")
    except Exception:  # noqa: BLE001
        pass
    return None


async def ensure_running(cfg, wait_s: float = 12.0) -> str:
    """Start `ollama serve` if the configured endpoint is a local Ollama that
    isn't answering. Returns a short status string for the boot log."""
    base = native_base(cfg)
    if "11434" not in base and "11434" not in (cfg.model.endpoint or ""):
        return "not an Ollama endpoint"
    if await is_up(base):
        return "running"
    if not getattr(cfg.model, "auto_start_ollama", True):
        return "not running (auto_start_ollama: false)"
    host = (base.split("://", 1)[-1].split(":", 1)[0] or "").lower()
    if host not in {"127.0.0.1", "localhost", "::1"}:
        return "not running (remote host)"
    exe = find_ollama_binary()
    if not exe:
        return "not installed — get it from https://ollama.com/download"
    env = dict(os.environ)
    # Larger default context than Ollama's 4096 unless the user chose one.
    env.setdefault("OLLAMA_CONTEXT_LENGTH", "8192")
    kwargs: dict[str, Any] = {
        "stdout": subprocess.DEVNULL,
        "stderr": subprocess.DEVNULL,
        "stdin": subprocess.DEVNULL,
        "env": env,
    }
    if sys.platform == "win32":
        kwargs["creationflags"] = 0x08000000 | 0x00000200  # CREATE_NO_WINDOW | NEW_PROCESS_GROUP
    else:
        kwargs["start_new_session"] = True
    try:
        subprocess.Popen([exe, "serve"], **kwargs)  # noqa: S603
    except Exception as e:  # noqa: BLE001
        return f"failed to start: {e}"
    deadline = time.monotonic() + wait_s
    while time.monotonic() < deadline:
        if await is_up(base):
            return "started"
        await asyncio.sleep(0.5)
    return "starting (not answering yet)"


async def list_installed(base: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=5.0) as c:
        r = await c.get(f"{base}/api/tags")
        r.raise_for_status()
        out = []
        for m in (r.json() or {}).get("models") or []:
            d = m.get("details") or {}
            size = int(m.get("size") or 0)
            out.append({
                "name": m.get("name") or m.get("model"),
                "size_bytes": size,
                "size_gb": round(size / 1e9, 2) if size else None,
                "modified_at": m.get("modified_at"),
                "family": d.get("family"),
                "parameter_size": d.get("parameter_size"),
                "quantization": d.get("quantization_level"),
                "format": d.get("format"),
            })
        return out


async def list_running(base: str) -> list[dict]:
    async with httpx.AsyncClient(timeout=3.0) as c:
        r = await c.get(f"{base}/api/ps")
        r.raise_for_status()
        return [
            {
                "name": m.get("name") or m.get("model"),
                "size_vram_gb": round(int(m.get("size_vram") or 0) / 1e9, 2),
                "expires_at": m.get("expires_at"),
                "context_length": m.get("context_length"),
            }
            for m in (r.json() or {}).get("models") or []
        ]


async def show(base: str, name: str) -> dict:
    async with httpx.AsyncClient(timeout=10.0) as c:
        r = await c.post(f"{base}/api/show", json={"model": name})
        r.raise_for_status()
        data = r.json() or {}
        info = data.get("model_info") or {}
        ctx = next((int(v) for k, v in info.items() if str(k).endswith("context_length")), None)
        return {
            "name": name,
            "capabilities": data.get("capabilities") or [],
            "details": data.get("details") or {},
            "context_length": ctx,
            "parameters": data.get("parameters") or "",
            "license": (data.get("license") or "")[:400],
        }


async def delete(base: str, name: str) -> None:
    async with httpx.AsyncClient(timeout=30.0) as c:
        r = await c.request("DELETE", f"{base}/api/delete", json={"model": name})
        if r.status_code >= 400:
            raise RuntimeError(f"ollama delete failed ({r.status_code}): {r.text[:200]}")


# ------------------------------------------------------------- pull jobs ---

@dataclass
class PullJob:
    name: str
    status: str = "queued"          # queued | pulling | success | error | cancelled
    detail: str = ""
    completed: int = 0
    total: int = 0
    error: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    task: asyncio.Task | None = None

    @property
    def percent(self) -> float | None:
        return round(100.0 * self.completed / self.total, 1) if self.total else None

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "status": self.status,
            "detail": self.detail,
            "completed": self.completed,
            "total": self.total,
            "percent": self.percent,
            "error": self.error,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
        }


_JOBS: dict[str, PullJob] = {}


def pull_jobs() -> list[dict]:
    return [j.as_dict() for j in sorted(_JOBS.values(), key=lambda j: j.started_at, reverse=True)]


def start_pull(base: str, name: str) -> PullJob:
    """Start (or return the in-flight) background pull for `name`."""
    existing = _JOBS.get(name)
    if existing and existing.status in {"queued", "pulling"}:
        return existing
    job = PullJob(name=name)
    _JOBS[name] = job
    job.task = asyncio.create_task(_run_pull(base, job))
    return job


def cancel_pull(name: str) -> bool:
    job = _JOBS.get(name)
    if not job or job.status not in {"queued", "pulling"} or not job.task:
        return False
    job.task.cancel()
    return True


async def _run_pull(base: str, job: PullJob) -> None:
    job.status = "pulling"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None)) as c:
            async with c.stream("POST", f"{base}/api/pull", json={"model": job.name, "stream": True}) as r:
                if r.status_code >= 400:
                    body = (await r.aread()).decode("utf-8", "replace")
                    raise RuntimeError(f"HTTP {r.status_code}: {body[:300]}")
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        ev = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if ev.get("error"):
                        raise RuntimeError(ev["error"])
                    job.detail = ev.get("status") or job.detail
                    if ev.get("total"):
                        job.total = int(ev["total"])
                        job.completed = int(ev.get("completed") or 0)
        job.status = "success"
        job.detail = "success"
    except asyncio.CancelledError:
        job.status = "cancelled"
        raise
    except Exception as e:  # noqa: BLE001
        job.status = "error"
        job.error = str(e) or type(e).__name__
        log.warning("ollama pull %s failed: %s", job.name, job.error)
    finally:
        job.finished_at = time.time()
