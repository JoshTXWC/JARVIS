"""stdin JSON-lines → Win32 mouse + window drag. Used by Electron.

Protocol (one JSON object per line):
  {"op":"move","x":100,"y":200}
  {"op":"down","button":"left"}
  {"op":"up","button":"left"}
  {"op":"click","button":"left"}
  {"op":"scroll","dy":1}
  {"op":"release"}
  {"op":"win_grab","x":..,"y":..}
  {"op":"win_drag","x":..,"y":..}
  {"op":"win_drop"}
  {"op":"cursor_hide"}
  {"op":"cursor_show"}
  {"op":"ping"}
"""
from __future__ import annotations

import json
import sys

from .input_backend import create_input_backend
from .windows_win import create_window_backend


def _cursor_show_count(n: int) -> None:
    import ctypes

    user32 = ctypes.windll.user32
    if n < 0:
        while user32.ShowCursor(False) >= 0:
            pass
    else:
        while user32.ShowCursor(True) < 0:
            pass


def main() -> int:
    backend = create_input_backend()
    windows = create_window_backend()
    grab_hwnd: int | None = None
    grab_off_x = 0
    grab_off_y = 0
    grab_w = 0
    grab_h = 0
    cursor_hidden = False

    try:
        sys.stdout.reconfigure(line_buffering=True)  # type: ignore[attr-defined]
    except Exception:
        pass
    print(json.dumps({"ok": True, "backend": type(backend).__name__}), flush=True)

    for raw in sys.stdin:
        line = raw.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            continue
        op = str(msg.get("op") or "")
        try:
            if op == "move":
                backend.move_to(int(msg["x"]), int(msg["y"]))
            elif op == "down":
                backend.mouse_down(msg.get("button") or "left")
            elif op == "up":
                backend.mouse_up(msg.get("button") or "left")
            elif op == "click":
                backend.click(msg.get("button") or "left")
            elif op == "scroll":
                backend.scroll(int(msg.get("dy") or 0))
            elif op == "release":
                backend.release_all()
                grab_hwnd = None
            elif op == "win_grab":
                x, y = int(msg["x"]), int(msg["y"])
                backend.move_to(x, y)
                hit = windows.window_from_point(x, y)
                if hit and hit.title:
                    grab_hwnd = hit.hwnd
                    grab_off_x = x - hit.rect.x
                    grab_off_y = y - hit.rect.y
                    grab_w = hit.rect.width
                    grab_h = hit.rect.height
                else:
                    grab_hwnd = None
            elif op == "win_drag":
                if grab_hwnd is not None:
                    x, y = int(msg["x"]), int(msg["y"])
                    backend.move_to(x, y)
                    # Refresh size in case the window was resized externally
                    hit = windows.window_from_point(x, y)
                    if hit and hit.hwnd == grab_hwnd:
                        grab_w = hit.rect.width
                        grab_h = hit.rect.height
                    windows.move_resize(
                        grab_hwnd,
                        x - grab_off_x,
                        y - grab_off_y,
                        max(1, grab_w),
                        max(1, grab_h),
                    )
            elif op == "win_drop":
                grab_hwnd = None
            elif op == "cursor_hide":
                if not cursor_hidden:
                    try:
                        _cursor_show_count(-1)
                        cursor_hidden = True
                    except Exception:
                        pass
            elif op == "cursor_show":
                if cursor_hidden:
                    try:
                        _cursor_show_count(1)
                        cursor_hidden = False
                    except Exception:
                        pass
            elif op == "ping":
                print(json.dumps({"ok": True, "pong": True}), flush=True)
        except Exception as e:  # noqa: BLE001
            print(json.dumps({"ok": False, "error": str(e)}), flush=True)

    if cursor_hidden:
        try:
            _cursor_show_count(1)
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
