"""Allow-listed JARVIS UI actions invokable from gestures (no shell)."""
from __future__ import annotations

from typing import Any

# Gestures may only request these action ids. The frontend / orchestrator
# interprets them; nothing here executes OS commands.
ALLOWED_JARVIS_ACTIONS = frozenset({
    "open_jarvis",
    "activate_voice",
    "open_tools",
    "open_settings",
    "open_diagnostics",
    "open_workspace",
    "open_command_palette",
    "show_desktop_overlay_help",
})


def sanitize_jarvis_action(action: str | None) -> str | None:
    if not action:
        return None
    a = str(action).strip().lower()
    return a if a in ALLOWED_JARVIS_ACTIONS else None


def describe_actions() -> list[dict[str, Any]]:
    return [
        {"id": "open_jarvis", "label": "Show JARVIS window"},
        {"id": "activate_voice", "label": "Start voice listening"},
        {"id": "open_tools", "label": "Open Tools panel"},
        {"id": "open_settings", "label": "Open Settings"},
        {"id": "open_diagnostics", "label": "Open system diagnostics"},
        {"id": "open_workspace", "label": "Open project workspace"},
        {"id": "open_command_palette", "label": "Open command menu"},
        {"id": "show_desktop_overlay_help", "label": "Show gesture help"},
    ]
