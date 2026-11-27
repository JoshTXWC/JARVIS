"""Core chat loop against a small local model (Ollama-style endpoint).

Covers the fixes that make the default config work out of the box:
- optional payload fields a model rejects (reasoning_effort/tools) are dropped
  and retried instead of failing the turn
- lean prompt mode keeps the request inside Ollama's 4096-token default
- the orchestrator tool loop runs a tool and answers
"""
from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from jarvis.config import Config
from jarvis.core import brain as brain_mod
from jarvis.core.brain import BrainReply, LLMBrain, ToolCall
from jarvis.core.tool_select import (
    CORE_TOOLS,
    is_local_endpoint,
    lean_mode,
    select_tools,
)


def _cfg(**model) -> Config:
    cfg = Config()
    for k, v in model.items():
        setattr(cfg.model, k, v)
    return cfg


# ---------------------------------------------------------------- brain ----

def _ollama_like_transport(seen: list[dict]):
    """Rejects reasoning_effort like Ollama does for non-thinking models."""

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        seen.append(body)
        if "reasoning_effort" in body:
            return httpx.Response(
                400,
                json={"error": {"message": '"qwen2.5:1.5b" does not support thinking'}},
            )
        if body.get("stream"):
            chunks = [
                {"choices": [{"delta": {"content": "Good evening"}}]},
                {"choices": [{"delta": {"content": ", sir."}, "finish_reason": "stop"}]},
            ]
            text = "".join(f"data: {json.dumps(c)}\n\n" for c in chunks) + "data: [DONE]\n\n"
            return httpx.Response(200, text=text, headers={"content-type": "text/event-stream"})
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": "Good evening, sir."}, "finish_reason": "stop"}]},
        )

    return httpx.MockTransport(handler)


@pytest.mark.parametrize("stream", [False, True])
def test_brain_drops_unsupported_reasoning_effort(stream):
    brain_mod._UNSUPPORTED_FIELDS.clear()
    cfg = _cfg(endpoint="http://localhost:11434/v1", model="qwen2.5:1.5b", reasoning_effort="low")
    b = LLMBrain(cfg)
    seen: list[dict] = []
    b._client = httpx.AsyncClient(transport=_ollama_like_transport(seen))
    msgs = [{"role": "user", "content": "hi"}]

    async def run():
        if stream:
            return await b.chat_stream(msgs)
        return await b.chat(msgs)

    reply = asyncio.run(run())
    assert reply.text == "Good evening, sir."
    assert "reasoning_effort" in seen[0]
    assert "reasoning_effort" not in seen[-1]

    # Remembered: the next call doesn't pay the failed round-trip again.
    seen.clear()
    asyncio.run(run())
    assert len(seen) == 1 and "reasoning_effort" not in seen[0]


def test_degrade_payload_drops_tools_and_ignores_other_errors():
    p = {"model": "m", "tools": [{}], "stream_options": {}}
    assert brain_mod._degrade_payload(p, 400, "registry.ollama.ai/library/m does not support tools", "e")
    assert "tools" not in p
    assert not brain_mod._degrade_payload({"model": "m"}, 500, "boom", "e")
    assert not brain_mod._degrade_payload({"model": "m"}, 400, "bad request", "e")


# ---------------------------------------------------------- tool select ----

ALL = [
    "web_search", "web_fetch", "read_file", "list_dir", "write_file", "run_shell", "remember",
    "recall", "system_status", "image_generate", "image_search", "github_list_repos",
    "github_create_pull_request", "git_status", "scan_project", "code_search", "edit_file",
    "kill_process", "list_processes", "webcam_see", "daily_quote", "browser_open",
]


def test_local_endpoint_detection():
    assert is_local_endpoint("http://localhost:11434/v1")
    assert is_local_endpoint("http://127.0.0.1:1234/v1")
    assert not is_local_endpoint("https://api.x.ai/v1")
    assert lean_mode(_cfg(endpoint="http://localhost:11434/v1").model)
    assert not lean_mode(_cfg(endpoint="https://api.openai.com/v1").model)
    assert not lean_mode(_cfg(endpoint="http://localhost:11434/v1", prompt_mode="full").model)
    assert lean_mode(_cfg(endpoint="https://api.openai.com/v1", prompt_mode="lean").model)


def test_select_tools_chitchat_gets_core_only():
    picked = select_tools(ALL, "hello there, how are you?", max_tools=14)
    assert set(picked) <= set(CORE_TOOLS)


def test_select_tools_keyword_groups_and_cap():
    picked = select_tools(ALL, "open a pull request on my github repo", max_tools=6)
    assert picked[0].startswith("github") and len(picked) == 6
    assert "image_generate" in select_tools(ALL, "draw an image of a helmet")
    assert "webcam_see" in select_tools(ALL, "look at me through the webcam")


def test_select_tools_keeps_recent_and_respects_allowlist():
    picked = select_tools(ALL, "and now?", recent_tools=["daily_quote"], max_tools=3)
    assert picked[0] == "daily_quote"
    picked = select_tools(ALL, "search the web", allowlist=["read_file", "edit_file"])
    assert set(picked) <= {"read_file", "edit_file"}


# ---------------------------------------------------------- orchestrator ---

class _FakeBrain:
    """Scripted brain: first hop calls list_dir, second hop answers."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.mc = cfg.model
        self.calls: list[dict] = []

    def build_system_prompt(self, persona, tools_doc):
        return LLMBrain.build_system_prompt(self, persona, tools_doc)

    async def chat(self, messages, tool_schemas=None):
        return BrainReply(text="NONE")

    async def chat_stream(self, messages, tool_schemas=None, on_delta=None):
        self.calls.append({"messages": messages, "tools": [t["name"] for t in tool_schemas or []]})
        if len(self.calls) == 1:
            return BrainReply(text="", tool_calls=[ToolCall(name="list_dir", args={"path": "docs"}, call_id="c1")])
        if on_delta:
            on_delta("The docs folder has a few files, sir.")
        return BrainReply(text="The docs folder has a few files, sir.")

    async def aclose(self):
        pass


def test_orchestrator_runs_tool_then_answers_in_lean_mode(tmp_path):
    from jarvis.main import build_services
    from jarvis.core.orchestrator import Orchestrator

    cfg, _logger, _brain, registry, memory, perms, actions, _orch, _agents = build_services(None)
    cfg.model.endpoint = "http://localhost:11434/v1"
    cfg.model.prompt_mode = "auto"
    fake = _FakeBrain(cfg)
    orch = Orchestrator(cfg=cfg, brain=fake, registry=registry, memory=memory,
                        permissions=perms, actions=actions, semantic=None)

    async def run():
        out = []
        async for ev in orch.handle_user_message("What files are in the docs folder?"):
            out.append(ev)
        return out

    events = asyncio.run(run())
    kinds = [e.kind.value if hasattr(e.kind, "value") else str(e.kind) for e in events]
    texts = [e.text for e in events if e.text]
    assert any("docs folder" in t for t in texts), texts
    assert "done" in " ".join(kinds).lower()
    first = fake.calls[0]
    # Lean prompt: compact persona + a small tool subset.
    assert len(first["tools"]) <= cfg.model.max_tools
    assert "list_dir" in first["tools"]
    system = first["messages"][0]["content"]
    assert len(system) < 4000, len(system)
