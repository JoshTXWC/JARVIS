"""Windows SendInput mouse/keyboard injection (no elevated bypass)."""
from __future__ import annotations

import ctypes
import ctypes.wintypes as wt
from typing import Literal

MouseButton = Literal["left", "right", "middle"]

ULONG_PTR = ctypes.c_ulonglong if ctypes.sizeof(ctypes.c_void_p) == 8 else ctypes.c_ulong

INPUT_MOUSE = 0
INPUT_KEYBOARD = 1
MOUSEEVENTF_MOVE = 0x0001
MOUSEEVENTF_LEFTDOWN = 0x0002
MOUSEEVENTF_LEFTUP = 0x0004
MOUSEEVENTF_RIGHTDOWN = 0x0008
MOUSEEVENTF_RIGHTUP = 0x0010
MOUSEEVENTF_MIDDLEDOWN = 0x0020
MOUSEEVENTF_MIDDLEUP = 0x0040
MOUSEEVENTF_WHEEL = 0x0800
MOUSEEVENTF_ABSOLUTE = 0x8000
MOUSEEVENTF_VIRTUALDESK = 0x4000
KEYEVENTF_KEYUP = 0x0002
WHEEL_DELTA = 120

SM_XVIRTUALSCREEN = 76
SM_YVIRTUALSCREEN = 77
SM_CXVIRTUALSCREEN = 78
SM_CYVIRTUALSCREEN = 79


class MOUSEINPUT(ctypes.Structure):
    _fields_ = [
        ("dx", wt.LONG),
        ("dy", wt.LONG),
        ("mouseData", wt.DWORD),
        ("dwFlags", wt.DWORD),
        ("time", wt.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [
        ("wVk", wt.WORD),
        ("wScan", wt.WORD),
        ("dwFlags", wt.DWORD),
        ("time", wt.DWORD),
        ("dwExtraInfo", ULONG_PTR),
    ]


class HARDWAREINPUT(ctypes.Structure):
    _fields_ = [
        ("uMsg", wt.DWORD),
        ("wParamL", wt.WORD),
        ("wParamH", wt.WORD),
    ]


class INPUT_UNION(ctypes.Union):
    _fields_ = [("mi", MOUSEINPUT), ("ki", KEYBDINPUT), ("hi", HARDWAREINPUT)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wt.DWORD), ("union", INPUT_UNION)]


_user32 = ctypes.windll.user32
_SendInput = _user32.SendInput
_SendInput.argtypes = (wt.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
_SendInput.restype = wt.UINT

VK = {
    "ctrl": 0x11,
    "control": 0x11,
    "shift": 0x10,
    "alt": 0x12,
    "win": 0x5B,
    "lwin": 0x5B,
    "tab": 0x09,
    "esc": 0x1B,
    "escape": 0x1B,
    "d": 0x44,
    "s": 0x53,
}


def _virtual_screen() -> tuple[int, int, int, int]:
    x = int(_user32.GetSystemMetrics(SM_XVIRTUALSCREEN))
    y = int(_user32.GetSystemMetrics(SM_YVIRTUALSCREEN))
    w = int(_user32.GetSystemMetrics(SM_CXVIRTUALSCREEN)) or 1
    h = int(_user32.GetSystemMetrics(SM_CYVIRTUALSCREEN)) or 1
    return x, y, w, h


def _abs_coords(x: int, y: int) -> tuple[int, int]:
    vx, vy, vw, vh = _virtual_screen()
    # SendInput absolute range is 0..65535 across the virtual desktop when VIRTUALDESK set.
    ax = int((x - vx) * 65535 / max(vw - 1, 1))
    ay = int((y - vy) * 65535 / max(vh - 1, 1))
    return max(0, min(65535, ax)), max(0, min(65535, ay))


class Win32Input:
    def __init__(self) -> None:
        self._down: set[str] = set()

    def _send(self, *inputs: INPUT) -> None:
        arr = (INPUT * len(inputs))(*inputs)
        _SendInput(len(inputs), arr, ctypes.sizeof(INPUT))

    def move_to(self, x: int, y: int) -> None:
        ax, ay = _abs_coords(int(x), int(y))
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(
            ax, ay, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, 0, 0
        )
        self._send(inp)

    def _btn_flags(self, button: MouseButton, down: bool) -> int:
        table = {
            ("left", True): MOUSEEVENTF_LEFTDOWN,
            ("left", False): MOUSEEVENTF_LEFTUP,
            ("right", True): MOUSEEVENTF_RIGHTDOWN,
            ("right", False): MOUSEEVENTF_RIGHTUP,
            ("middle", True): MOUSEEVENTF_MIDDLEDOWN,
            ("middle", False): MOUSEEVENTF_MIDDLEUP,
        }
        return table[(button, down)]

    def mouse_down(self, button: MouseButton = "left") -> None:
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(0, 0, 0, self._btn_flags(button, True), 0, 0)
        self._send(inp)
        self._down.add(button)

    def mouse_up(self, button: MouseButton = "left") -> None:
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(0, 0, 0, self._btn_flags(button, False), 0, 0)
        self._send(inp)
        self._down.discard(button)

    def click(self, button: MouseButton = "left") -> None:
        self.mouse_down(button)
        self.mouse_up(button)

    def scroll(self, dy: int) -> None:
        # Positive dy = scroll up (away from user) in Win32 wheel.
        data = int(-dy) * WHEEL_DELTA
        inp = INPUT(type=INPUT_MOUSE)
        inp.union.mi = MOUSEINPUT(0, 0, data & 0xFFFFFFFF, MOUSEEVENTF_WHEEL, 0, 0)
        self._send(inp)

    def key_combo(self, *vk_or_names: str) -> None:
        codes = []
        for name in vk_or_names:
            key = str(name).lower()
            if key in VK:
                codes.append(VK[key])
            elif len(key) == 1 and key.isalpha():
                codes.append(ord(key.upper()))
            else:
                raise ValueError(f"unknown key: {name}")
        downs = []
        for code in codes:
            inp = INPUT(type=INPUT_KEYBOARD)
            inp.union.ki = KEYBDINPUT(code, 0, 0, 0, 0)
            downs.append(inp)
        ups = []
        for code in reversed(codes):
            inp = INPUT(type=INPUT_KEYBOARD)
            inp.union.ki = KEYBDINPUT(code, 0, KEYEVENTF_KEYUP, 0, 0)
            ups.append(inp)
        self._send(*(downs + ups))

    def release_all(self) -> None:
        for b in list(self._down):
            self.mouse_up(b)  # type: ignore[arg-type]
