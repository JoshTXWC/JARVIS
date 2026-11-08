"""Frame-level and temporal gesture classification (no OS side effects)."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal, Sequence

Pt = tuple[float, float]
Landmark = Sequence[float]  # x, y[, z]

HandPose = Literal["pinch", "fist", "open", "two_finger", "unknown"]
GestureEvent = Literal[
    "none",
    "click",
    "right_click",
    "drag_start",
    "drag_move",
    "drag_end",
    "scroll",
    "freeze_toggle",
    "pause",
    "swipe_left",
    "swipe_right",
    "swipe_up",
    "swipe_down",
    "resize",
    "circle",
    "jarvis_menu",
]


def dist(a: Pt, b: Pt) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def tip(landmarks: Sequence[Landmark], idx: int = 8) -> Pt:
    p = landmarks[idx]
    return (float(p[0]), float(p[1]))


def is_finger_folded(landmarks: Sequence[Landmark], tip_idx: int, mcp_idx: int) -> bool:
    t = tip(landmarks, tip_idx)
    m = tip(landmarks, mcp_idx)
    w = tip(landmarks, 0)
    return dist(t, w) < dist(m, w)


def classify_pose(landmarks: Sequence[Landmark], pinch_threshold: float = 0.05) -> HandPose:
    if len(landmarks) < 21:
        return "unknown"
    pinch = dist(tip(landmarks, 8), tip(landmarks, 4)) < pinch_threshold
    if pinch:
        return "pinch"
    index_up = not is_finger_folded(landmarks, 8, 5)
    middle_up = not is_finger_folded(landmarks, 12, 9)
    ring_fold = is_finger_folded(landmarks, 16, 13)
    pinky_fold = is_finger_folded(landmarks, 20, 17)
    if index_up and middle_up and ring_fold and pinky_fold:
        return "two_finger"
    fist = (
        is_finger_folded(landmarks, 8, 5)
        and is_finger_folded(landmarks, 12, 9)
        and is_finger_folded(landmarks, 16, 13)
        and is_finger_folded(landmarks, 20, 17)
    )
    if fist:
        return "fist"
    return "open"


def both_hands_open(poses: Sequence[HandPose]) -> bool:
    return len(poses) >= 2 and all(p == "open" for p in poses[:2])


@dataclass
class TemporalGate:
    """Require a pose to be held for hold_ms before firing; then cooldown."""
    hold_ms: int
    cooldown_ms: int
    _since: float | None = None
    _last_fire: float | None = None
    _fired: bool = False

    def reset(self) -> None:
        self._since = None
        self._fired = False

    def update(self, active: bool, now_ms: float) -> bool:
        if not active:
            self._since = None
            self._fired = False
            return False
        if self._since is None:
            self._since = now_ms
        if self._last_fire is not None and (now_ms - self._last_fire) < self.cooldown_ms:
            return False
        if not self._fired and (now_ms - self._since) >= self.hold_ms:
            self._fired = True
            self._last_fire = now_ms
            return True
        return False


@dataclass
class SwipeTracker:
    min_dx: float = 0.18
    min_dy: float = 0.16
    window_ms: int = 320
    cooldown_ms: int = 700
    _origin: Pt | None = None
    _t0: float = 0.0
    _last: float = 0.0

    def reset(self) -> None:
        self._origin = None

    def update(self, pos: Pt | None, now_ms: float) -> GestureEvent:
        if pos is None:
            self._origin = None
            return "none"
        if self._origin is None:
            self._origin = pos
            self._t0 = now_ms
            return "none"
        if now_ms - self._last < self.cooldown_ms:
            return "none"
        if now_ms - self._t0 > self.window_ms:
            self._origin = pos
            self._t0 = now_ms
            return "none"
        dx = pos[0] - self._origin[0]
        dy = pos[1] - self._origin[1]
        if abs(dx) >= self.min_dx and abs(dx) > abs(dy):
            self._last = now_ms
            self._origin = pos
            self._t0 = now_ms
            return "swipe_right" if dx > 0 else "swipe_left"
        if abs(dy) >= self.min_dy and abs(dy) > abs(dx):
            self._last = now_ms
            self._origin = pos
            self._t0 = now_ms
            return "swipe_down" if dy > 0 else "swipe_up"
        return "none"


@dataclass
class CircleTracker:
    """Accumulate heading changes; fire when absolute turn exceeds ~2π."""
    min_step: float = 0.008
    turn_target: float = 5.5
    cooldown_ms: int = 1200
    _prev: Pt | None = None
    _heading: float | None = None
    _acc: float = 0.0
    _last: float = 0.0

    def reset(self) -> None:
        self._prev = None
        self._heading = None
        self._acc = 0.0

    def update(self, pos: Pt | None, now_ms: float) -> bool:
        if pos is None:
            self.reset()
            return False
        if now_ms - self._last < self.cooldown_ms:
            return False
        if self._prev is None:
            self._prev = pos
            return False
        dx = pos[0] - self._prev[0]
        dy = pos[1] - self._prev[1]
        self._prev = pos
        step = math.hypot(dx, dy)
        if step < self.min_step:
            return False
        heading = math.atan2(dy, dx)
        if self._heading is None:
            self._heading = heading
            return False
        d = heading - self._heading
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        self._heading = heading
        self._acc += d
        if abs(self._acc) >= self.turn_target:
            self._acc = 0.0
            self._last = now_ms
            return True
        return False


@dataclass
class ClickDebouncer:
    debounce_ms: int = 180
    _last: float = 0.0

    def allow(self, now_ms: float) -> bool:
        if now_ms - self._last < self.debounce_ms:
            return False
        self._last = now_ms
        return True


@dataclass
class PrecisionClassifier:
    """Mouse-replacement state machine.

    Pinch down (after hold) → drag_start (mouse down).
    Pinch held → drag_move.
    Pinch up → drag_end (mouse up). Short press still clicks for most apps.
    Two-finger vertical motion → scroll; brief two-finger without scroll → right_click.
    Open palm held → freeze_toggle. Fist held → pause.
    Tracking loss while dragging → drag_end.
    """

    pinch_threshold: float = 0.05
    pinch_hold_ms: int = 40
    click_debounce_ms: int = 180
    scroll_threshold: float = 0.018
    open_palm_freeze_ms: int = 450
    fist_pause_ms: int = 400
    drag_promote_px: float = 0.012  # normalized movement to prefer drag over tap

    _pinch_since: float | None = None
    _pinching: bool = False
    _dragging: bool = False
    _drag_origin: Pt | None = None
    _click: ClickDebouncer = field(default_factory=ClickDebouncer)
    _freeze_gate: TemporalGate = field(init=False)
    _pause_gate: TemporalGate = field(init=False)
    _scroll_anchor_y: float | None = None
    _two_finger_since: float | None = None
    _two_finger_scrolled: bool = False

    def __post_init__(self) -> None:
        self._click = ClickDebouncer(self.click_debounce_ms)
        self._freeze_gate = TemporalGate(self.open_palm_freeze_ms, 800)
        self._pause_gate = TemporalGate(self.fist_pause_ms, 600)

    def reset(self) -> None:
        was = self._dragging
        self._pinch_since = None
        self._pinching = False
        self._dragging = False
        self._drag_origin = None
        self._scroll_anchor_y = None
        self._two_finger_since = None
        self._two_finger_scrolled = False
        self._freeze_gate.reset()
        self._pause_gate.reset()
        return was  # type: ignore[return-value]

    def on_tracking_lost(self) -> GestureEvent:
        if self._dragging:
            self._dragging = False
            self._pinching = False
            self._pinch_since = None
            self._drag_origin = None
            return "drag_end"
        self.reset()
        return "none"

    def update(
        self,
        landmarks: Sequence[Landmark] | None,
        now_ms: float,
    ) -> tuple[GestureEvent, dict]:
        meta: dict = {"scroll_dy": 0.0, "pos": None, "pose": "unknown"}
        if landmarks is None:
            ev = self.on_tracking_lost()
            return ev, meta

        pose = classify_pose(landmarks, self.pinch_threshold)
        pos = tip(landmarks, 8)
        meta["pos"] = pos
        meta["pose"] = pose

        if self._pause_gate.update(pose == "fist" and not self._dragging, now_ms):
            return "pause", meta

        if self._freeze_gate.update(pose == "open" and not self._dragging, now_ms):
            return "freeze_toggle", meta

        # Two-finger: scroll or right-click
        if pose == "two_finger":
            if self._dragging:
                self._dragging = False
                self._pinching = False
                return "drag_end", meta
            if self._two_finger_since is None:
                self._two_finger_since = now_ms
                self._scroll_anchor_y = pos[1]
                self._two_finger_scrolled = False
                return "none", meta
            assert self._scroll_anchor_y is not None
            dy = pos[1] - self._scroll_anchor_y
            if abs(dy) >= self.scroll_threshold:
                meta["scroll_dy"] = dy
                self._scroll_anchor_y = pos[1]
                self._two_finger_scrolled = True
                return "scroll", meta
            return "none", meta

        if self._two_finger_since is not None:
            duration = now_ms - self._two_finger_since
            scrolled = self._two_finger_scrolled
            self._two_finger_since = None
            self._scroll_anchor_y = None
            self._two_finger_scrolled = False
            if not scrolled and duration < 280 and self._click.allow(now_ms):
                return "right_click", meta

        pinching = pose == "pinch"
        if pinching:
            if self._pinch_since is None:
                self._pinch_since = now_ms
            if not self._pinching and (now_ms - self._pinch_since) >= self.pinch_hold_ms:
                self._pinching = True
                self._dragging = True
                self._drag_origin = pos
                return "drag_start", meta
            if self._dragging:
                return "drag_move", meta
            return "none", meta

        # Pinch released
        if self._dragging:
            self._dragging = False
            self._pinching = False
            self._pinch_since = None
            origin = self._drag_origin
            self._drag_origin = None
            # Tiny movement → treat as click (down+up already via drag_start/end)
            if origin and dist(origin, pos) < self.drag_promote_px:
                meta["tap"] = True
            return "drag_end", meta

        self._pinch_since = None
        self._pinching = False
        return "none", meta
