"""Map normalized hand landmarks → virtual-screen pixel coordinates."""
from __future__ import annotations

from dataclasses import dataclass

from .settings import Calibration


@dataclass(frozen=True)
class ScreenRect:
    x: int
    y: int
    width: int
    height: int

    @property
    def x2(self) -> int:
        return self.x + self.width

    @property
    def y2(self) -> int:
        return self.y + self.height


def clamp01(v: float) -> float:
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def apply_calibration(nx: float, ny: float, cal: Calibration) -> tuple[float, float]:
    """Map camera-normalized point through the active tracking region → 0–1 screen UV.

    Mirrors X so movement matches a selfie-view webcam.
    """
    x = 1.0 - clamp01(nx)
    y = clamp01(ny)
    w = max(1e-6, cal.x1 - cal.x0)
    h = max(1e-6, cal.y1 - cal.y0)
    u = clamp01((x - cal.x0) / w)
    v = clamp01((y - cal.y0) / h)
    return u, v


def uv_to_screen(
    u: float,
    v: float,
    screen: ScreenRect,
    *,
    sensitivity: float = 1.0,
    acceleration: float = 1.0,
    dead_zone: float = 0.0,
    prev_uv: tuple[float, float] | None = None,
) -> tuple[int, int, tuple[float, float]]:
    """Convert UV to pixel. Optional accel amplifies delta above dead_zone."""
    u = clamp01(u)
    v = clamp01(v)
    if prev_uv is not None and (dead_zone > 0 or acceleration != 1.0 or sensitivity != 1.0):
        du = u - prev_uv[0]
        dv = v - prev_uv[1]
        mag = (du * du + dv * dv) ** 0.5
        if mag < dead_zone:
            u, v = prev_uv
        else:
            gain = sensitivity * (acceleration if mag > dead_zone * 3 else 1.0)
            u = clamp01(prev_uv[0] + du * gain)
            v = clamp01(prev_uv[1] + dv * gain)
    x = int(round(screen.x + u * (screen.width - 1)))
    y = int(round(screen.y + v * (screen.height - 1)))
    return x, y, (u, v)


def landmark_to_screen(
    nx: float,
    ny: float,
    cal: Calibration,
    screen: ScreenRect,
    **kwargs,
) -> tuple[int, int, tuple[float, float]]:
    u, v = apply_calibration(nx, ny, cal)
    return uv_to_screen(u, v, screen, **kwargs)
