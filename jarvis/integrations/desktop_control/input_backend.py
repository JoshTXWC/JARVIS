"""OS input backends — Win32 SendInput + mock for tests."""
from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Literal, Protocol

MouseButton = Literal["left", "right", "middle"]


class InputBackend(Protocol):
    def move_to(self, x: int, y: int) -> None: ...
    def mouse_down(self, button: MouseButton = "left") -> None: ...
    def mouse_up(self, button: MouseButton = "left") -> None: ...
    def click(self, button: MouseButton = "left") -> None: ...
    def scroll(self, dy: int) -> None: ...
    def key_combo(self, *vk_or_names: str) -> None: ...
    def release_all(self) -> None: ...


@dataclass
class MockInput:
    events: list[tuple] = field(default_factory=list)
    x: int = 0
    y: int = 0
    buttons_down: set[str] = field(default_factory=set)

    def move_to(self, x: int, y: int) -> None:
        self.x, self.y = int(x), int(y)
        self.events.append(("move", self.x, self.y))

    def mouse_down(self, button: MouseButton = "left") -> None:
        self.buttons_down.add(button)
        self.events.append(("down", button))

    def mouse_up(self, button: MouseButton = "left") -> None:
        self.buttons_down.discard(button)
        self.events.append(("up", button))

    def click(self, button: MouseButton = "left") -> None:
        self.mouse_down(button)
        self.mouse_up(button)
        self.events.append(("click", button))

    def scroll(self, dy: int) -> None:
        self.events.append(("scroll", int(dy)))

    def key_combo(self, *vk_or_names: str) -> None:
        self.events.append(("keys", tuple(vk_or_names)))

    def release_all(self) -> None:
        for b in list(self.buttons_down):
            self.mouse_up(b)  # type: ignore[arg-type]
        self.events.append(("release_all",))


def create_input_backend() -> InputBackend:
    if sys.platform == "win32":
        try:
            from .input_win import Win32Input
            return Win32Input()
        except Exception:  # noqa: BLE001
            pass
    return MockInput()
