# Barehands Tracking Optimization — Validation

## Automated

```bash
# Frontend coord / One Euro / pinch semantics
cd web && npm test

# Backend desktop-control + coords
pytest tests/test_desktop_control.py -q
```

Covered: camera↔preview cover+mirror, camera↔desktop multi-mon (negative origins),
clamping, One Euro stationary/fast/jump, pinch click-vs-drag exclusivity,
Python edge proximity + One Euro.

## Manual procedure (before / after)

Enable **Hands** + **Desktop Control**. Open **Settings → Tracking & Precision**.
Turn on **Diagnostics**. Use preset **Balanced** first.

| Test | How | Pass criteria |
|---|---|---|
| Center accuracy | Point at screen center | Cursor within ~1–2 cm of tip intent |
| Corner reach | Move toward each corner without stretching to webcam edges | All four corners reachable via calibrated region |
| Stationary jitter | Hold still 5 s at center | Diagnostics stability high; no visible shake |
| Fast latency | Whip tip left↔right | Cursor keeps up; no rubber-band lag |
| Pinch click | Short pinch on a desktop icon | Click lands on lock point; tip may move, cursor must not |
| Drag | Hold pinch >0.4 s then move | Drag starts without click; no jump at arm |
| Two hands | Bring second hand into frame | Cursor stays on dominant; no teleport |
| Overlay | Minimize JARVIS over Chrome | Skeleton (camera space) + cyan cursor (desktop UV) both visible; overlay click-through |
| Edge quality | Move tip near webcam border | Quality dips; no wild jumps; cursor soft-stops at control bound |
| Lighting | Dim / bright room | Tracking recovers; loss releases mouse buttons |

Record: camera FPS, infer FPS, avg infer ms, estimated latency from the diagnostics panel at 720p30, 720p60, 1080p30, 1080p60. Prefer the highest stable infer FPS with GPU delegate.

## Coordinate spaces (do not conflate)

1. **Camera** — MediaPipe landmarks  
2. **Preview** — mirrored `object-cover` HUD/overlay skeleton  
3. **Control** — calibrated normalized region  
4. **Desktop** — Windows virtual screen (multi-mon, negative origins)  

Fingertip skeleton aligns with the camera preview. The Windows cursor aligns with calibration.
