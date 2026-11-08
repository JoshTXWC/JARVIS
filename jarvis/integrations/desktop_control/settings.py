"""Persisted desktop-control settings (local JSON, opt-in defaults)."""
from __future__ import annotations

import json
import threading
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Literal

Mode = Literal["hud", "precision", "spatial"]
VizMode = Literal["skeleton", "minimal", "hidden"]
PrimaryHand = Literal["right", "left"]


@dataclass
class Calibration:
    """Normalized active tracking region inside the camera frame (0–1)."""
    x0: float = 0.15
    y0: float = 0.10
    x1: float = 0.85
    y1: float = 0.90


@dataclass
class DesktopControlSettings:
    # Master — disabled by default (safety).
    enabled: bool = False
    mode: Mode = "hud"
    overlay_enabled: bool = True
    viz_mode: VizMode = "skeleton"
    overlay_opacity: float = 0.85
    primary_hand: PrimaryHand = "right"
    camera_device_id: str = ""

    # Precision tuning
    sensitivity: float = 1.0
    smoothing: float = 0.35
    acceleration: float = 1.15
    dead_zone: float = 0.004
    pinch_threshold: float = 0.05
    pinch_hold_ms: int = 40
    click_debounce_ms: int = 180
    scroll_speed: float = 1.0
    scroll_threshold: float = 0.018
    open_palm_freeze_ms: int = 450
    fist_pause_ms: int = 400
    confidence_min: float = 0.45

    # Spatial tuning
    spatial_cooldown_ms: int = 700
    swipe_min_dx: float = 0.18
    swipe_min_dy: float = 0.16
    resize_scale_gain: float = 1.0
    grab_pinch_ms: int = 80

    # Multi-monitor: "virtual" = full virtual desktop; "primary" = primary only
    monitor_policy: Literal["virtual", "primary"] = "virtual"

    # Shortcuts (Electron registers these; stored for Settings UI)
    emergency_stop_accel: str = "Control+Shift+Alt+Escape"
    mode_cycle_accel: str = "Control+Shift+Alt+M"
    pause_accel: str = "Control+Shift+Alt+P"

    calibration: Calibration = field(default_factory=Calibration)

    # Allow-listed JARVIS UI actions gesture maps may invoke
    jarvis_action_map: dict[str, str] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        return d

    @classmethod
    def from_dict(cls, raw: dict[str, Any] | None) -> "DesktopControlSettings":
        if not raw:
            return cls()
        data = dict(raw)
        cal = data.pop("calibration", None)
        settings = cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})
        if isinstance(cal, dict):
            settings.calibration = Calibration(**{
                k: v for k, v in cal.items() if k in Calibration.__dataclass_fields__
            })
        return settings


class SettingsStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._settings = DesktopControlSettings()
        self.load()

    def load(self) -> DesktopControlSettings:
        with self._lock:
            if self.path.exists():
                try:
                    raw = json.loads(self.path.read_text(encoding="utf-8"))
                    self._settings = DesktopControlSettings.from_dict(raw)
                except Exception:  # noqa: BLE001
                    self._settings = DesktopControlSettings()
            return self._settings

    def get(self) -> DesktopControlSettings:
        with self._lock:
            return self._settings

    def update(self, patch: dict[str, Any]) -> DesktopControlSettings:
        with self._lock:
            cur = self._settings.to_dict()
            if "calibration" in patch and isinstance(patch["calibration"], dict):
                cal = {**cur.get("calibration", {}), **patch.pop("calibration")}
                patch = {**patch, "calibration": cal}
            cur.update(patch)
            self._settings = DesktopControlSettings.from_dict(cur)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self.path.write_text(
                json.dumps(self._settings.to_dict(), indent=2) + "\n",
                encoding="utf-8",
            )
            return self._settings

    def replace(self, settings: DesktopControlSettings) -> DesktopControlSettings:
        return self.update(settings.to_dict())
