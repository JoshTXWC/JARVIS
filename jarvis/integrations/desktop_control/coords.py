"""Map normalized hand landmarks through separated coordinate spaces.

Spaces:
  camera  — MediaPipe normalized landmarks
  control — calibrated normalized cursor region (mirrored once)
  desktop — Windows virtual-desktop pixels (may be negative)
"""
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


def clamp(v: float, lo: float, hi: float) -> float:
    return lo if v < lo else hi if v > hi else v


def mirror_camera_x(nx: float) -> float:
    return 1.0 - clamp01(nx)


def edge_proximity(nx: float, ny: float, margin: float = 0.08) -> float:
    mx = min(nx, 1.0 - nx)
    my = min(ny, 1.0 - ny)
    m = min(mx, my)
    if m >= margin:
        return 0.0
    return clamp01(1.0 - m / margin)


def apply_calibration(
    nx: float,
    ny: float,
    cal: Calibration,
    *,
    sens_x: float = 1.0,
    sens_y: float = 1.0,
    edge_compress: float = 0.0,
) -> tuple[float, float]:
    """Camera → control UV. Mirrors X once; never use for preview drawing."""
    x = mirror_camera_x(nx)
    y = clamp01(ny)
    w = max(1e-6, cal.x1 - cal.x0)
    h = max(1e-6, cal.y1 - cal.y0)
    u = clamp01((x - cal.x0) / w)
    v = clamp01((y - cal.y0) / h)

    if sens_x != 1.0:
        u = clamp01(0.5 + (u - 0.5) * sens_x)
    if sens_y != 1.0:
        v = clamp01(0.5 + (v - 0.5) * sens_y)

    if edge_compress > 0:
        c = clamp01(edge_compress)

        def ease(t: float) -> float:
            s = t * 2.0 - 1.0
            shaped = (1.0 if s >= 0 else -1.0) * (abs(s) ** (1.0 - c * 0.35))
            return shaped * 0.5 + 0.5

        u = ease(u)
        v = ease(v)

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
    """Control UV → desktop pixels. Supports negative monitor origins."""
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
    max_x = screen.x + max(0, screen.width - 1)
    max_y = screen.y + max(0, screen.height - 1)
    x = int(round(clamp(screen.x + u * max(0, screen.width - 1), float(screen.x), float(max_x))))
    y = int(round(clamp(screen.y + v * max(0, screen.height - 1), float(screen.y), float(max_y))))
    return x, y, (u, v)


def landmark_to_screen(
    nx: float,
    ny: float,
    cal: Calibration,
    screen: ScreenRect,
    **kwargs,
) -> tuple[int, int, tuple[float, float]]:
    sens_x = float(kwargs.pop("sens_x", 1.0))
    sens_y = float(kwargs.pop("sens_y", 1.0))
    edge_compress = float(kwargs.pop("edge_compress", 0.0))
    u, v = apply_calibration(
        nx, ny, cal, sens_x=sens_x, sens_y=sens_y, edge_compress=edge_compress,
    )
    return uv_to_screen(u, v, screen, **kwargs)


@dataclass
class OneEuroParams:
    min_cutoff: float = 1.2
    beta: float = 0.035
    d_cutoff: float = 1.0
    dead_zone: float = 0.0005
    max_jump: float = 0.25


class OneEuroFilter1D:
    def __init__(self, params: OneEuroParams | None = None) -> None:
        self.params = params or OneEuroParams()
        self._hat_x: float | None = None
        self._hat_dx: float | None = None
        self._last_t: float | None = None
        self._last_x: float | None = None

    def reset(self, seed: float | None = None) -> None:
        self._hat_x = seed
        self._hat_dx = None
        self._last_t = None
        self._last_x = seed

    @staticmethod
    def _alpha(te: float, cutoff: float) -> float:
        r = 2.0 * 3.141592653589793 * cutoff * te
        return r / (r + 1.0)

    def filter(self, x: float, timestamp_ms: float) -> float:
        p = self.params
        if self._last_t is None or self._last_x is None:
            self._last_t = timestamp_ms
            self._last_x = x
            self._hat_x = x
            self._hat_dx = 0.0
            return x

        te = (timestamp_ms - self._last_t) / 1000.0
        if te <= 0 or te > 0.5:
            self.reset(x)
            self._last_t = timestamp_ms
            return x
        te = max(te, 1.0 / 240.0)

        jump = abs(x - self._last_x)
        if jump > p.max_jump:
            self.reset(x)
            self._last_t = timestamp_ms
            return x

        dx = (x - self._last_x) / te
        a_d = self._alpha(te, p.d_cutoff)
        if self._hat_dx is None:
            self._hat_dx = dx
        else:
            self._hat_dx = a_d * dx + (1.0 - a_d) * self._hat_dx

        cutoff = p.min_cutoff + p.beta * abs(self._hat_dx)
        a_x = self._alpha(te, cutoff)
        assert self._hat_x is not None
        filtered = a_x * x + (1.0 - a_x) * self._hat_x
        if abs(filtered - self._last_x) < p.dead_zone and abs(self._hat_dx) < p.dead_zone * 60:
            filtered = self._last_x
        self._hat_x = filtered
        self._last_t = timestamp_ms
        self._last_x = filtered
        return filtered


class OneEuroFilter2D:
    def __init__(self, params: OneEuroParams | None = None) -> None:
        p = params or OneEuroParams()
        self.fx = OneEuroFilter1D(p)
        self.fy = OneEuroFilter1D(OneEuroParams(**p.__dict__))

    def reset(self, seed: tuple[float, float] | None = None) -> None:
        self.fx.reset(None if seed is None else seed[0])
        self.fy.reset(None if seed is None else seed[1])

    def filter(self, x: float, y: float, timestamp_ms: float) -> tuple[float, float]:
        return self.fx.filter(x, timestamp_ms), self.fy.filter(y, timestamp_ms)
