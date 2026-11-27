"""Precision Mode — map hand landmarks to system mouse."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from .coords import ScreenRect, landmark_to_screen
from .gestures import PrecisionClassifier
from .input_backend import InputBackend
from .settings import DesktopControlSettings
from .windows_win import WindowBackend


@dataclass
class PrecisionEngine:
    settings: DesktopControlSettings
    input: InputBackend
    windows: WindowBackend
    classifier: PrecisionClassifier = field(init=False)
    frozen: bool = False
    paused: bool = False
    _smooth_uv: tuple[float, float] | None = None
    _prev_uv: tuple[float, float] | None = None
    last_status: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        s = self.settings
        self.classifier = PrecisionClassifier(
            pinch_threshold=s.pinch_threshold,
            pinch_hold_ms=s.pinch_hold_ms,
            click_debounce_ms=s.click_debounce_ms,
            scroll_threshold=s.scroll_threshold,
            open_palm_freeze_ms=s.open_palm_freeze_ms,
            fist_pause_ms=s.fist_pause_ms,
        )

    def reconfigure(self, settings: DesktopControlSettings) -> None:
        self.settings = settings
        self.__post_init__()

    def _screen(self) -> ScreenRect:
        if self.settings.monitor_policy == "primary":
            return self.windows.primary_screen()
        return self.windows.virtual_screen()

    def cancel(self) -> None:
        self.input.release_all()
        self.classifier.on_tracking_lost()
        self._smooth_uv = None
        self._prev_uv = None

    def emergency_stop(self) -> None:
        self.paused = True
        self.frozen = False
        self.cancel()
        self.last_status = {"gesture": "emergency_stop", "paused": True}

    def set_paused(self, paused: bool) -> None:
        if paused:
            self.cancel()
        self.paused = paused

    def _smooth(self, u: float, v: float) -> tuple[float, float]:
        a = max(0.0, min(1.0, 1.0 - self.settings.smoothing))
        if self._smooth_uv is None or a >= 0.999:
            self._smooth_uv = (u, v)
            return u, v
        su = self._smooth_uv[0] + (u - self._smooth_uv[0]) * a
        sv = self._smooth_uv[1] + (v - self._smooth_uv[1]) * a
        self._smooth_uv = (su, sv)
        return su, sv

    def process(
        self,
        landmarks: Sequence[Sequence[float]] | None,
        now_ms: float,
    ) -> dict[str, Any]:
        if self.paused:
            self.last_status = {"gesture": "paused", "paused": True}
            return self.last_status

        if landmarks is None:
            ev = self.classifier.on_tracking_lost()
            if ev == "drag_end":
                self.input.mouse_up("left")
            self._smooth_uv = None
            self.last_status = {"gesture": "lost", "tracking": False}
            return self.last_status

        tip = landmarks[8]
        nx, ny = float(tip[0]), float(tip[1])
        screen = self._screen()
        x, y, uv = landmark_to_screen(
            nx,
            ny,
            self.settings.calibration,
            screen,
            sensitivity=self.settings.sensitivity,
            acceleration=self.settings.acceleration,
            dead_zone=self.settings.dead_zone,
            prev_uv=self._prev_uv,
        )
        u, v = self._smooth(uv[0], uv[1])
        self._prev_uv = (u, v)
        x = int(round(screen.x + u * (screen.width - 1)))
        y = int(round(screen.y + v * (screen.height - 1)))

        if not self.frozen:
            self.input.move_to(x, y)

        ev, meta = self.classifier.update(landmarks, now_ms)
        gesture = ev

        if ev == "pause":
            self.set_paused(True)
        elif ev == "freeze_toggle":
            self.frozen = not self.frozen
        elif ev == "drag_start":
            self.input.mouse_down("left")
        elif ev == "drag_move":
            pass
        elif ev == "drag_end":
            self.input.mouse_up("left")
        elif ev == "right_click":
            self.input.click("right")
        elif ev == "scroll":
            dy = float(meta.get("scroll_dy") or 0)
            ticks = int(round(dy / max(self.settings.scroll_threshold, 1e-6) * self.settings.scroll_speed))
            if ticks:
                self.input.scroll(ticks)

        self.last_status = {
            "gesture": gesture,
            "pose": meta.get("pose"),
            "x": x,
            "y": y,
            "frozen": self.frozen,
            "paused": self.paused,
            "tracking": True,
        }
        return self.last_status
