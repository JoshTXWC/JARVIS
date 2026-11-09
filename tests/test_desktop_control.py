"""Barehands 2.0 desktop-control unit tests (mocked Win32 input)."""
from __future__ import annotations

from pathlib import Path

import pytest

from jarvis.integrations.desktop_control.actions import (
    ALLOWED_JARVIS_ACTIONS,
    sanitize_jarvis_action,
)
from jarvis.integrations.desktop_control.coords import (
    Calibration,
    OneEuroFilter2D,
    OneEuroParams,
    ScreenRect,
    apply_calibration,
    edge_proximity,
    landmark_to_screen,
    uv_to_screen,
)
from jarvis.integrations.desktop_control.gestures import (
    CircleTracker,
    PrecisionClassifier,
    SwipeTracker,
    TemporalGate,
    classify_pose,
    tip,
)
from jarvis.integrations.desktop_control.input_backend import MockInput
from jarvis.integrations.desktop_control.precision import PrecisionEngine
from jarvis.integrations.desktop_control.service import DesktopControlService
from jarvis.integrations.desktop_control.settings import (
    DesktopControlSettings,
    SettingsStore,
)
from jarvis.integrations.desktop_control.spatial import SpatialEngine
from jarvis.integrations.desktop_control.windows_win import MockWindow, WindowInfo


def _open_hand():
    # 21 landmarks; tips far from wrist, thumb tip far from index tip
    pts = [[0.5, 0.8, 0.0] for _ in range(21)]
    pts[0] = [0.5, 0.9, 0.0]  # wrist
    for tip_i, mcp_i, y in ((8, 5, 0.3), (12, 9, 0.32), (16, 13, 0.34), (20, 17, 0.36)):
        pts[mcp_i] = [0.5, 0.6, 0.0]
        pts[tip_i] = [0.5, y, 0.0]
    pts[4] = [0.35, 0.5, 0.0]  # thumb tip away
    return pts


def _pinch_hand():
    pts = _open_hand()
    pts[4] = [0.50, 0.30, 0.0]
    pts[8] = [0.51, 0.31, 0.0]
    return pts


def _fist_hand():
    pts = [[0.5, 0.7, 0.0] for _ in range(21)]
    pts[0] = [0.5, 0.8, 0.0]
    for tip_i, mcp_i in ((8, 5), (12, 9), (16, 13), (20, 17)):
        pts[mcp_i] = [0.5, 0.65, 0.0]
        pts[tip_i] = [0.5, 0.68, 0.0]  # tip closer to wrist than mcp
    pts[4] = [0.45, 0.7, 0.0]
    return pts


def _two_finger_hand():
    pts = _fist_hand()
    pts[8] = [0.5, 0.25, 0.0]
    pts[5] = [0.5, 0.55, 0.0]
    pts[12] = [0.55, 0.28, 0.0]
    pts[9] = [0.55, 0.55, 0.0]
    return pts


class TestClassify:
    def test_open_pinch_fist_two_finger(self):
        assert classify_pose(_open_hand()) == "open"
        assert classify_pose(_pinch_hand()) == "pinch"
        assert classify_pose(_fist_hand()) == "fist"
        assert classify_pose(_two_finger_hand()) == "two_finger"


class TestPrecisionGestures:
    def test_click_drag_cycle(self):
        c = PrecisionClassifier(pinch_hold_ms=0, click_debounce_ms=0)
        ev, _ = c.update(_pinch_hand(), 1000)
        assert ev == "drag_start"
        ev, _ = c.update(_pinch_hand(), 1010)
        assert ev == "drag_move"
        ev, _ = c.update(_open_hand(), 1020)
        assert ev == "drag_end"

    def test_tracking_loss_releases_drag(self):
        c = PrecisionClassifier(pinch_hold_ms=0)
        c.update(_pinch_hand(), 1000)
        assert c.on_tracking_lost() == "drag_end"

    def test_scroll_and_right_click(self):
        c = PrecisionClassifier(scroll_threshold=0.01, click_debounce_ms=0)
        h = _two_finger_hand()
        c.update(h, 1000)
        h2 = [list(p) for p in h]
        h2[8][1] = h[8][1] + 0.05
        ev, meta = c.update(h2, 1050)
        assert ev == "scroll"
        assert meta["scroll_dy"] != 0
        # Release two-finger quickly without further scroll → right click
        c2 = PrecisionClassifier(scroll_threshold=0.5, click_debounce_ms=0)
        c2.update(_two_finger_hand(), 2000)
        ev, _ = c2.update(_open_hand(), 2100)
        assert ev == "right_click"

    def test_fist_pause_and_palm_freeze(self):
        c = PrecisionClassifier(
            fist_pause_ms=50, open_palm_freeze_ms=50, pinch_threshold=0.04,
        )
        assert c.update(_fist_hand(), 1000)[0] == "none"
        assert c.update(_fist_hand(), 1060)[0] == "pause"
        c2 = PrecisionClassifier(
            open_palm_freeze_ms=50, fist_pause_ms=9999, pinch_threshold=0.04,
        )
        assert c2.update(_open_hand(), 1000)[0] == "none"
        assert c2.update(_open_hand(), 1060)[0] == "freeze_toggle"


