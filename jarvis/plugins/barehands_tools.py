"""Barehands — hand-tracked glass stage (https://github.com/jaredrhod/barehands).

Enable in config.yaml:
  plugins:
    barehands_tools: { enabled: true }
  barehands:
    enabled: true
"""
from __future__ import annotations

import json

from ..core.permissions import Permission
from ..integrations import barehands_mgr as bh
from .base import PluginInfo, tool

UI_PREFIX = "__JARVIS_UI__"


def register(registry):
    cfg = registry.cfg
    bh_cfg = getattr(cfg, "barehands", None)
    port = int(getattr(bh_cfg, "port", 8794) or 8794)
    path = getattr(bh_cfg, "path", None) or "integrations/barehands"
    bh.configure(cfg.project_root, port=port, path=path)

    @tool(
        name="barehands_open",
        description=(
            "Open the Barehands hand-tracked glass stage (webcam hand UI). "
            "Use when the user says barehands / bare hands / hands mode / "
            "hand tracking / activate barehands. Starts the local stage server "
            "and tells the HUD to show it fullscreen."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
        preview=lambda _a: "open Barehands stage",
    )
    def barehands_open() -> str:
        st = bh.ensure_running()
        bh.set_ring_state("listening")
        ui = {"action": "barehands", "open": True, "url": st["url"]}
        # UI_PREFIX must be parseable; keep human text AFTER so the emit hook
        # still finds the JSON line, or put JSON alone after the marker.
        return (
            f"{UI_PREFIX}{json.dumps(ui, ensure_ascii=False)}\n"
            f"Barehands stage is live at {st['url']}. Allow the camera and wave, sir."
        )

    @tool(
        name="barehands_close",
        description=(
            "Close / dismiss the Barehands stage overlay. "
            "Use for: close barehands, exit hands mode, dismiss bare hands."
        ),
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {}},
        preview=lambda _a: "close Barehands stage",
    )
    def barehands_close() -> str:
        bh.set_ring_state("idle")
        ui = {"action": "barehands", "open": False}
        return (
            f"{UI_PREFIX}{json.dumps(ui, ensure_ascii=False)}\n"
            "Closing the Barehands stage, sir."
        )

    @tool(
        name="barehands_present",
        description=(
            "Put a card center-stage on the Barehands glass board "
            "(show-me / put it up / present on the board). Starts Barehands if needed."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string", "default": ""},
            },
            "required": ["title"],
        },
        preview=lambda a: f"present on Barehands: {a.get('title', '')}",
    )
    def barehands_present(title: str, body: str = "") -> str:
        bh.ensure_running()
        bh.send_cmd({"a": "present", "title": title, "body": body or ""})
        ui = {"action": "barehands", "open": True, "url": bh.stage_url()}
        return (
            f"{UI_PREFIX}{json.dumps(ui, ensure_ascii=False)}\n"
            f"Presented “{title}” on the Barehands board."
        )

    @tool(
        name="barehands_add_card",
        description="Add a glass card to the Barehands board (not spotlighted).",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "body": {"type": "string", "default": ""},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
            "required": ["title"],
        },
    )
    def barehands_add_card(
        title: str,
        body: str = "",
        x: float | None = None,
        y: float | None = None,
    ) -> str:
        bh.ensure_running()
        cmd: dict = {"a": "add_card", "title": title, "body": body or ""}
        if x is not None:
            cmd["x"] = x
        if y is not None:
            cmd["y"] = y
        bh.send_cmd(cmd)
        ui = {"action": "barehands", "open": True, "url": bh.stage_url()}
        return (
            f"{UI_PREFIX}{json.dumps(ui, ensure_ascii=False)}\n"
            f"Card “{title}” staged on Barehands."
        )

    registry.register_plugin(PluginInfo(
        name="barehands_tools",
        description="Barehands hand-tracked glass stage (AGPL-3.0, jaredrhod/barehands).",
        permissions_needed=[Permission.SAFE],
        enabled=True,
    ))
