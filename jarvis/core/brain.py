"""LLM brain.

Supports two providers, both via httpx:
  - "anthropic"           : POST <endpoint>/v1/messages
  - "openai_compatible"   : POST <endpoint>/chat/completions   (LM Studio, Ollama, vLLM, OpenAI)

Two tool-calling strategies:
  - native_tool_calls=True  : use the provider's tool / function-calling API
  - native_tool_calls=False : ReAct-style XML tags in plain text (works with any model)

The orchestrator does NOT see the difference — both paths return a list of
`ToolCall` objects (possibly empty) plus a final text reply.
"""
from __future__ import annotations

import contextvars
import json
import logging
import re
import time
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Callable

import httpx

from ..config import Config
from .http_client import make_async_client

log = logging.getLogger("jarvis.brain")

# Per-request model override (Smart Auto). Context-local so concurrent
# turns cannot clobber each other.
_model_override: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "jarvis_model_override", default=None
)


def _http_error_detail(exc: BaseException) -> str:
    """Make SSL / connect failures readable in the chat panel."""
    msg = str(exc).strip() or type(exc).__name__
    low = msg.lower()
    if "certificate_verify_failed" in low or "ssl" in low:
        return (
            f"{msg} — cloud HTTPS blocked by TLS trust on this PC. "
            "JARVIS now uses the OS certificate store; restart the backend. "
            "If it persists, check corporate proxy / antivirus HTTPS scanning."
        )
    if "connect" in low:
        return f"{msg} — could not reach {getattr(exc, 'request', None) and getattr(exc.request, 'url', '') or 'LLM endpoint'}"
    return msg


def _is_google_openai_endpoint(endpoint: str) -> bool:
    ep = (endpoint or "").lower()
    return "generativelanguage.googleapis.com" in ep or "googleapis.com/v1beta/openai" in ep


def _openai_compat_payload(
    *,
    model: str,
    messages: list[dict[str, Any]],
    temperature: float,
    max_tokens: int,
    stream: bool,
    frequency_penalty: float,
    presence_penalty: float,
    reasoning_effort: str | None,
    endpoint: str,
    tool_schemas: list[dict] | None,
) -> dict[str, Any]:
    """Build a chat/completions body. Google’s OpenAI shim rejects penalty fields."""
    payload: dict[str, Any] = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
        "stream": stream,
    }
    # Gemini OpenAI-compat returns 400 on frequency_penalty / presence_penalty.
    if not _is_google_openai_endpoint(endpoint):
        payload["frequency_penalty"] = frequency_penalty
        payload["presence_penalty"] = presence_penalty
    if reasoning_effort not in (None, "none", ""):
        payload["reasoning_effort"] = reasoning_effort
    if tool_schemas:
        payload["tools"] = [{"type": "function", "function": s} for s in tool_schemas]
    # OpenAI / llama.cpp / newer Ollama: usage on the final SSE chunk.
    # Older local shims may reject this — stream path retries without it.
    if stream:
        payload["stream_options"] = {"include_usage": True}
    return payload


# Models (per endpoint+model) that rejected an optional payload field. Filled
# lazily on the first HTTP 400 so later turns don't pay the retry cost.
_UNSUPPORTED_FIELDS: dict[str, set[str]] = {}


def _unsupported_key(endpoint: str, model: str) -> str:
    return f"{(endpoint or '').rstrip('/')}::{model}"


def _strip_unsupported(payload: dict[str, Any], endpoint: str) -> dict[str, Any]:
    """Remove fields this model already told us it doesn't support."""
    for field in _UNSUPPORTED_FIELDS.get(_unsupported_key(endpoint, payload.get("model", "")), ()):
        payload.pop(field, None)
    return payload


