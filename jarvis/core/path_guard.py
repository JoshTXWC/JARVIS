"""Canonical path validation and project-scoped filesystem access."""
from __future__ import annotations

import os
from pathlib import Path


class PathDenied(PermissionError):
    """Raised when a path escapes the allowed roots."""


def expand(path: str) -> Path:
    return Path(os.path.expandvars(os.path.expanduser(path or ""))).resolve()


def allowed_roots(project_root: Path, extra: list[str] | None = None) -> list[Path]:
    roots = [Path(project_root).resolve()]
    # User home is readable for SAFE list/stat under confirm, but writes stay jailed
    # to project + explicit extras unless elevated.
    for raw in extra or []:
        try:
            roots.append(expand(raw))
        except Exception:
            continue
    return roots


def is_under(path: Path, roots: list[Path]) -> bool:
    try:
        resolved = path.resolve()
    except Exception:
        return False
    for root in roots:
        try:
            resolved.relative_to(root)
            return True
        except ValueError:
            continue
    return False


def assert_readable(path: str, project_root: Path, *, allow_home: bool = True) -> Path:
    """Resolve and ensure path is under project (or home if allowed)."""
    p = expand(path)
    roots = allowed_roots(project_root)
    if allow_home:
        roots.append(Path.home().resolve())
    # Block obvious secret files even under home
    name = p.name.lower()
    if name in {".env", ".env.local", "credentials", "credentials.json", "id_rsa", "id_ed25519"}:
        raise PathDenied(f"access denied to sensitive file: {p.name}")
    if name.endswith(".pem") or name.endswith(".key") or name == "authorized_keys":
        raise PathDenied(f"access denied to credential material: {p.name}")
    if not is_under(p, roots):
        raise PathDenied(f"path outside allowed roots: {p}")
    return p


def assert_writable(path: str, project_root: Path, extra: list[str] | None = None) -> Path:
    """Writes/deletes must stay inside project root (+ explicit extras)."""
    p = expand(path)
    roots = allowed_roots(project_root, extra)
    if not is_under(p, roots):
        raise PathDenied(f"write/delete outside project root denied: {p}")
    return p