class TestTemporalAndSwipe:
    def test_cooldown(self):
        g = TemporalGate(hold_ms=10, cooldown_ms=100)
        assert g.update(True, 0) is False
        assert g.update(True, 20) is True
        assert g.update(True, 50) is False
        assert g.update(False, 60) is False
        assert g.update(True, 200) is False
        assert g.update(True, 220) is True

    def test_swipe_directions(self):
        s = SwipeTracker(min_dx=0.1, min_dy=0.1, window_ms=500, cooldown_ms=0)
        s.update((0.5, 0.5), 0)
        assert s.update((0.7, 0.5), 50) == "swipe_right"
        s.update((0.5, 0.5), 200)
        assert s.update((0.3, 0.5), 250) == "swipe_left"
        s.update((0.5, 0.5), 400)
        assert s.update((0.5, 0.3), 450) == "swipe_up"
        s.update((0.5, 0.5), 600)
        assert s.update((0.5, 0.7), 650) == "swipe_down"

    def test_circle_accumulates(self):
        c = CircleTracker(min_step=0.001, turn_target=3.0, cooldown_ms=0)
        # Walk a rough circle
        import math
        fired = False
        for i in range(40):
            ang = i / 40 * 2 * math.pi
            if c.update((0.5 + 0.1 * math.cos(ang), 0.5 + 0.1 * math.sin(ang)), i * 10):
                fired = True
                break
        assert fired


class TestCoords:
    def test_calibration_and_mirror(self):
        cal = Calibration(0.0, 0.0, 1.0, 1.0)
        u, v = apply_calibration(0.0, 0.0, cal)
        assert u == pytest.approx(1.0)  # mirrored
        assert v == pytest.approx(0.0)

    def test_multi_monitor_mapping(self):
        screen = ScreenRect(-1920, 0, 3840, 1080)
        x, y, uv = uv_to_screen(0.0, 0.0, screen)
        assert x == -1920
        assert y == 0
        x2, y2, _ = uv_to_screen(1.0, 1.0, screen)
        assert x2 == screen.x2 - 1
        assert y2 == screen.y2 - 1

    def test_dead_zone(self):
        screen = ScreenRect(0, 0, 1000, 1000)
        x1, y1, prev = uv_to_screen(0.5, 0.5, screen)
        x2, y2, _ = uv_to_screen(0.501, 0.501, screen, dead_zone=0.01, prev_uv=prev)
        assert (x2, y2) == (x1, y1)

    def test_edge_proximity_and_sensitivity(self):
        assert edge_proximity(0.5, 0.5) == 0.0
        assert edge_proximity(0.01, 0.5) > 0.5
        cal = Calibration(0.0, 0.0, 1.0, 1.0)
        u0, _ = apply_calibration(0.25, 0.5, cal, sens_x=1.0)
        u1, _ = apply_calibration(0.25, 0.5, cal, sens_x=1.5)
        # mirrored 0.25 → 0.75; higher sens pulls farther from center
        assert abs(u1 - 0.5) >= abs(u0 - 0.5)

    def test_one_euro_stationary_and_jump(self):
        f = OneEuroFilter2D(OneEuroParams(min_cutoff=1.0, beta=0.02, dead_zone=0.002, max_jump=0.2))
        x, y = f.filter(0.5, 0.5, 0)
        xs = []
        for i in range(1, 40):
            x, y = f.filter(0.5 + 0.0004 * ((-1) ** i), 0.5, i * 16)
            xs.append(x)
        assert max(xs) - min(xs) < 0.01
        # Implausible jump reseats
        x2, _ = f.filter(0.5 + 0.5, 0.5, 40 * 16)
        assert x2 == pytest.approx(1.0)


