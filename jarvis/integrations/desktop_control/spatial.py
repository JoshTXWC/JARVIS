"""Spatial Mode — window targeting, move, resize, app switching."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

from .coords import ScreenRect, landmark_to_screen
from .gestures import (
    CircleTracker,
    SwipeTracker,
    TemporalGate,
    both_hands_open,
    classify_pose,
    dist,
    tip,
)
from .input_backend import InputBackend
from .settings import DesktopControlSettings
from .windows_win import WindowBackend, WindowInfo


@dataclass
class SpatialEngine:
    settings: DesktopControlSettings
    input: InputBackend
    windows: WindowBackend
    selected: WindowInfo | None = None
    grabbing: bool = False
    _grab_origin_hand: tuple[float, float] | None = None
    _grab_origin_rect: ScreenRect | None = None
    _resize_base_dist: float | None = None
    _resize_base_rect: ScreenRect | None = None
    _swipe: SwipeTracker = field(init=False)
    _circle: CircleTracker = field(default_factory=CircleTracker)
    _menu_gate: TemporalGate = field(init=False)
    _pinch_since: float | None = None
    paused: bool = False
    last_status: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        s = self.settings
        self._swipe = SwipeTracker(
            min_dx=s.swipe_min_dx,
            min_dy=s.swipe_min_dy,
            cooldown_ms=s.spatial_cooldown_ms,
        )
        self._menu_gate = TemporalGate(500, s.spatial_cooldown_ms)

    def reconfigure(self, settings: DesktopControlSettings) -> None:
        self.settings = settings
        self.__post_init__()

    def cancel(self) -> None:
        self.grabbing = False
        self._grab_origin_hand = None
        self._grab_origin_rect = None
        self._resize_base_dist = None
        self._resize_base_rect = None
        self._pinch_since = None
        self._swipe.reset()
        self._circle.reset()
        self._menu_gate.reset()

    def emergency_stop(self) -> None:
        self.paused = True
        self.cancel()
        self.last_status = {"gesture": "emergency_stop", "paused": True}

    def set_paused(self, paused: bool) -> None:
        if paused:
            self.cancel()
        self.paused = paused

    def _screen(self) -> ScreenRect:
        if self.settings.monitor_policy == "primary":
            return self.windows.primary_screen()
        return self.windows.virtual_screen()

    def _hand_to_px(self, nx: float, ny: float) -> tuple[int, int]:
        x, y, _ = landmark_to_screen(
            nx, ny, self.settings.calibration, self._screen(),
            sensitivity=1.0, acceleration=1.0, dead_zone=0.0,
        )
        return x, y

    def _edge_snap(self, rect: ScreenRect, x: int, y: int) -> ScreenRect:
        screen = self._screen()
        margin = 48
        half_w = screen.width // 2
        # Left / right snap
        if x <= screen.x + margin:
            return ScreenRect(screen.x, screen.y, half_w, screen.height)
        if x >= screen.x2 - margin:
            return ScreenRect(screen.x + half_w, screen.y, half_w, screen.height)
        # Top maximize
        if y <= screen.y + margin:
            return ScreenRect(screen.x, screen.y, screen.width, screen.height)
        return rect

    def process(
        self,
        hand1: Sequence[Sequence[float]] | None,
        hand2: Sequence[Sequence[float]] | None,
        now_ms: float,
    ) -> dict[str, Any]:
        if self.paused:
            self.last_status = {"gesture": "paused", "paused": True}
            return self.last_status
        if hand1 is None:
            self.cancel()
            self.last_status = {"gesture": "lost", "tracking": False}
            return self.last_status

        pose1 = classify_pose(hand1, self.settings.pinch_threshold)
        poses = [pose1]
        if hand2 is not None:
            poses.append(classify_pose(hand2, self.settings.pinch_threshold))

        p1 = tip(hand1, 8)
        px, py = self._hand_to_px(p1[0], p1[1])
        gesture = "none"
        jarvis_action = None

        # Both open palms held → JARVIS command menu
        if self._menu_gate.update(both_hands_open(poses), now_ms):
            gesture = "jarvis_menu"
            jarvis_action = "open_command_palette"

        # Two-hand resize on selected window
        if hand2 is not None and self.selected is not None and not self.grabbing:
            p2 = tip(hand2, 8)
            d = dist(p1, p2)
            if self._resize_base_dist is None:
                if d > 0.08:
                    self._resize_base_dist = d
                    self._resize_base_rect = self.selected.rect
            elif self._resize_base_rect is not None and self._resize_base_dist > 1e-6:
                factor = max(0.5, min(2.2, (d / self._resize_base_dist) * self.settings.resize_scale_gain))
                br = self._resize_base_rect
                cx = br.x + br.width / 2
                cy = br.y + br.height / 2
                nw = max(200, int(br.width * factor))
                nh = max(160, int(br.height * factor))
                nx = int(cx - nw / 2)
                ny = int(cy - nh / 2)
                self.windows.move_resize(self.selected.hwnd, nx, ny, nw, nh)
                self.selected = WindowInfo(self.selected.hwnd, self.selected.title, ScreenRect(nx, ny, nw, nh))
                gesture = "resize"
        else:
            self._resize_base_dist = None
            self._resize_base_rect = None

        # Open palm → target window under hand
        if pose1 == "open" and not self.grabbing and hand2 is None:
            hit = self.windows.window_from_point(px, py)
            if hit and hit.title:
                self.selected = hit
                gesture = "target"

        # Pinch + drag → move selected window
        if pose1 == "pinch" and self.selected is not None:
            if self._pinch_since is None:
                self._pinch_since = now_ms
            if (now_ms - self._pinch_since) >= self.settings.grab_pinch_ms:
                if not self.grabbing:
                    self.grabbing = True
                    self._grab_origin_hand = p1
                    self._grab_origin_rect = self.selected.rect
                    gesture = "grab"
                elif self._grab_origin_hand and self._grab_origin_rect:
                    screen = self._screen()
                    du = p1[0] - self._grab_origin_hand[0]
                    dv = p1[1] - self._grab_origin_hand[1]
                    # Mirror X like calibration
                    dx = int(-du * screen.width)
                    dy = int(dv * screen.height)
                    r = self._grab_origin_rect
                    nx, ny = r.x + dx, r.y + dy
                    snapped = self._edge_snap(ScreenRect(nx, ny, r.width, r.height), px, py)
                    self.windows.move_resize(
                        self.selected.hwnd, snapped.x, snapped.y, snapped.width, snapped.height
                    )
                    self.selected = WindowInfo(
                        self.selected.hwnd, self.selected.title, snapped
                    )
                    gesture = "move"
        else:
            if self.grabbing:
                gesture = "drop"
            self.grabbing = False
            self._pinch_since = None
            self._grab_origin_hand = None
            self._grab_origin_rect = None

        # Swipes (open hand, not grabbing)
        if pose1 == "open" and not self.grabbing:
            swipe = self._swipe.update(p1, now_ms)
            if swipe != "none":
                gesture = swipe
                if swipe == "swipe_left":
                    self.input.key_combo("alt", "shift", "tab")
                elif swipe == "swipe_right":
                    self.input.key_combo("alt", "tab")
                elif swipe == "swipe_up":
                    self.input.key_combo("win", "tab")
                elif swipe == "swipe_down":
                    self.input.key_combo("win", "d")

        # Circle → Windows Search
        if pose1 == "open" and self._circle.update(p1, now_ms):
            gesture = "circle"
            self.input.key_combo("win", "s")

        self.last_status = {
            "gesture": gesture,
            "pose": pose1,
            "x": px,
            "y": py,
            "selected": self.selected.title if self.selected else None,
            "hwnd": self.selected.hwnd if self.selected else None,
            "jarvis_action": jarvis_action,
            "paused": self.paused,
            "tracking": True,
        }
        return self.last_status
