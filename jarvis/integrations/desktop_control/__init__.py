"""Barehands 2.0 — localhost Windows desktop gesture control.

Opt-in, session-authenticated, loopback-only. Tracking landmarks arrive from
the Electron/HUD MediaPipe pipeline; this package never opens a webcam.
"""
from __future__ import annotations

from .service import DesktopControlService, get_desktop_control, reset_desktop_control

__all__ = [
    "DesktopControlService",
    "get_desktop_control",
    "reset_desktop_control",
]
