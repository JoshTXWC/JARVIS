# Barehands 2.0 — Windows Desktop Gesture Control

## Audit summary (current state)

| Piece | Role today | Keep / extend |
|---|---|---|
| `GestureOverlay.tsx` | Single MediaPipe pipeline in HUD; pinch=DOM click, fist=drag tiles, 2-hand scale | **Extend** — remain the only webcam owner |
| `BarehandsOverlay.tsx` + `barehands_mgr.py` | Vendored AGPL glass stage on `:8794` | **Preserve** — do not merge cameras |
| `store.ts` `gestureEnabled` | Opt-in Hands toggle | **Extend** with desktop modes (off by default) |
| Electron `main.cjs` | Tray-resident HUD; renderer survives hide | **Extend** — desktop overlay window + shortcuts |
| FastAPI / WS | Loopback `127.0.0.1`, session auth | **Reuse** for authenticated desktop-control stream |

There is **no** system-wide mouse/window injection today. HUD gestures only hit DOM via `elementFromPoint`.

## Architecture

```
GestureOverlay (single MediaPipe + camera)
        │
        ├─ HUD mode → existing DOM events (unchanged)
        ├─ IPC → Electron desktop overlay (skeleton / cursor viz)
        └─ WS `hands_frame` → jarvis.integrations.desktop_control
                                    ├─ PrecisionEngine → SendInput
                                    └─ SpatialEngine → Win32 window APIs
```

### Hard rules

1. **One camera** — only `GestureOverlay` opens `getUserMedia`. Overlay windows render landmarks from IPC, never open a second session.
2. **Opt-in** — `desktop_control.enabled` defaults **false**; no silent webcam / input injection.
3. **Loopback + session** — desktop-control HTTP/WS only on `127.0.0.1` with `X-Jarvis-Session` / WS session query.
4. **One injector** — HUD | Precision | Spatial; mode switch releases mouse buttons and cancels gestures.
5. **No privilege bypass** — never target UAC / lock screen / secure desktop.
6. **Approved actions only** — gestures may trigger allow-listed JARVIS UI actions, never arbitrary shell.

### Modes

| Mode | Injects OS input? | Tracking viz |
|---|---|---|
| `hud` | No (DOM only) | Existing HUD skeleton |
| `precision` | Mouse / scroll | Desktop overlay |
| `spatial` | Window APIs + limited keys | Desktop overlay |

### Incremental delivery

1. Shared gesture/coord math + unit tests (mocked input)
2. Precision engine + auth gates + emergency stop
3. Electron click-through overlay + control chip
4. Spatial engine + cooldowns
5. Settings / calibration / shortcuts / docs / PR

## Safety checklist

- [x] Disabled by default
- [x] Emergency stop shortcut (Ctrl+Shift+Alt+Esc)
- [x] Auto mouse-up on tracking loss
- [x] Click debounce / cooldowns
- [x] Camera indicator on overlay
- [x] Resources released when disabled
- [x] Loopback + session auth on desktop-control APIs
- [x] Allow-listed JARVIS actions only (no shell via gestures)

## Implemented in this branch

- `jarvis/integrations/desktop_control/` — Precision + Spatial engines, Win32 SendInput, mocked tests
- REST `/api/desktop-control/*` + WS `hands_frame` / `desktop_control`
- Electron click-through multi-monitor overlay (`desktop-overlay.html`)
- Settings panel + store flags (injection never auto-starts from persistence)
- Shared MediaPipe path via `GestureOverlay` (no second webcam)

## Tracking optimization (current)

- Separated coordinate spaces: camera → preview vs camera → control → desktop (`web/src/lib/hands/coords.ts`)
- One Euro adaptive filtering for cursor + lighter viz filters (`oneEuro.ts`)
- Shared MediaPipe pipeline with GPU→CPU fallback, rVFC scheduling, frame drop-on-busy
- Dominant-hand identity continuity (`handIdentity.ts`)
- Hand-size–normalized pinch lock / click / drag (`precisionControl.ts`)
- Calibration wizard + Tracking & Precision panel (presets Fast / Balanced / Precision)
- Overlay skeleton uses object-cover camera mapping; cursor uses calibrated desktop UV
- Validation: `docs/barehands-tracking-validation.md`

## Still iterative / polish

- Optional MediaPipe Web Worker offload (main-thread rVFC + drop-stale ships today)
- Per-gesture remapping editor in Settings
- Voice phrases to enable Precision/Spatial (can use Settings + shortcuts today)
- UI Automation deep control targeting beyond Win32 window APIs
