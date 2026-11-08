"""Gemini Computer-Use web agent tool — autonomous multi-step browser tasks.

Ported from https://github.com/nazirlouis/ada_v2. Requires GEMINI_API_KEY.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import time
from pathlib import Path

from ..core.permissions import Permission
from .base import PluginInfo, tool

log = logging.getLogger("jarvis.plugins.web_agent")
MEDIA_PREFIX = "__JARVIS_MEDIA__"
UI_PREFIX = "__JARVIS_UI__"


def register(registry):
    cfg = registry.cfg
    shots_dir = cfg.abs_path("data/screenshots/web_agent")
    shots_dir.mkdir(parents=True, exist_ok=True)

    @tool(
        name="web_agent",
        description=(
            "★ Autonomous Gemini computer-use web agent. Opens a headless "
            "Chromium browser and completes a multi-step web task from a "
            "natural-language prompt (navigate, click, type, scroll, read). "
            "Use when the user wants JARVIS to *do something on the web* "
            "end-to-end — fill a form, compare prices across sites, book/"
            "check something, walk through a multi-page flow — NOT for "
            "simple search (use web_search) or opening one URL (use "
            "browser_open / open_inline). Needs GEMINI_API_KEY. Screenshots "
            "stream into the Media Bay as the agent works."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Detailed instructions for the browser agent.",
                },
                "max_turns": {
                    "type": "integer",
                    "default": 15,
                    "description": "Max browser action turns (default 15, max 25).",
                },
                "headless": {
                    "type": "boolean",
                    "default": True,
                    "description": "Run Chromium headless (true) or visible (false).",
                },
            },
            "required": ["prompt"],
        },
        preview=lambda a: f"web agent → {(a.get('prompt') or '')[:80]}",
    )
    async def web_agent(
        prompt: str,
        max_turns: int = 15,
        headless: bool = True,
    ) -> str:
        api_key = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key:
            return (
                "GEMINI_API_KEY is not set. Add it to .env from "
                "https://aistudio.google.com/app/apikey, then restart JARVIS."
            )

        from ..integrations.web_agent import WebAgent

        agent = WebAgent(api_key=api_key)
        frames: list[dict] = []
        logs: list[str] = []

        async def on_update(screenshot_b64: str | None, message: str) -> None:
            logs.append(message)
            if not screenshot_b64:
                return
            try:
                raw = base64.b64decode(screenshot_b64)
                name = f"web_agent_{int(time.time() * 1000)}.png"
                path = shots_dir / name
                path.write_bytes(raw)
                rel = f"/api/files/screenshots/web_agent/{name}"
                frames.append({
                    "url": rel,
                    "title": message[:80] or "Web agent frame",
                    "snippet": message,
                    "thumbnail": rel,
                })
            except Exception as e:  # noqa: BLE001
                log.warning("failed to save web_agent frame: %s", e)

        turns = max(1, min(int(max_turns or 15), 25))
        try:
            summary = await agent.run_task(
                prompt,
                update_callback=on_update,
                max_turns=turns,
                headless=bool(headless),
            )
        except Exception as e:  # noqa: BLE001
            log.exception("web_agent failed")
            return f"Web agent failed: {e}"

        parts: list[str] = []
        if frames:
            payload = {
                "kind": "image",
                "items": frames[-6:],  # last few frames in Media Bay
                "summary": f"Web agent · {len(frames)} frames",
            }
            parts.append(MEDIA_PREFIX + json.dumps(payload, ensure_ascii=False))
        parts.append(
            f"Web agent finished.\n"
            f"Goal: {prompt}\n"
            f"Steps logged: {len(logs)}\n"
            f"Result: {summary}"
        )
        return "\n".join(parts)

    registry.register_plugin(
        PluginInfo(
            name="web_agent_tools",
            description="Gemini Computer-Use autonomous browser agent (ada_v2 port).",
        )
    )
