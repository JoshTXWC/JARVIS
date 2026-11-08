"""Lifecycle manager for the vendored [barehands](https://github.com/jaredrhod/barehands) stage.

Starts the stdlib Python server on demand, writes ring state, and POSTs
board commands to localhost. AGPL-3.0 — attribution preserved in the
cloned tree under integrations/barehands/.
"""
from __future__ import annotations

import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

log = logging.getLogger("jarvis.barehands")

REPO_URL = "https://github.com/jaredrhod/barehands.git"
DEFAULT_PORT = 8794

_proc: subprocess.Popen | None = None
_lock = threading.Lock()
_root: Path | None = None
_port: int = DEFAULT_PORT


def configure(project_root: Path, *, port: int = DEFAULT_PORT, path: str | None = None) -> None:
    global _root, _port
    _port = int(port or DEFAULT_PORT)
    if path:
        p = Path(path)
        _root = p if p.is_absolute() else (project_root / p)
    else:
        _root = project_root / "integrations" / "barehands"


def root() -> Path:
    if _root is None:
        raise RuntimeError("barehands not configured")
    return _root


def stage_url() -> str:
    return f"http://127.0.0.1:{_port}/stage.html"


def base_url() -> str:
    return f"http://127.0.0.1:{_port}"


def _port_open(port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.4):
            return True
    except OSError:
        return False


def ensure_installed() -> Path:
    """Clone barehands on first use if the local tree is missing."""
    r = root()
    if (r / "server.py").exists():
        _ensure_config(r)
        return r
    r.parent.mkdir(parents=True, exist_ok=True)
    log.info("cloning barehands → %s", r)
    subprocess.run(
        ["git", "clone", "--depth", "1", REPO_URL, str(r)],
        check=True,
        cwd=str(r.parent),
    )
    _ensure_config(r)
    return r


def _ensure_config(r: Path) -> None:
    cfg = r / "barehands.json"
    if cfg.exists():
        return
    example = r / "barehands.json.example"
    payload = {
        "name": "JARVIS",
        "port": _port,
        "orbs": [
            {"title": "Notes", "path": "sample-notes", "kind": "notes"},
            {"title": "Props", "path": "media", "kind": "media"},
        ],
    }
    if example.exists():
        try:
            data = json.loads(example.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data["name"] = "JARVIS"
                data["port"] = _port
                payload = data
        except Exception:  # noqa: BLE001
            pass
    cfg.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    log.info("wrote %s", cfg)


def status() -> dict[str, Any]:
    installed = False
    try:
        installed = (root() / "server.py").exists()
    except Exception:  # noqa: BLE001
        installed = False
    running = _port_open(_port)
    return {
        "installed": installed,
        "running": running,
        "port": _port,
        "url": stage_url(),
        "base_url": base_url(),
        "root": str(root()) if installed else None,
        "pid": _proc.pid if _proc and _proc.poll() is None else None,
    }


def ensure_running(timeout_s: float = 20.0) -> dict[str, Any]:
    """Install if needed, start the server if the port is quiet, wait until up."""
    with _lock:
        ensure_installed()
        if _port_open(_port):
            return status()
        global _proc
        if _proc is not None and _proc.poll() is None:
            # Process up but port not yet listening — fall through to wait.
            pass
        else:
            r = root()
            py = sys.executable
            log_path = r / "jarvis-barehands.log"
            logf = open(log_path, "a", encoding="utf-8")  # noqa: SIM115
            env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
            creationflags = 0
            if os.name == "nt":
                creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
            _proc = subprocess.Popen(
                [py, "server.py"],
                cwd=str(r),
                env=env,
                stdout=logf,
                stderr=subprocess.STDOUT,
                creationflags=creationflags,
            )
            log.info("started barehands pid=%s port=%s", _proc.pid, _port)

        deadline = time.time() + timeout_s
        while time.time() < deadline:
            if _port_open(_port):
                return status()
            if _proc is not None and _proc.poll() is not None:
                raise RuntimeError(
                    f"barehands exited early (code {_proc.returncode}); "
                    f"see {root() / 'jarvis-barehands.log'}"
                )
            time.sleep(0.25)
        raise TimeoutError(f"barehands did not open port {_port} within {timeout_s}s")


def stop() -> dict[str, Any]:
    global _proc
    with _lock:
        if _proc is not None and _proc.poll() is None:
            try:
                _proc.terminate()
                try:
                    _proc.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    _proc.kill()
            except Exception as e:  # noqa: BLE001
                log.warning("stop barehands: %s", e)
            _proc = None
        return status()


def set_ring_state(state: str) -> None:
    """Write idle|listening|thinking|speaking into state/state for the ring."""
    state = (state or "idle").strip().lower()
    if state not in {"idle", "listening", "thinking", "speaking"}:
        state = "idle"
    try:
        r = root()
        if not (r / "server.py").exists():
            return
        path = r / "state" / "state"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(state, encoding="utf-8")
    except Exception as e:  # noqa: BLE001
        log.debug("ring state write failed: %s", e)


def send_cmd(payload: dict[str, Any]) -> dict[str, Any]:
    """POST a board command to /cmd. Starts the server if needed."""
    ensure_running()
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url()}/cmd",
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            body = resp.read().decode("utf-8", "replace")
            try:
                return json.loads(body) if body else {"ok": True}
            except json.JSONDecodeError:
                return {"ok": True, "raw": body}
    except urllib.error.HTTPError as e:
        err = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"barehands /cmd HTTP {e.code}: {err}") from e
