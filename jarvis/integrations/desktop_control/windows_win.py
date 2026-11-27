"""Win32 window management helpers (move/resize/snap/switch). Mockable."""
from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Protocol

from .coords import ScreenRect


@dataclass
class WindowInfo:
    hwnd: int
    title: str
    rect: ScreenRect


class WindowBackend(Protocol):
    def virtual_screen(self) -> ScreenRect: ...
    def primary_screen(self) -> ScreenRect: ...
    def window_from_point(self, x: int, y: int) -> WindowInfo | None: ...
    def move_resize(self, hwnd: int, x: int, y: int, w: int, h: int) -> None: ...
    def minimize(self, hwnd: int) -> None: ...
    def maximize(self, hwnd: int) -> None: ...
    def restore(self, hwnd: int) -> None: ...
    def foreground(self, hwnd: int) -> None: ...


@dataclass
class MockWindow:
    screen: ScreenRect = ScreenRect(0, 0, 1920, 1080)
    windows: list[WindowInfo] | None = None
    moves: list[tuple] | None = None

    def __post_init__(self) -> None:
        if self.windows is None:
            self.windows = [
                WindowInfo(1, "Mock App", ScreenRect(100, 100, 800, 600)),
            ]
        if self.moves is None:
            self.moves = []

    def virtual_screen(self) -> ScreenRect:
        return self.screen

    def primary_screen(self) -> ScreenRect:
        return self.screen

    def window_from_point(self, x: int, y: int) -> WindowInfo | None:
        for w in reversed(self.windows or []):
            r = w.rect
            if r.x <= x < r.x2 and r.y <= y < r.y2:
                return w
        return None

    def move_resize(self, hwnd: int, x: int, y: int, w: int, h: int) -> None:
        assert self.moves is not None and self.windows is not None
        self.moves.append((hwnd, x, y, w, h))
        for i, win in enumerate(self.windows):
            if win.hwnd == hwnd:
                self.windows[i] = WindowInfo(hwnd, win.title, ScreenRect(x, y, w, h))
                break

    def minimize(self, hwnd: int) -> None:
        assert self.moves is not None
        self.moves.append(("min", hwnd))

    def maximize(self, hwnd: int) -> None:
        assert self.moves is not None
        self.moves.append(("max", hwnd))

    def restore(self, hwnd: int) -> None:
        assert self.moves is not None
        self.moves.append(("restore", hwnd))

    def foreground(self, hwnd: int) -> None:
        assert self.moves is not None
        self.moves.append(("fg", hwnd))


def create_window_backend() -> WindowBackend:
    if sys.platform == "win32":
        try:
            return Win32Windows()
        except Exception:  # noqa: BLE001
            pass
    return MockWindow()


class Win32Windows:
    def __init__(self) -> None:
        import ctypes
        import ctypes.wintypes as wt

        self._ctypes = ctypes
        self._user32 = ctypes.windll.user32
        self._wt = wt

    def virtual_screen(self) -> ScreenRect:
        u = self._user32
        return ScreenRect(
            int(u.GetSystemMetrics(76)),
            int(u.GetSystemMetrics(77)),
            int(u.GetSystemMetrics(78)) or 1,
            int(u.GetSystemMetrics(79)) or 1,
        )

    def primary_screen(self) -> ScreenRect:
        u = self._user32
        return ScreenRect(0, 0, int(u.GetSystemMetrics(0)) or 1, int(u.GetSystemMetrics(1)) or 1)

    def window_from_point(self, x: int, y: int) -> WindowInfo | None:
        pt = self._wt.POINT(int(x), int(y))
        hwnd = int(self._user32.WindowFromPoint(pt))
        if not hwnd:
            return None
        # Climb to root owner for top-level window
        root = int(self._user32.GetAncestor(hwnd, 2)) or hwnd  # GA_ROOT = 2
        buf = self._ctypes.create_unicode_buffer(512)
        self._user32.GetWindowTextW(root, buf, 512)
        rect = self._wt.RECT()
        if not self._user32.GetWindowRect(root, self._ctypes.byref(rect)):
            return None
        return WindowInfo(
            root,
            buf.value,
            ScreenRect(rect.left, rect.top, rect.right - rect.left, rect.bottom - rect.top),
        )

    def move_resize(self, hwnd: int, x: int, y: int, w: int, h: int) -> None:
        # SWP_NOZORDER | SWP_NOACTIVATE
        self._user32.SetWindowPos(int(hwnd), 0, int(x), int(y), int(w), int(h), 0x0010 | 0x0004)

    def minimize(self, hwnd: int) -> None:
        self._user32.ShowWindow(int(hwnd), 6)  # SW_MINIMIZE

    def maximize(self, hwnd: int) -> None:
        self._user32.ShowWindow(int(hwnd), 3)  # SW_MAXIMIZE

    def restore(self, hwnd: int) -> None:
        self._user32.ShowWindow(int(hwnd), 9)  # SW_RESTORE

    def foreground(self, hwnd: int) -> None:
        self._user32.SetForegroundWindow(int(hwnd))
