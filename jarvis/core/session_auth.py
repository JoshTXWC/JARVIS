"""Desktop session authentication for localhost API + WebSocket.

Electron (or a trusted bootstrap) receives a one-time session token generated
at backend start. Privileged routes and WS require `X-Jarvis-Session` /
`?session=` / WS first message auth. Tokens are never logged.
"""
from __future__ import annotations

import hmac
import os
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Iterable

# Origins allowed for CORS / WS when not in open-dev mode.
DEFAULT_TRUSTED_ORIGINS = (
    "http://127.0.0.1:7341",
    "http://localhost:7341",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "null",  # Electron file:// sometimes reports null
)


@dataclass
class SessionInfo:
    token: str
    created_at: float
    label: str = "desktop"


class SessionAuth:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        # Primary session minted at process start (Electron reads via localhost bootstrap).
        self._token = secrets.token_urlsafe(32)
        self._created = time.time()
        self._extra: set[str] = set()
        # Dev escape: JARVIS_AUTH_DISABLED=1 for raw browser testing only.
        self.disabled = os.environ.get("JARVIS_AUTH_DISABLED", "").strip() in {"1", "true", "yes"}

    @property
    def token(self) -> str:
        return self._token

    def mint_bootstrap_payload(self) -> dict:
        """Returned once to Electron via authenticated loopback bootstrap."""
        return {
            "session": self._token,
            "created_at": self._created,
            "auth_required": not self.disabled,
        }

    def check(self, provided: str | None) -> bool:
        if self.disabled:
            return True
        if not provided:
            return False
        with self._lock:
            candidates = {self._token, *self._extra}
        for t in candidates:
            if hmac.compare_digest(t, provided):
                return True
        return False

    def rotate(self) -> str:
        with self._lock:
            self._token = secrets.token_urlsafe(32)
            self._created = time.time()
            return self._token

    def revoke(self) -> None:
        self.rotate()
        with self._lock:
            self._extra.clear()


_AUTH: SessionAuth | None = None


def get_session_auth() -> SessionAuth:
    global _AUTH
    if _AUTH is None:
        _AUTH = SessionAuth()
    return _AUTH


def trusted_origins(extra: Iterable[str] | None = None) -> list[str]:
    origins = list(DEFAULT_TRUSTED_ORIGINS)
    env = os.environ.get("JARVIS_CORS_ORIGINS", "")
    if env:
        origins.extend(x.strip() for x in env.split(",") if x.strip())
    if extra:
        origins.extend(extra)
    # de-dupe preserve order
    seen: set[str] = set()
    out: list[str] = []
    for o in origins:
        if o not in seen:
            seen.add(o)
            out.append(o)
    return out


def origin_allowed(origin: str | None, allowed: list[str]) -> bool:
    if not origin:
        # Non-browser clients (Electron net, curl) may omit Origin — allow if session ok.
        return True
    if origin in allowed:
        return True
    # Allow any 127.0.0.1 / localhost port for same-machine Vite HMR variants
    if origin.startswith("http://127.0.0.1:") or origin.startswith("http://localhost:"):
        return True
    return False
