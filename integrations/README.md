# Integrations

## barehands

Hand-tracked glass stage by [Jared Rhodenizer](https://github.com/jaredrhod/barehands) (AGPL-3.0-or-later).

JARVIS vendors a clone under `integrations/barehands/`. The HUD **Hands** button (top-right) and voice keywords (`barehands`, `hands mode`, …) start its local server on port **8794** and open the stage overlay.

If the folder is missing:

```bat
git clone --depth 1 https://github.com/jaredrhod/barehands.git integrations\barehands
```

Credit and license terms ship inside that folder (`LICENSE`, `README.md`).

## web_agent (ada_v2 port)

Gemini Computer-Use autonomous browser agent, adapted from
[nazirlouis/ada_v2](https://github.com/nazirlouis/ada_v2).

- Tool: `web_agent` (plugin `web_agent_tools`)
- Needs `GEMINI_API_KEY` in `.env` and `pip install google-genai`
- Needs Playwright Chromium: `python -m playwright install chromium`
- Screenshots land in `data/screenshots/web_agent/` and stream into the Media Bay

## Gesture HUD (ada_v2 port)

Top-bar **Gestures** toggle enables MediaPipe hand tracking on the main HUD:

| Gesture | Action |
|---------|--------|
| Pinch | Click under the cursor |
| Fist | Grab + drag a floating panel |
| Open palm | Release |

Uses `web/public/hand_landmarker.task` and MediaPipe Tasks Vision loaded from CDN.
