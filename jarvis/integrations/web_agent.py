"""Gemini Computer-Use web agent — ported from ada_v2 (nazirlouis/ada_v2).

Uses Google's computer-use model + Playwright to autonomously drive a browser
for multi-step web tasks. Requires GEMINI_API_KEY and Playwright Chromium.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import os
from typing import Any, Awaitable, Callable, Optional

log = logging.getLogger("jarvis.web_agent")

SCREEN_WIDTH = 1440
SCREEN_HEIGHT = 900
MODEL_ID = "gemini-2.5-computer-use-preview-10-2025"

UpdateCallback = Callable[[Optional[str], str], Awaitable[None]]


class WebAgent:
    """Autonomous browser agent powered by Gemini Computer Use."""

    def __init__(self, api_key: str | None = None) -> None:
        self.api_key = (api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
        self.browser = None
        self.context = None
        self.page = None
        self._client = None

    def _ensure_client(self):
        if not self.api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Add it to .env "
                "(https://aistudio.google.com/app/apikey) and restart JARVIS."
            )
        if self._client is None:
            try:
                from google import genai
            except ImportError as e:
                raise RuntimeError(
                    "google-genai is not installed. Run: "
                    "pip install google-genai"
                ) from e
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    @staticmethod
    def denormalize_x(x: int, width: int) -> int:
        return int((x / 1000) * width)

    @staticmethod
    def denormalize_y(y: int, height: int) -> int:
        return int((y / 1000) * height)

    async def execute_function_calls(self, function_calls: list[Any]) -> list[tuple]:
        results = []
        for call in function_calls:
            call_id = getattr(call, "id", None)
            fn_name = call.name
            args = call.args or {}
            log.info("web_agent action: %s %s", fn_name, args)

            requires_acknowledgement = False
            if "safety_decision" in args:
                decision = args["safety_decision"]
                if decision.get("decision") == "require_confirmation":
                    log.warning("safety alert: %s — auto-acknowledging", decision.get("explanation"))
                    requires_acknowledgement = True

            result_data: dict[str, Any] = {}
            try:
                if fn_name == "open_web_browser":
                    pass
                elif fn_name == "navigate":
                    await self.page.goto(args["url"])
                elif fn_name == "go_back":
                    await self.page.go_back()
                elif fn_name == "go_forward":
                    await self.page.go_forward()
                elif fn_name == "search":
                    await self.page.goto("https://www.google.com")
                elif fn_name == "wait_5_seconds":
                    await asyncio.sleep(5)
                elif fn_name == "click_at":
                    x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                    y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                    await self.page.mouse.click(x, y)
                elif fn_name == "type_text_at":
                    x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                    y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                    text = args["text"]
                    press_enter = args.get("press_enter", False)
                    clear_before = args.get("clear_before_typing", True)
                    await self.page.mouse.click(x, y)
                    if clear_before:
                        await self.page.keyboard.press("Control+A")
                        await self.page.keyboard.press("Backspace")
                    await self.page.keyboard.type(text)
                    if press_enter:
                        await self.page.keyboard.press("Enter")
                elif fn_name == "hover_at":
                    x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                    y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                    await self.page.mouse.move(x, y)
                elif fn_name == "drag_and_drop":
                    start_x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                    start_y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                    end_x = self.denormalize_x(args["destination_x"], SCREEN_WIDTH)
                    end_y = self.denormalize_y(args["destination_y"], SCREEN_HEIGHT)
                    await self.page.mouse.move(start_x, start_y)
                    await self.page.mouse.down()
                    await self.page.mouse.move(end_x, end_y)
                    await self.page.mouse.up()
                elif fn_name == "key_combination":
                    await self.page.keyboard.press(args.get("keys"))
                elif fn_name in ("scroll_document", "scroll_at"):
                    magnitude = args.get("magnitude", 800)
                    direction = args.get("direction", "down")
                    if fn_name == "scroll_at":
                        x = self.denormalize_x(args["x"], SCREEN_WIDTH)
                        y = self.denormalize_y(args["y"], SCREEN_HEIGHT)
                        await self.page.mouse.move(x, y)
                    dx, dy = 0, 0
                    if direction == "down":
                        dy = magnitude
                    elif direction == "up":
                        dy = -magnitude
                    elif direction == "right":
                        dx = magnitude
                    elif direction == "left":
                        dx = -magnitude
                    await self.page.mouse.wheel(dx, dy)
                else:
                    log.warning("unimplemented computer-use action: %s", fn_name)
                await asyncio.sleep(1)
            except Exception as e:  # noqa: BLE001
                log.exception("error executing %s", fn_name)
                result_data = {"error": str(e)}

            if requires_acknowledgement:
                result_data["safety_acknowledgement"] = True
            results.append((call_id, fn_name, result_data))
        return results

    async def get_function_responses(self, results: list[tuple]):
        from google.genai import types

        screenshot_bytes = await self.page.screenshot(type="png")
        current_url = self.page.url
        function_responses = []
        for call_id, name, result in results:
            response_data = {"url": current_url, **result}
            function_responses.append(
                types.FunctionResponse(
                    name=name,
                    id=call_id,
                    response=response_data,
                    parts=[
                        types.FunctionResponsePart(
                            inline_data=types.FunctionResponseBlob(
                                mime_type="image/png",
                                data=screenshot_bytes,
                            )
                        )
                    ],
                )
            )
        return function_responses, screenshot_bytes

    async def run_task(
        self,
        prompt: str,
        update_callback: UpdateCallback | None = None,
        max_turns: int = 20,
        headless: bool = True,
    ) -> str:
        """Run a multi-step browser task. Returns the agent's final summary."""
        from google.genai import types
        from playwright.async_api import async_playwright

        client = self._ensure_client()
        log.info("WebAgent started — goal: %s", prompt[:120])
        final_response = "Agent finished without a final summary."

        async with async_playwright() as p:
            self.browser = await p.chromium.launch(headless=headless)
            self.context = await self.browser.new_context(
                viewport={"width": SCREEN_WIDTH, "height": SCREEN_HEIGHT},
                user_agent=(
                    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) "
                    "Chrome/120.0.0.0 Safari/537.36"
                ),
            )
            self.page = await self.context.new_page()
            await self.page.goto("https://www.google.com")

            config = types.GenerateContentConfig(
                tools=[
                    types.Tool(
                        computer_use=types.ComputerUse(
                            environment=types.Environment.ENVIRONMENT_BROWSER
                        )
                    )
                ],
                thinking_config=types.ThinkingConfig(include_thoughts=True),
            )

            initial_screenshot = await self.page.screenshot(type="png")
            if update_callback:
                encoded = base64.b64encode(initial_screenshot).decode("utf-8")
                await update_callback(encoded, "Web Agent initialized")

            chat_history = [
                types.Content(
                    role="user",
                    parts=[
                        types.Part(text=prompt),
                        types.Part.from_bytes(
                            data=initial_screenshot, mime_type="image/png"
                        ),
                    ],
                )
            ]

            for turn in range(max_turns):
                log.info("web_agent turn %d/%d", turn + 1, max_turns)
                try:
                    response = await client.aio.models.generate_content(
                        model=MODEL_ID,
                        contents=chat_history,
                        config=config,
                    )
                except Exception as e:  # noqa: BLE001
                    log.exception("web_agent API error")
                    if update_callback:
                        await update_callback(None, f"Error: {e}")
                    final_response = f"Web agent API error: {e}"
                    break

                if not response.candidates:
                    log.warning("model returned no candidates")
                    break

                model_content = response.candidates[0].content
                chat_history.append(model_content)

                has_tool_use = False
                agent_text = ""
                for part in model_content.parts:
                    if getattr(part, "thought", False):
                        log.debug("thought: %s", part.text)
                    elif part.text:
                        agent_text = part.text
                        log.info("agent: %s", part.text[:200])
                    if part.function_call:
                        has_tool_use = True

                if agent_text:
                    final_response = agent_text

                function_calls = [
                    part.function_call
                    for part in model_content.parts
                    if part.function_call
                ]
                if not function_calls:
                    if not has_tool_use:
                        if update_callback:
                            await update_callback(None, "Task finished")
                        break
                    continue

                results = await self.execute_function_calls(function_calls)
                function_responses, screenshot_bytes = await self.get_function_responses(
                    results
                )
                if update_callback:
                    encoded = base64.b64encode(screenshot_bytes).decode("utf-8")
                    actions = ", ".join(r[1] for r in results)
                    await update_callback(encoded, f"Executed: {actions}")

                response_parts = [
                    types.Part(function_response=fr) for fr in function_responses
                ]
                chat_history.append(types.Content(role="user", parts=response_parts))

            await self.browser.close()
            self.browser = None
            self.page = None
            log.info("WebAgent closed")
            return final_response