def _degrade_payload(payload: dict[str, Any], status: int | None, err_body: str, endpoint: str) -> bool:
    """On an HTTP 400, drop the optional field the server complained about.

    Ollama answers e.g. `"qwen2.5:1.5b" does not support thinking` when
    `reasoning_effort` is sent to a non-reasoning model, or `does not support
    tools` for models without a tool template. Rather than failing the whole
    turn, drop the offending field, remember it for this model, and let the
    caller retry once. Returns True when the payload was changed.
    """
    if status != 400:
        return False
    low = (err_body or "").lower()
    drop: list[str] = []
    if "reasoning_effort" in payload and ("thinking" in low or "reasoning" in low):
        drop.append("reasoning_effort")
    if "tools" in payload and ("support tools" in low or ("tool" in low and "not support" in low)):
        drop.append("tools")
    if "stream_options" in payload and ("stream_options" in low or not drop):
        drop.append("stream_options")
    if not drop:
        return False
    key = _unsupported_key(endpoint, payload.get("model", ""))
    for field in drop:
        payload.pop(field, None)
        if field != "stream_options":
            _UNSUPPORTED_FIELDS.setdefault(key, set()).add(field)
    log.info("LLM rejected %s for %s; retrying without", drop, payload.get("model"))
    return True


def is_brain_error_text(text: str | None) -> bool:
    t = (text or "").lstrip()
    return t.startswith("[brain error]")


TOOL_CALL_RE = re.compile(r"<tool_call>\s*(\{.*?\})\s*</tool_call>", re.DOTALL)
XML_TOOL_RE = re.compile(
    r"<(?P<name>[a-zA-Z_][\w-]*)>\s*(?P<body>.*?)\s*</(?P=name)>",
    re.DOTALL,
)
THOUGHT_RE = re.compile(r"<thinking>(.*?)</thinking>", re.DOTALL | re.IGNORECASE)


@dataclass
class ToolCall:
    name: str
    args: dict[str, Any]
    raw: str = ""              # original text (for logging)
    call_id: str | None = None # provider id when native


@dataclass
class BrainUsage:
    """Token / timing stats for one LLM hop (llama.cpp / OpenAI / Ollama)."""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    duration_ms: float = 0.0
    tokens_per_second: float = 0.0
    prompt_per_second: float = 0.0
    cache_tokens: int = 0
    context_used: int = 0
    model: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "prompt_tokens": self.prompt_tokens,
            "completion_tokens": self.completion_tokens,
            "total_tokens": self.total_tokens,
            "duration_ms": round(self.duration_ms, 1),
            "tokens_per_second": round(self.tokens_per_second, 2),
            "prompt_per_second": round(self.prompt_per_second, 2),
            "cache_tokens": self.cache_tokens,
            "context_used": self.context_used or self.total_tokens,
            "model": self.model,
        }


@dataclass
class BrainReply:
    text: str                       # cleaned final text (no tool tags)
    tool_calls: list[ToolCall] = field(default_factory=list)
    raw: str = ""                   # untouched assistant message
    finish_reason: str | None = None
    reasoning: str = ""             # extracted <thinking> blocks
    usage: BrainUsage | None = None


REACT_INSTRUCTIONS = """\
You have access to tools. To call a tool, output a single block:

<tool_call>
{"name": "<tool_name>", "args": {<json-args>}}
</tool_call>

Never invent tags like <web_search> or <shell_command>. The only valid tool
syntax is the JSON <tool_call> block above.

After you receive the tool result (as a user message), you may call another
tool or write a final reply to the user. Do NOT wrap your final reply in
<tool_call>. Only emit one tool_call per turn. Think briefly inside
<thinking>...</thinking> if you need to plan; that block will be hidden
from the user. Keep replies short and concrete.
"""