class TestPrecisionEngine:
    def test_moves_and_click(self):
        inp = MockInput()
        win = MockWindow()
        settings = DesktopControlSettings(
            enabled=True, mode="precision", smoothing=0.0, pinch_hold_ms=0,
        )
        eng = PrecisionEngine(settings, inp, win)
        hand = _pinch_hand()
        eng.process(hand, 1000)
        assert any(e[0] == "move" for e in inp.events)
        assert ("down", "left") in inp.events
        eng.process(_open_hand(), 1100)
        assert ("up", "left") in inp.events

    def test_emergency_stop(self):
        inp = MockInput()
        eng = PrecisionEngine(DesktopControlSettings(), inp, MockWindow())
        eng.process(_pinch_hand(), 1000)
        eng.emergency_stop()
        assert eng.paused
        assert ("release_all",) in inp.events
        before = len(inp.events)
        eng.process(_pinch_hand(), 2000)
        assert len(inp.events) == before  # no new injection while paused


class TestSpatialEngine:
    def test_target_and_move(self):
        inp = MockInput()
        # Fullscreen mock so calibrated mid-frame landmarks hit the window.
        win = MockWindow(
            screen=ScreenRect(0, 0, 1920, 1080),
            windows=[WindowInfo(1, "Mock App", ScreenRect(0, 0, 1920, 1080))],
        )
        settings = DesktopControlSettings(enabled=True, mode="spatial", grab_pinch_ms=0)
        eng = SpatialEngine(settings, inp, win)
        open_h = _open_hand()
        open_h[8] = [0.5, 0.4, 0.0]
        st = eng.process(open_h, None, 1000)
        assert st["selected"] == "Mock App"
        pinch = _pinch_hand()
        pinch[8] = [0.5, 0.4, 0.0]
        pinch[4] = [0.50, 0.40, 0.0]  # keep thumb+index pinched after reposition
        eng.process(pinch, None, 1100)
        pinch2 = _pinch_hand()
        pinch2[8] = [0.4, 0.4, 0.0]
        pinch2[4] = [0.40, 0.40, 0.0]
        eng.process(pinch2, None, 1200)
        assert win.moves  # moved

    def test_swipe_alt_tab(self):
        inp = MockInput()
        eng = SpatialEngine(
            DesktopControlSettings(swipe_min_dx=0.1, spatial_cooldown_ms=0),
            inp,
            MockWindow(),
        )
        h = _open_hand()
        h[8] = [0.5, 0.5, 0.0]
        eng.process(h, None, 0)
        h2 = _open_hand()
        h2[8] = [0.75, 0.5, 0.0]
        st = eng.process(h2, None, 40)
        assert st["gesture"] == "swipe_right"
        assert any(e[0] == "keys" for e in inp.events)


class TestServiceAuthGates:
    def test_disabled_by_default_rejects_inject(self, tmp_path: Path):
        store = SettingsStore(tmp_path / "desktop_control.json")
        svc = DesktopControlService(store, MockInput(), MockWindow())
        assert svc.settings.enabled is False
        out = svc.ingest_frame({"t": 1, "hands": [_pinch_hand()]})
        assert out["ok"] is False
        assert out["enabled"] is False

    def test_mode_switch_releases_buttons(self, tmp_path: Path):
        store = SettingsStore(tmp_path / "desktop_control.json")
        inp = MockInput()
        svc = DesktopControlService(store, inp, MockWindow())
        svc.update_settings({
            "enabled": True, "mode": "precision", "pinch_hold_ms": 0, "smoothing": 0,
        })
        svc.ingest_frame({"t": 1000, "hands": [_pinch_hand()]})
        assert "left" in inp.buttons_down
        svc.set_mode("spatial")
        assert "left" not in inp.buttons_down
        assert ("release_all",) in inp.events

    def test_jarvis_action_allowlist(self):
        assert sanitize_jarvis_action("open_tools") == "open_tools"
        assert sanitize_jarvis_action("rm -rf /") is None
        assert sanitize_jarvis_action("shell") is None
        assert "open_command_palette" in ALLOWED_JARVIS_ACTIONS

    def test_hud_mode_does_not_inject(self, tmp_path: Path):
        store = SettingsStore(tmp_path / "desktop_control.json")
        inp = MockInput()
        svc = DesktopControlService(store, inp, MockWindow())
        svc.update_settings({"enabled": True, "mode": "hud"})
        inp.events.clear()
        out = svc.ingest_frame({"t": 1, "hands": [_pinch_hand()]})
        assert out.get("injected") is False
        assert inp.events == []
