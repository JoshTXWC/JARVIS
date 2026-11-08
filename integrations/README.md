# Integrations

## barehands

Hand-tracked glass stage by [Jared Rhodenizer](https://github.com/jaredrhod/barehands) (AGPL-3.0-or-later).

JARVIS vendors a clone under `integrations/barehands/`. The HUD **Hands** button (top-right) and voice keywords (`barehands`, `hands mode`, …) start its local server on port **8794** and open the stage overlay.

If the folder is missing:

```bat
git clone --depth 1 https://github.com/jaredrhod/barehands.git integrations\barehands
```

Credit and license terms ship inside that folder (`LICENSE`, `README.md`).