class LLMBrain:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.mc = cfg.model
        self._client = make_async_client(timeout=self.mc.request_timeout_seconds)

    async def aclose(self) -> None:
        await self._client.aclose()

    @property
    def active_model(self) -> str:
        """Configured model, or the Smart Auto override for this request."""
        override = _model_override.get()
        return override or self.mc.model

    def set_model_override(self, model: str | None) -> contextvars.Token:
        """Temporarily route LLM calls to `model`. Returns a reset token."""
        return _model_override.set(model)

    def reset_model_override(self, token: contextvars.Token) -> None:
        _model_override.reset(token)

    # ------------------------------------------------------------------
    def build_system_prompt(self, persona: str, tools_doc: str) -> str:
        parts = [persona.strip()]
        if not self.mc.native_tool_calls:
            parts.append(REACT_INSTRUCTIONS)
        if tools_doc:
            parts.append("Available tools:\n" + tools_doc)
        return "\n\n".join(parts)

    # ------------------------------------------------------------------
    async def chat(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict] | None = None,
    ) -> BrainReply:
        provider = self.mc.provider
        if provider == "anthropic":
            return await self._chat_anthropic(messages, tool_schemas or [])
        return await self._chat_openai_compatible(messages, tool_schemas or [])

    async def chat_stream(
        self,
        messages: list[dict],
        tool_schemas: list[dict] | None = None,
        on_delta: Callable[[str], None] | None = None,
    ) -> BrainReply:
        """Streaming chat — invokes `on_delta(text_chunk)` for each token.

        Tool-call arguments are accumulated transparently. Returns the same
        `BrainReply` shape as `chat()` once the stream finishes.

        Falls back to non-stream on Anthropic provider or when the server
        returns a non-stream response.
        """
        if self.mc.provider == "anthropic":
            # Anthropic streaming wired separately; non-stream path still works.
            return await self._chat_anthropic(messages, tool_schemas or [])
        return await self._chat_openai_compatible_stream(messages, tool_schemas or [], on_delta)

    # ------------------------------------------------------------------
    async def _chat_openai_compatible(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict],
    ) -> BrainReply:
        url = self.mc.endpoint.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json"}
        if self.mc.api_key:
            headers["Authorization"] = f"Bearer {self.mc.api_key}"
        # OpenRouter requires these headers for proper routing.
        if "openrouter.ai" in self.mc.endpoint:
            headers["HTTP-Referer"] = "http://localhost:7341"
            headers["X-Title"] = "JARVIS_LOCAL"

        log.info("LLM chat → model=%s endpoint=%s", self.active_model, self.mc.endpoint)

        norm_msgs = _normalise_messages(messages)
        payload = _openai_compat_payload(
            model=self.active_model,
            messages=norm_msgs,
            temperature=self.mc.temperature,
            max_tokens=self.mc.max_tokens,
            stream=False,
            frequency_penalty=self.mc.frequency_penalty,
            presence_penalty=self.mc.presence_penalty,
            reasoning_effort=self.mc.reasoning_effort,
            endpoint=self.mc.endpoint,
            tool_schemas=tool_schemas if self.mc.native_tool_calls else None,
        )

        _strip_unsupported(payload, self.mc.endpoint)
        t0 = time.perf_counter()
        try:
            resp = await self._client.post(url, json=payload, headers=headers)
            for _ in range(3):
                if resp.status_code < 400 or not _degrade_payload(
                    payload, resp.status_code, resp.text[:500], self.mc.endpoint
                ):
                    break
                resp = await self._client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPStatusError as e:
            body = e.response.text[:500] if e.response else ""
            log.error("LLM HTTP %s: %s — %s", e.response.status_code, e, body)
            return BrainReply(text=f"[brain error] HTTP {e.response.status_code}: {body}", raw=str(e))
        except httpx.HTTPError as e:
            detail = _http_error_detail(e)
            log.error("LLM HTTP error: %s", detail)
            return BrainReply(text=f"[brain error] {detail}", raw=detail)

        data = resp.json()
        duration_ms = (time.perf_counter() - t0) * 1000.0
        choice = (data.get("choices") or [{}])[0]
        msg = choice.get("message", {}) or {}
        raw_text: str = msg.get("content") or ""
        finish = choice.get("finish_reason")

        tool_calls: list[ToolCall] = []

        # native tool calls (OpenAI style)
        for tc in msg.get("tool_calls") or []:
            fn = tc.get("function", {})
            try:
                args = json.loads(fn.get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(
                ToolCall(
                    name=fn.get("name", ""),
                    args=args,
                    raw=json.dumps(fn),
                    call_id=tc.get("id"),
                )
            )

        # ReAct fallback parse
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        clean_text = _strip_artifacts(raw_text)
        usage = _usage_from_response(
            data,
            model=self.active_model,
            completion_text=clean_text,
            duration_ms=duration_ms,
        )
        return BrainReply(
            text=clean_text,
            tool_calls=tool_calls,
            raw=raw_text,
            finish_reason=finish,
            reasoning=_extract_reasoning(raw_text),
            usage=usage,
        )

    # ------------------------------------------------------------------
    async def _chat_openai_compatible_stream(
        self,
        messages: list[dict[str, Any]],
        tool_schemas: list[dict],
        on_delta: Callable[[str], None] | None = None,
    ) -> BrainReply:
        url = self.mc.endpoint.rstrip("/") + "/chat/completions"
        headers = {"Content-Type": "application/json", "Accept": "text/event-stream"}
        if self.mc.api_key:
            headers["Authorization"] = f"Bearer {self.mc.api_key}"
        if "openrouter.ai" in self.mc.endpoint:
            headers["HTTP-Referer"] = "http://localhost:7341"
            headers["X-Title"] = "JARVIS_LOCAL"

        log.info("LLM stream → model=%s endpoint=%s", self.active_model, self.mc.endpoint)

        norm_msgs = _normalise_messages(messages)
        payload = _openai_compat_payload(
            model=self.active_model,
            messages=norm_msgs,
            temperature=self.mc.temperature,
            max_tokens=self.mc.max_tokens,
            stream=True,
            frequency_penalty=self.mc.frequency_penalty,
            presence_penalty=self.mc.presence_penalty,
            reasoning_effort=self.mc.reasoning_effort,
            endpoint=self.mc.endpoint,
            tool_schemas=tool_schemas if self.mc.native_tool_calls else None,
        )

        text_parts: list[str] = []
        # Accumulate streaming tool_calls keyed by index.
        tc_acc: dict[int, dict[str, Any]] = {}
        finish_reason: str | None = None
        loop_truncated = False
        last_chunk: dict[str, Any] = {}
        t0 = time.perf_counter()

        async def _stream_once(body: dict[str, Any]) -> tuple[list[str], dict[int, dict[str, Any]], str | None, dict[str, Any], bool, int | None, str]:
            """Returns text_parts, tc_acc, finish_reason, last_chunk, loop_truncated, http_status, err_body."""
            parts: list[str] = []
            acc: dict[int, dict[str, Any]] = {}
            finish: str | None = None
            last: dict[str, Any] = {}
            truncated = False
            async with self._client.stream("POST", url, json=body, headers=headers) as resp:
                if resp.status_code >= 400:
                    err = (await resp.aread()).decode("utf-8", "replace")[:500]
                    return parts, acc, finish, last, truncated, resp.status_code, err
                async for line in resp.aiter_lines():
                    if not line:
                        continue
                    if line.startswith("data:"):
                        line = line[5:].strip()
                    if not line or line == "[DONE]":
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    last = chunk
                    choice = (chunk.get("choices") or [{}])[0] if chunk.get("choices") else {}
                    delta = choice.get("delta", {}) or {}
                    if choice.get("finish_reason"):
                        finish = choice["finish_reason"]
                    piece = delta.get("content")
                    if piece:
                        parts.append(piece)
                        if on_delta:
                            try:
                                on_delta(piece)
                            except Exception:  # noqa: BLE001
                                pass
                        cut = _detect_repetition_loop("".join(parts))
                        if cut is not None:
                            truncated = True
                            full = "".join(parts)
                            parts = [full[:cut]]
                            finish = finish or "repetition_loop"
                            log.warning("stream aborted: repetition loop at offset %d", cut)
                            break
                    for tc in delta.get("tool_calls") or []:
                        idx = tc.get("index", 0)
                        slot = acc.setdefault(idx, {"id": "", "name": "", "args": ""})
                        if tc.get("id"):
                            slot["id"] = tc["id"]
                        fn = tc.get("function") or {}
                        if fn.get("name"):
                            slot["name"] = fn["name"]
                        if fn.get("arguments"):
                            slot["args"] += fn["arguments"]
            return parts, acc, finish, last, truncated, None, ""

        try:
            _strip_unsupported(payload, self.mc.endpoint)
            text_parts, tc_acc, finish_reason, last_chunk, loop_truncated, status, err_body = await _stream_once(payload)
            # Older Ollama / LM Studio builds reject stream_options; non-reasoning
            # models reject reasoning_effort; some models reject tools. Degrade
            # the payload and retry (bounded) instead of failing the turn.
            for _ in range(3):
                if status is None or not _degrade_payload(payload, status, err_body, self.mc.endpoint):
                    break
                text_parts, tc_acc, finish_reason, last_chunk, loop_truncated, status, err_body = await _stream_once(payload)
            if status is not None:
                log.error("LLM stream HTTP %s: %s", status, err_body)
                return BrainReply(text=f"[brain error] HTTP {status}: {err_body}", raw=err_body)
        except httpx.HTTPError as e:
            detail = _http_error_detail(e)
            log.error("LLM stream HTTP error: %s", detail)
            return BrainReply(text=f"[brain error] {detail}", raw=detail)

        duration_ms = (time.perf_counter() - t0) * 1000.0

        if loop_truncated and on_delta:
            # Tell the consumer we cut. Optional — the UI already has the text.
            try:
                on_delta("")  # marker no-op
            except Exception:
                pass

        raw_text = "".join(text_parts)
        tool_calls: list[ToolCall] = []
        for idx in sorted(tc_acc.keys()):
            slot = tc_acc[idx]
            try:
                args = json.loads(slot["args"] or "{}")
            except json.JSONDecodeError:
                args = {}
            tool_calls.append(ToolCall(
                name=slot["name"],
                args=args,
                raw=json.dumps(slot),
                call_id=slot["id"] or None,
            ))

        # ReAct fallback if no native tool calls came through
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        clean = _strip_artifacts(raw_text)
        usage = _usage_from_response(
            last_chunk,
            model=self.active_model,
            completion_text=clean,
            duration_ms=duration_ms,
        )
        return BrainReply(
            text=clean,
            tool_calls=tool_calls,
            raw=raw_text,
            finish_reason=finish_reason,
            reasoning=_extract_reasoning(raw_text),
            usage=usage,
        )

    # ------------------------------------------------------------------
    async def _chat_anthropic(
        self,
        messages: list[dict[str, str]],
        tool_schemas: list[dict],
    ) -> BrainReply:
        url = self.mc.endpoint.rstrip("/") + "/v1/messages"
        headers = {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
        }
        if self.mc.api_key:
            headers["x-api-key"] = self.mc.api_key

        # Anthropic separates system message from messages
        system_text = ""
        conv: list[dict[str, Any]] = []
        for m in messages:
            if m["role"] == "system":
                system_text += ("\n" if system_text else "") + m["content"]
            else:
                conv.append({"role": m["role"], "content": m["content"]})

        payload: dict[str, Any] = {
            "model": self.active_model,
            "system": system_text,
            "messages": conv,
            "max_tokens": self.mc.max_tokens,
            "temperature": self.mc.temperature,
        }
        if self.mc.native_tool_calls and tool_schemas:
            payload["tools"] = [
                {
                    "name": s["name"],
                    "description": s.get("description", ""),
                    "input_schema": s.get("parameters", {"type": "object"}),
                }
                for s in tool_schemas
            ]

        try:
            resp = await self._client.post(url, json=payload, headers=headers)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            log.error("Anthropic HTTP error: %s", e)
            return BrainReply(text=f"[brain error] {e}", raw=str(e))

        data = resp.json()
        text_parts: list[str] = []
        tool_calls: list[ToolCall] = []
        for block in data.get("content", []):
            t = block.get("type")
            if t == "text":
                text_parts.append(block.get("text", ""))
            elif t == "tool_use":
                tool_calls.append(
                    ToolCall(
                        name=block.get("name", ""),
                        args=block.get("input", {}) or {},
                        raw=json.dumps(block),
                        call_id=block.get("id"),
                    )
                )

        raw_text = "".join(text_parts)
        if not tool_calls:
            tool_calls = _parse_react_tool_calls(raw_text)

        return BrainReply(
            text=_strip_artifacts(raw_text),
            tool_calls=tool_calls,
            raw=raw_text,
            finish_reason=data.get("stop_reason"),
        )


def _detect_repetition_loop(text: str) -> int | None:
    """Return the cut index (keep text[:cut]) if back-to-back repetition is
    detected in the last 240 chars, else None.

    Examples that trigger:
      "it appears you are holding, it appears you are holding, it appears you are holding"
      "abc abc abc abc"
    """
    # Frequency-count detector. Strict back-to-back matching misses real
    # loops because the last repetition is often truncated mid-phrase
    # ("X, X, X, X" — last X has no trailing punctuation). Instead, count
    # how many times each candidate substring from early-in-the-tail
    # appears anywhere in the tail. ≥4 → loop.
    n = len(text)
    if n < 60:
        return None
    tail = text[-400:]
    base = n - len(tail)
    # Try medium-length probes first; tighter probes catch shorter loops.
    for size in (40, 30, 24, 20, 17, 14):
        if size * 4 > len(tail):
            continue
        # Sample candidate segs from the first ~120 chars of the tail in
        # 5-char steps. Anything that repeats 4+ times anywhere in tail
        # is a clear degenerate loop.
        for start in range(0, min(120, len(tail) - size * 3), 5):
            seg = tail[start:start + size]
            if not seg.strip():
                continue
            tokens = seg.split()
            if len(tokens) < 2 or sum(len(t) for t in tokens) < 8:
                continue
            if tail.count(seg) >= 4:
                # Keep first instance — cut right after it ends.
                first = tail.find(seg)
                return base + first + size


def _normalise_messages(messages: list[dict]) -> list[dict[str, Any]]:
    """Pass through `tool_calls`, `tool_call_id`, `name`, and multimodal
    `content` arrays (text + image_url parts) so multi-hop and vision both
    work with strict OpenAI-compatible servers (Ollama, vLLM, OpenAI)."""
    out: list[dict[str, Any]] = []
    for m in messages:
        entry: dict[str, Any] = {"role": m.get("role", "user")}
        if "content" in m:
            entry["content"] = m["content"]
        # If caller attached images, lift into OpenAI multimodal format.
        attach = m.get("attachments") or []
        if attach:
            parts: list[dict[str, Any]] = []
            if isinstance(entry.get("content"), str) and entry["content"]:
                parts.append({"type": "text", "text": entry["content"]})
            for a in attach:
                if not isinstance(a, dict):
                    continue
                if a.get("type") == "image" and a.get("data_url"):
                    parts.append({"type": "image_url", "image_url": {"url": a["data_url"]}})
            if parts:
                entry["content"] = parts
        for k in ("tool_calls", "tool_call_id", "name"):
            if k in m:
                entry[k] = m[k]
        out.append(entry)
    return out


def _parse_react_tool_calls(text: str) -> list[ToolCall]:
    calls: list[ToolCall] = []
    for m in TOOL_CALL_RE.finditer(text or ""):
        payload = m.group(1).strip()
        try:
            obj = json.loads(payload)
        except json.JSONDecodeError:
            continue
        name = obj.get("name") or obj.get("tool")
        args = obj.get("args") or obj.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {"_raw": args}
        if name:
            calls.append(ToolCall(name=name, args=args, raw=m.group(0)))
    if calls:
        return calls

    for m in XML_TOOL_RE.finditer(text or ""):
        name = m.group("name").strip()
        if name.lower() in {"thinking", "tool_call"}:
            continue
        body = m.group("body").strip()
        args: dict[str, Any]
        try:
            parsed = json.loads(body)
            args = parsed if isinstance(parsed, dict) else {"_raw": parsed}
        except json.JSONDecodeError:
            args = _args_from_legacy_tool_tag(name, body)
        calls.append(ToolCall(name=name, args=args, raw=m.group(0)))
    return calls


def _args_from_legacy_tool_tag(name: str, body: str) -> dict[str, Any]:
    if name == "web_search":
        return {"query": body, "max_results": 5}
    if name == "web_fetch":
        return {"url": body}
    if name in {"read_file", "list_dir", "scan_project"}:
        return {"path": body}
    if name in {"shell", "run_shell", "shell_command"}:
        return {"command": body}
    return {"_raw": body}


def _strip_artifacts(text: str) -> str:
    if not text:
        return ""
    text = TOOL_CALL_RE.sub("", text)
    text = XML_TOOL_RE.sub(
        lambda m: "" if m.group("name").lower() != "thinking" else m.group(0),
        text,
    )
    text = THOUGHT_RE.sub("", text)
    return text.strip()


def _extract_reasoning(text: str) -> str:
    if not text:
        return ""
    parts = [m.group(1).strip() for m in THOUGHT_RE.finditer(text) if m.group(1).strip()]
    return "\n\n".join(parts)


def _estimate_tokens(text: str) -> int:
    if not text:
        return 0
    # Rough char→token heuristic used when the provider omits usage.
    return max(1, len(text) // 4)


def _usage_from_response(
    data: dict[str, Any] | None,
    *,
    model: str,
    completion_text: str = "",
    duration_ms: float = 0.0,
) -> BrainUsage:
    """Normalize OpenAI `usage`, llama.cpp `timings`, or estimate locally."""
    data = data or {}
    usage_raw = data.get("usage") or {}
    timings = data.get("timings") or {}

    prompt_n = int(
        usage_raw.get("prompt_tokens")
        or usage_raw.get("input_tokens")
        or timings.get("prompt_n")
        or usage_raw.get("prompt_eval_count")
        or 0
    )
    completion_n = int(
        usage_raw.get("completion_tokens")
        or usage_raw.get("output_tokens")
        or timings.get("predicted_n")
        or usage_raw.get("eval_count")
        or 0
    )
    total_n = int(usage_raw.get("total_tokens") or (prompt_n + completion_n) or 0)
    cache_n = int(
        timings.get("cache_n")
        or usage_raw.get("prompt_tokens_details", {}).get("cached_tokens")
        or 0
    )

    pred_ms = float(timings.get("predicted_ms") or 0.0)
    prompt_ms = float(timings.get("prompt_ms") or 0.0)
    if duration_ms <= 0 and (pred_ms or prompt_ms):
        duration_ms = pred_ms + prompt_ms

    tps = float(timings.get("predicted_per_second") or 0.0)
    pps = float(timings.get("prompt_per_second") or 0.0)
    if tps <= 0 and completion_n and duration_ms > 0:
        # Prefer decode-only ms when available.
        decode_ms = pred_ms if pred_ms > 0 else duration_ms
        tps = completion_n / (decode_ms / 1000.0) if decode_ms > 0 else 0.0
    if pps <= 0 and prompt_n and prompt_ms > 0:
        pps = prompt_n / (prompt_ms / 1000.0)

    if completion_n <= 0 and completion_text:
        completion_n = _estimate_tokens(completion_text)
        if total_n <= 0:
            total_n = prompt_n + completion_n
        if tps <= 0 and duration_ms > 0:
            tps = completion_n / (duration_ms / 1000.0)

    context_used = prompt_n + cache_n + completion_n
    if context_used <= 0:
        context_used = total_n

    return BrainUsage(
        prompt_tokens=prompt_n,
        completion_tokens=completion_n,
        total_tokens=total_n or (prompt_n + completion_n),
        duration_ms=duration_ms,
        tokens_per_second=tps,
        prompt_per_second=pps,
        cache_tokens=cache_n,
        context_used=context_used,
        model=model or str(data.get("model") or ""),
    )
