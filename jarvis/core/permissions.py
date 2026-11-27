"""Permission tiers, denylist, approval grants, and audit.

SAFE  — low-exposure read-only / telemetry (never secret reads)
CAUTION — reversible local mutation, restricted execution
DANGEROUS — destructive, unrestricted shell, credentials, irreversible external

Authorization is enforced here and in the orchestrator — never by the model.
`bypass` cannot clear hard denials (denylist, secret exfil, path escapes).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

from ..config import Config
from .secrets import canonical_args_hash, looks_like_secret_exfil_command, redact_args, redact_text

log = logging.getLogger("jarvis.permissions")

GRANT_TTL_S = 120
AUDIT_MAX = 200


class Permission(str, Enum):
    SAFE = "safe"
    CAUTION = "caution"
    DANGEROUS = "dangerous"


class Decision(str, Enum):
    ALLOW = "allow"
    ASK = "ask"
    DENY = "deny"


@dataclass
class PermissionRequest:
    tool: str
    args: dict[str, Any]
    permission: Permission
    preview: str
    reason: str = ""
    session_id: str = ""


@dataclass
class PermissionResult:
    decision: Decision
    user_reason: str = ""


@dataclass
class ApprovalGrant:
    """Short-lived, single-use approval bound to tool + args + session."""
    token: str
    tool: str
    args_hash: str
    session_id: str
    permission: str
    preview: str
    created_at: float
    expires_at: float
    used: bool = False

    def valid_for(self, tool: str, args: dict[str, Any], session_id: str) -> bool:
        if self.used:
            return False
        if time.time() > self.expires_at:
            return False
        if self.tool != tool:
            return False
        if self.session_id and session_id and self.session_id != session_id:
            return False
        return hmac.compare_digest(self.args_hash, canonical_args_hash(args))


@dataclass
class SecurityEvent:
    ts: float
    action: str  # allow | ask | deny | grant | revoke | hard_deny
    tool: str
    permission: str
    preview: str
    reason: str = ""
    mode: str = ""


class PermissionManager:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.mode = (cfg.permissions.mode or "confirm").strip().lower()
        self._deny: list[tuple[str, Any]] = []
        for raw in cfg.permissions.denylist:
            compiled = None
            try:
                import re
                compiled = re.compile(raw, re.IGNORECASE)
            except Exception:
                compiled = None
            self._deny.append((raw, compiled))
        self._grants: dict[str, ApprovalGrant] = {}
        self._lock = threading.Lock()
        self._events: deque[SecurityEvent] = deque(maxlen=AUDIT_MAX)
        self._server_secret = secrets.token_hex(32)

    # ── denylist / hard boundaries ─────────────────────────────────────

    def is_denylisted(self, text: str) -> str | None:
        if not text:
            return None
        for raw, compiled in self._deny:
            if compiled is not None:
                if compiled.search(text):
                    return raw
            elif raw.lower() in text.lower():
                return raw
        return None

    def hard_deny_reason(self, req: PermissionRequest) -> str | None:
        """Boundaries that NO mode (including bypass) may clear."""
        denied = self.is_denylisted(req.preview) or self.is_denylisted(
            json.dumps(req.args, default=str)
        )
        if denied:
            return f"denylist match: {denied}"

        cmd = str(req.args.get("command") or req.args.get("code") or "")
        if looks_like_secret_exfil_command(cmd) or looks_like_secret_exfil_command(req.preview):
            return "secret exfiltration pattern blocked"

        # Unrestricted elevated shell markers
        if req.tool in {"run_shell", "run_powershell"} and req.args.get("elevated"):
            if self.mode == "bypass":
                return "elevated shell cannot use bypass — explicit confirm required"
        return None

    # ── evaluate ───────────────────────────────────────────────────────

    def evaluate(self, req: PermissionRequest) -> Decision:
        hard = self.hard_deny_reason(req)
        if hard:
            self._audit("hard_deny", req, hard)
            return Decision.DENY

        # bypass: auto-allow except hard boundaries (already checked)
        if self.mode == "bypass":
            # Still force ASK for DANGEROUS — bypass no longer auto-runs destroyers
            if req.permission is Permission.DANGEROUS:
                self._audit("ask", req, "bypass still requires confirm for DANGEROUS")
                return Decision.ASK
            self._audit("allow", req, "bypass")
            return Decision.ALLOW

        if req.permission is Permission.SAFE:
            self._audit("allow", req, "safe")
            return Decision.ALLOW

        if self.mode == "auto":
            if req.permission is Permission.CAUTION:
                self._audit("allow", req, "auto/caution")
                return Decision.ALLOW
            self._audit("ask", req, "auto/dangerous")
            return Decision.ASK

        if self.mode == "safe":
            if req.permission is Permission.CAUTION:
                self._audit("ask", req, "safe/caution")
                return Decision.ASK
            self._audit("deny", req, "safe mode blocks DANGEROUS")
            return Decision.DENY

        # confirm (default)
        self._audit("ask", req, "confirm")
        return Decision.ASK

    # ── grants ─────────────────────────────────────────────────────────

    def issue_grant(self, req: PermissionRequest, session_id: str = "") -> ApprovalGrant:
        token = secrets.token_urlsafe(24)
        now = time.time()
        grant = ApprovalGrant(
            token=token,
            tool=req.tool,
            args_hash=canonical_args_hash(req.args),
            session_id=session_id or req.session_id,
            permission=req.permission.value,
            preview=redact_text(req.preview),
            created_at=now,
            expires_at=now + GRANT_TTL_S,
        )
        with self._lock:
            self._grants[token] = grant
            self._purge_locked()
        self._audit("grant", req, f"issued ttl={GRANT_TTL_S}s")
        return grant

    def consume_grant(
        self,
        token: str,
        tool: str,
        args: dict[str, Any],
        session_id: str = "",
    ) -> bool:
        with self._lock:
            self._purge_locked()
            grant = self._grants.get(token)
            if not grant:
                return False
            if not grant.valid_for(tool, args, session_id):
                return False
            grant.used = True
            del self._grants[token]
        self._events.appendleft(SecurityEvent(
            ts=time.time(), action="allow", tool=tool,
            permission=grant.permission, preview=grant.preview,
            reason="grant consumed", mode=self.mode,
        ))
        return True

    def revoke_all_grants(self) -> int:
        with self._lock:
            n = len(self._grants)
            self._grants.clear()
        self._events.appendleft(SecurityEvent(
            ts=time.time(), action="revoke", tool="*",
            permission="", preview="", reason=f"revoked {n} grants", mode=self.mode,
        ))
        return n

    def _purge_locked(self) -> None:
        now = time.time()
        dead = [k for k, g in self._grants.items() if g.used or g.expires_at < now]
        for k in dead:
            del self._grants[k]

    # ── audit ──────────────────────────────────────────────────────────

    def _audit(self, action: str, req: PermissionRequest, reason: str = "") -> None:
        ev = SecurityEvent(
            ts=time.time(),
            action=action,
            tool=req.tool,
            permission=req.permission.value,
            preview=redact_text(req.preview)[:240],
            reason=reason,
            mode=self.mode,
        )
        self._events.appendleft(ev)
        log.info(
            "perm %s tool=%s tier=%s mode=%s reason=%s",
            action, req.tool, req.permission.value, self.mode, reason,
        )

    def recent_events(self, limit: int = 50) -> list[dict[str, Any]]:
        out = []
        for e in list(self._events)[:limit]:
            out.append({
                "ts": e.ts,
                "action": e.action,
                "tool": e.tool,
                "permission": e.permission,
                "preview": e.preview,
                "reason": e.reason,
                "mode": e.mode,
            })
        return out

    def pending_grants(self) -> list[dict[str, Any]]:
        with self._lock:
            self._purge_locked()
            return [
                {
                    "tool": g.tool,
                    "permission": g.permission,
                    "preview": g.preview,
                    "expires_at": g.expires_at,
                }
                for g in self._grants.values()
            ]

    def set_mode(self, mode: str) -> None:
        m = (mode or "confirm").strip().lower()
        if m not in {"confirm", "safe", "auto", "bypass"}:
            raise ValueError(f"invalid permission mode: {mode}")
        self.mode = m
        # Persist into live config object
        try:
            self.cfg.permissions.mode = m
        except Exception:
            pass
        self._events.appendleft(SecurityEvent(
            ts=time.time(), action="mode", tool="*",
            permission="", preview="", reason=f"mode → {m}", mode=m,
        ))


def redacted_preview(preview: str, args: dict[str, Any] | None = None) -> str:
    return redact_text(preview)
