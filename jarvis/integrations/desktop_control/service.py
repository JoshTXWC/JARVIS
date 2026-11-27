"""Desktop control service — mode routing, auth gates, persistence."""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any, Sequence

from .actions import sanitize_jarvis_action
from .input_backend import InputBackend, MockInput, create_input_backend
from .precision import PrecisionEngine
from .settings import DesktopControlSettings, SettingsStore
from .spatial import SpatialEngine
from .windows_win import WindowBackend, create_window_backend

_lock = threading.Lock()
_INSTANCE: "DesktopControlService | None" = None


class DesktopControlService:
    def __init__(
        self,
        store: SettingsStore,
        input_backend: InputBackend | None = None,
        window_backend: WindowBackend | None = None,
    ) -> None:
        self.store = store
        self.input = input_backend or create_input_backend()
        self.windows = window_backend or create_window_backend()
        self.precision = PrecisionEngine(store.get(), self.input, self.windows)
        self.spatial = SpatialEngine(store.get(), self.input, self.windows)
        self._frame_lock = threading.Lock()
        self._last_client_ts = 0.0

    @property
    def settings(self) -> DesktopControlSettings:
        return self.store.get()

    def status(self) -> dict[str, Any]:
        s = self.settings
        eng = self.precision if s.mode == "precision" else self.spatial
        st = getattr(eng, "last_status", {}) or {}
        return {
            "ok": True,
            "enabled": s.enabled,
            "mode": s.mode,
            "overlay_enabled": s.overlay_enabled,
            "viz_mode": s.viz_mode,
            "paused": bool(st.get("paused") or getattr(eng, "paused", False)),
            "frozen": bool(getattr(self.precision, "frozen", False)),
            "gesture": st.get("gesture"),
            "tracking": st.get("tracking"),
            "selected": st.get("selected"),
            "camera_active": bool(s.enabled and s.mode in {"precision", "spatial", "hud"}),
            "platform_input": type(self.input).__name__,
            "settings": s.to_dict(),
        }

    def update_settings(self, patch: dict[str, Any]) -> dict[str, Any]:
        # Never allow enabling via accidental empty patch; require explicit bool.
        s = self.store.update(patch)
        self.precision.reconfigure(s)
        self.spatial.reconfigure(s)
        if not s.enabled or s.mode == "hud":
            self.release()
        return self.status()

    def set_mode(self, mode: str) -> dict[str, Any]:
        if mode not in {"hud", "precision", "spatial"}:
            raise ValueError(f"invalid mode: {mode}")
        self.release()
        return self.update_settings({"mode": mode})

    def set_enabled(self, enabled: bool) -> dict[str, Any]:
        if not enabled:
            self.release()
        return self.update_settings({"enabled": bool(enabled)})

    def set_paused(self, paused: bool) -> dict[str, Any]:
        self.precision.set_paused(paused)
        self.spatial.set_paused(paused)
        return self.status()

    def release(self) -> None:
        self.precision.cancel()
        self.spatial.cancel()
        self.input.release_all()

    def emergency_stop(self) -> dict[str, Any]:
        self.precision.emergency_stop()
        self.spatial.emergency_stop()
        self.input.release_all()
        # Keep enabled flag but pause injection — user must resume deliberately.
        return self.status()

    def ingest_frame(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Process a landmark frame from the shared MediaPipe pipeline.

        Expected payload:
          {
            "t": ms,
            "hands": [ [ [x,y,z], ...21 ], ... ],  # 0–2 hands
            "lost": bool
          }
        """
        s = self.settings
        if not s.enabled:
            return {"ok": False, "error": "desktop_control_disabled", "enabled": False}
        if s.mode == "hud":
            return {"ok": True, "mode": "hud", "injected": False}

        with self._frame_lock:
            self._last_client_ts = time.time()
            now_ms = float(payload.get("t") or (time.time() * 1000))
            lost = bool(payload.get("lost"))
            hands = payload.get("hands") or []
            h1 = hands[0] if hands and not lost else None
            h2 = hands[1] if len(hands) > 1 and not lost else None

            if s.mode == "precision":
                # Pause spatial completely
                result = self.precision.process(h1, now_ms)
            else:
                result = self.spatial.process(h1, h2, now_ms)

            action = sanitize_jarvis_action(result.get("jarvis_action"))
            out = {
                "ok": True,
                "mode": s.mode,
                "injected": True,
                "status": result,
                "jarvis_action": action,
            }
            return out


def get_desktop_control(data_dir: Path | None = None) -> DesktopControlService:
    global _INSTANCE
    with _lock:
        if _INSTANCE is None:
            root = data_dir or Path("data")
            store = SettingsStore(root / "desktop_control.json")
            _INSTANCE = DesktopControlService(store)
        return _INSTANCE


def reset_desktop_control(
    *,
    data_dir: Path | None = None,
    input_backend: InputBackend | None = None,
    window_backend: WindowBackend | None = None,
) -> DesktopControlService:
    """Test helper — rebuild singleton with mocks."""
    global _INSTANCE
    with _lock:
        root = data_dir or Path("data")
        store = SettingsStore(root / "desktop_control.json")
        _INSTANCE = DesktopControlService(
            store,
            input_backend=input_backend or MockInput(),
            window_backend=window_backend,
        )
        return _INSTANCE
