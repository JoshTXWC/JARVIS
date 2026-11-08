"""WebSocket bridge — concurrent edition.

The previous version awaited `_stream_brain(...)` inline inside the receive
loop. That meant *while* the brain was streaming, the receive loop was
blocked. When the orchestrator yielded a CONFIRMATION event and awaited the
user's reply, the websocket could no longer receive `confirm` messages —
classic deadlock.

This version runs the brain as a background task and keeps the receive
loop hot, so confirmation replies (and cancellations) flow through
immediately. Each chat also cancels any in-flight chat.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

from ..core.events import Event, EventKind
from ..core.orchestrator import UNINTERRUPTIBLE_TOOLS

log = logging.getLogger("jarvis.ws")

CONFIRM_TIMEOUT_S = 90  # auto-deny after this long if user never answers

HELP_TEXT = (
    "Slash commands:\n"
    "  /help                show this\n"
    "  /reset               wipe conversation history\n"
    "  /cancel              cancel in-flight task\n"
    "  /agent <name>        switch agent persona\n"
    "  /agents              list agents\n"
    "  /tools               list available tools\n"
    "  /image-model [id]    list or select local image model\n"
    "  /protocols           show JARVIS operating profile\n"
    "  /memory <query>      search local memory\n"
    "  /mission <path>      pin a project as the current focus\n"
    "  /cleanslate          Iron-Man style: wipe everything\n"
)


async def websocket_endpoint(ws: WebSocket) -> None:
    from ..core.session_auth import get_session_auth, origin_allowed, trusted_origins

    # Origin validation — mitigate localhost Cross-Site WebSocket Hijacking.
    origin = ws.headers.get("origin")
    if not origin_allowed(origin, trusted_origins()):
        log.warning("ws rejected origin=%s", origin)
        await ws.close(code=1008)
        return

    auth = get_session_auth()
    session_q = ws.query_params.get("session") or ws.headers.get("x-jarvis-session")
    if not auth.check(session_q):
        # Allow accept then require an auth frame within the first message, OR deny.
        # Prefer deny-at-handshake when token missing to reduce attack surface.
        log.warning("ws rejected: missing/invalid session")
        await ws.close(code=1008)
        return

    try:
        await ws.accept()
    except Exception as e:  # noqa: BLE001
        log.info("ws accept aborted by client: %s", e)
        return
    state = ws.app.state
    orchestrator = state.orchestrator
    memory = state.memory
    agents = state.agents
    cfg = state.cfg
    # Bind session to this connection for approval grants.
    session_id = session_q or "ws"
    try:
        orchestrator._session_id = session_id  # noqa: SLF001
    except Exception:
        pass

    # Pending confirmations: id -> (future, grant_token, tool, args)
    pending: dict[str, dict[str, Any]] = {}
    brain_task: asyncio.Task | None = None
    swap_lock = asyncio.Lock()
    send_lock = asyncio.Lock()

    async def safe_send(msg: dict) -> None:
        async with send_lock:
            try:
                await ws.send_json(msg)
            except Exception:  # noqa: BLE001
                pass

    await safe_send({
        "type": "info",
        "text": f"{cfg.A.name} online — {cfg.model.provider}/{cfg.model.model}",
    })

    async def cancel_running(reason: str = "superseded") -> None:
        nonlocal brain_task
        for entry in list(pending.values()):
            fut = entry.get("fut")
            if fut and not fut.done():
                fut.set_result(False)
        pending.clear()
        try:
            orchestrator.permissions.revoke_all_grants()
        except Exception:
            pass
        if brain_task and not brain_task.done():
            brain_task.cancel()
            try:
                await brain_task
            except (asyncio.CancelledError, Exception):
                pass
            await safe_send({"type": "info", "text": f"task cancelled ({reason})"})
        brain_task = None

    async def run_brain(text: str, attachments: list | None = None) -> None:
        try:
            async for ev in orchestrator.handle_user_message(text, attachments=attachments):
                await _emit_event(safe_send, ev, pending)
        except asyncio.CancelledError:
            # Best-effort notify — connection may already be dead. Do NOT
            # re-raise: callers (`await brain_task`) won't expect a
            # CancelledError to escape from a routine teardown.
            await safe_send({"type": "info", "text": "task cancelled"})
            await safe_send({"type": "done"})
        except Exception as e:  # noqa: BLE001
            log.exception("brain error")
            await safe_send({"type": "error", "text": str(e)})
            await safe_send({"type": "done"})

    try:
        while True:
            # State guard — if the client closed during `accept()` or between
            # frames, `receive_json` raises a generic RuntimeError that pollutes
            # the logs. Check first; break cleanly if disconnected.
            if ws.application_state != WebSocketState.CONNECTED:
                log.info("ws no longer connected (state=%s) — closing loop", ws.application_state)
                break
            try:
                msg = await ws.receive_json()
            except WebSocketDisconnect:
                raise
            except RuntimeError as e:
                # Starlette raises this when the socket closed before receive.
                if "WebSocket is not connected" in str(e) or "disconnect" in str(e).lower():
                    log.info("ws closed mid-receive: %s", e)
                    break
                raise
            mtype = msg.get("type")

            if mtype == "ping":
                await safe_send({"type": "pong"})

            elif mtype == "confirm":
                rid = msg.get("id")
                entry = pending.pop(rid, None)
                if entry:
                    fut = entry.get("fut")
                    approved = bool(msg.get("approved"))
                    token = msg.get("token") or ""
                    # Must present the grant token issued with the request.
                    if approved:
                        if token != entry.get("token"):
                            approved = False
                            log.warning("confirm rejected: grant token mismatch for %s", rid)
                    if fut and not fut.done():
                        fut.set_result(approved)

            elif mtype == "kill_switch":
                n = 0
                try:
                    n = orchestrator.permissions.revoke_all_grants()
                except Exception:
                    pass
                try:
                    from ..integrations.desktop_control import get_desktop_control
                    dc = getattr(state, "desktop_control", None) or get_desktop_control(
                        cfg.abs_path("data")
                    )
                    state.desktop_control = dc
                    dc.emergency_stop()
                except Exception:
                    pass
                await cancel_running("kill switch")
                await safe_send({
                    "type": "info",
                    "text": f"emergency stop — revoked {n} grants, cancelled running task",
                })

            elif mtype == "hands_frame":
                # High-rate landmark stream — must stay sync/low-latency.
                # to_thread here backlogged the receive loop and broke pinch/drag.
                try:
                    from ..integrations.desktop_control import get_desktop_control
                    dc = getattr(state, "desktop_control", None) or get_desktop_control(
                        cfg.abs_path("data")
                    )
                    state.desktop_control = dc
                    result = dc.ingest_frame(msg)
                    st = (result or {}).get("status") or {}
                    gesture = st.get("gesture")
                    if (result or {}).get("jarvis_action") or gesture in {
                        "click",
                        "drag_start",
                        "drag_end",
                        "right_click",
                        "pause",
                        "freeze_toggle",
                        "scroll",
                        "swipe_left",
                        "swipe_right",
                        "swipe_up",
                        "swipe_down",
                        "jarvis_menu",
                        "emergency_stop",
                    }:
                        await safe_send({
                            "type": "desktop_control_status",
                            **(result or {}),
                        })
                except Exception as e:  # noqa: BLE001
                    log.debug("hands_frame failed: %s", e)

            elif mtype == "desktop_control":
                try:
                    from ..integrations.desktop_control import get_desktop_control
                    dc = getattr(state, "desktop_control", None) or get_desktop_control(
                        cfg.abs_path("data")
                    )
                    state.desktop_control = dc
                    action = (msg.get("action") or "").strip().lower()
                    if action == "enable":
                        out = dc.set_enabled(bool(msg.get("enabled")))
                    elif action == "mode":
                        out = dc.set_mode(str(msg.get("mode") or "hud"))
                    elif action == "pause":
                        out = dc.set_paused(bool(msg.get("paused")))
                    elif action == "emergency_stop":
                        out = dc.emergency_stop()
                    elif action == "settings":
                        out = dc.update_settings(msg.get("patch") or {})
                    elif action == "status":
                        out = dc.status()
                    else:
                        await safe_send({"type": "error", "text": f"unknown desktop_control action: {action}"})
                        continue
                    await safe_send({"type": "desktop_control_status", **out})
                except Exception as e:  # noqa: BLE001
                    await safe_send({"type": "error", "text": f"desktop_control: {e}"})

            elif mtype == "agent":
                name = msg.get("name", "")
                agent = agents.get(name)
                if agent:
                    orchestrator.set_agent(agent)
                    await safe_send({"type": "info", "text": f"agent active: {name}"})
                else:
                    await safe_send({"type": "error", "text": f"no such agent: {name}"})

            elif mtype == "cancel":
                try:
                    orchestrator.tasks.request_cancel()
                except Exception:
                    pass
                await cancel_running("user request")

            elif mtype == "pause":
                ok = False
                try:
                    ok = orchestrator.tasks.request_pause()
                except Exception:
                    pass
                await safe_send({
                    "type": "task_status",
                    "ok": ok,
                    **orchestrator.tasks.status(),
                })
                if ok:
                    await safe_send({"type": "info", "text": "task paused at next tool boundary"})

            elif mtype == "resume":
                ok = False
                try:
                    ok = orchestrator.tasks.request_resume()
                except Exception:
                    pass
                await safe_send({
                    "type": "task_status",
                    **orchestrator.tasks.status(),
                })
                if ok:
                    await safe_send({"type": "info", "text": "task resumed"})

            elif mtype == "task_status":
                await safe_send({
                    "type": "task_status",
                    **orchestrator.tasks.status(),
                })

            elif mtype == "command":
                line = (msg.get("command") or "").strip()
                await _handle_command(safe_send, line, orchestrator, memory, agents, cfg, cancel_running)

            elif mtype == "chat":
                text = (msg.get("text") or "").strip()
                attachments = msg.get("attachments") or None
                if not text and not attachments:
                    continue
                if text.startswith("/"):
                    await _handle_command(safe_send, text, orchestrator, memory, agents, cfg, cancel_running)
                    continue

                async with swap_lock:
                    if brain_task and not brain_task.done():
                        busy = getattr(orchestrator, "busy_tool", None)
                        if busy in UNINTERRUPTIBLE_TOOLS:
                            # Heavy work in progress (image / 3D gen). Tossing it
                            # mid-load wastes ~30s of GPU + disk I/O, so refuse
                            # the new chat instead of cancelling.
                            await safe_send({
                                "type": "info",
                                "text": f"{busy} in progress — finish then I'll take the next one, sir.",
                            })
                            continue
                        await cancel_running("new request")
                    await safe_send({"type": "user", "text": text, "attachments": attachments})
                    brain_task = asyncio.create_task(run_brain(text, attachments))

            else:
                await safe_send({"type": "error", "text": f"unknown msg type: {mtype}"})

    except WebSocketDisconnect:
        log.info("ws client disconnected")
    except asyncio.CancelledError:
        # Receive-loop itself got cancelled (server shutdown). Just unwind.
        log.info("ws task cancelled")
    except Exception as e:  # noqa: BLE001
        log.exception("ws error")
        try:
            await safe_send({"type": "error", "text": str(e)})
        except Exception:  # noqa: BLE001
            pass
    finally:
        # Always tear down the running task on disconnect.
        if brain_task and not brain_task.done():
            brain_task.cancel()
            try:
                await brain_task
            except (asyncio.CancelledError, Exception):
                # CancelledError is BaseException, not Exception — must list
                # it explicitly. Swallow either; connection is going away.
                pass


async def _handle_command(send, line: str, orchestrator, memory, agents, cfg, cancel_running) -> None:
    parts = line[1:].split(None, 1) if line.startswith("/") else line.split(None, 1)
    cmd = parts[0].lower() if parts else ""
    arg = parts[1] if len(parts) > 1 else ""

    if cmd == "help":
        await send({"type": "assistant", "text": HELP_TEXT})
    elif cmd == "reset":
        orchestrator.reset()
        await send({"type": "info", "text": "conversation history reset"})
    elif cmd == "cancel":
        await cancel_running("user /cancel")
    elif cmd == "cleanslate":
        orchestrator.reset()
        await send({
            "type": "assistant",
            "text": "Clean Slate Protocol executed, sir. Conversation history purged.",
        })
    elif cmd == "agents":
        rows = "\n".join(f"- **{a.name}** — {a.description}" for a in agents.list())
        await send({"type": "assistant", "text": "**Agents**\n" + rows})
    elif cmd == "agent":
        if arg.lower() in {"", "jarvis", "default", "base"}:
            orchestrator.set_agent(None)
            await send({"type": "info", "text": "agent active: jarvis"})
            return
        agent = agents.get(arg)
        if agent:
            orchestrator.set_agent(agent)
            await send({"type": "info", "text": f"agent active: {arg}"})
        else:
            await send({"type": "error", "text": f"no such agent: {arg}"})
    elif cmd == "tools":
        rows = "\n".join(f"- `{t.name}` ({t.permission.value}) — {t.description}" for t in orchestrator.registry.all_tools())
        await send({"type": "assistant", "text": "**Tools**\n" + rows})
    elif cmd in {"image-model", "imagemodel", "imgmodel"}:
        from ..plugins.media_generation import list_image_models, select_image_model
        if not arg:
            state = list_image_models(cfg)
            rows = "\n".join(
                f"- `{m['key']}`{' (selected)' if m['key'] == state['selected'] else ''}: "
                f"{m['label']} - {'downloaded' if m['downloaded'] else 'not downloaded'}"
                for m in state["models"]
            )
            await send({"type": "assistant", "text": "**Image models**\n" + rows})
        else:
            try:
                result = select_image_model(cfg, arg)
                await send({"type": "info", "text": f"image model selected: {result['selected']}"})
            except Exception as e:  # noqa: BLE001
                await send({"type": "error", "text": f"image model selection failed: {e}"})
    elif cmd == "protocols":
        text = (
            "**JARVIS protocols**\n"
            "- Persona: concise British systems assistant; calm, dry, protective.\n"
            f"- Model: `{cfg.model.provider}/{cfg.model.model}`.\n"
            f"- Tools: `{len(orchestrator.registry.all_tools())}` active under `{cfg.permissions.mode}` permissions.\n"
            "- Voice: prefers British male voices, especially Ryan/George/Daniel-class voices.\n"
            "- Safety: asks before destructive operations and refuses reckless commands."
        )
        await send({"type": "assistant", "text": text})
    elif cmd == "memory":
        hits = memory.search(arg, limit=20) if arg else []
        if hits:
            rows = "\n".join(f"- [{h['kind']}] **{h['title']}**: {h['body']}" for h in hits)
            await send({"type": "assistant", "text": "**memory matches**\n" + rows})
        else:
            await send({"type": "info", "text": "no memory matches" if arg else "usage: /memory <query>"})
    elif cmd == "mission":
        from pathlib import Path as _P
        if not arg:
            await send({"type": "info", "text": f"mission: {cfg.mission.project_path or '(none)'}"})
        else:
            p = _P(arg).expanduser().resolve()
            if p.exists():
                cfg.mission.enabled = True
                cfg.mission.project_path = str(p)
                memory.set_path("mission", str(p), "project")
                await send({"type": "info", "text": f"mission locked: {p}"})
            else:
                await send({"type": "error", "text": f"path not found: {p}"})
    else:
        await send({"type": "error", "text": f"unknown command: /{cmd} — try /help"})


async def _emit_event(send, ev: Event, pending: dict[str, asyncio.Future]) -> None:
    # Wrap the underlying send so every outbound message produced by this
    # event automatically picks up the swarm tags (subagent grouping). We
    # MUST capture the original `send` in a different name before shadowing
    # — otherwise tagged_send's closure captures itself and recurses
    # infinitely the first time it's called.
    swarm_id = ev.swarm_id
    swarm_label = ev.swarm_label
    raw_send = send

    async def tagged_send(msg: dict) -> None:
        if swarm_id:
            msg.setdefault("swarm_id", swarm_id)
            if swarm_label:
                msg.setdefault("swarm_label", swarm_label)
        await raw_send(msg)

    send = tagged_send  # shadow within this function only

    if ev.kind is EventKind.ASSISTANT:
        await send({"type": "assistant", "text": ev.text})
    elif ev.kind is EventKind.STREAM_BEGIN:
        await send({"type": "stream_begin"})
    elif ev.kind is EventKind.STREAM_DELTA:
        await send({"type": "stream_delta", "text": ev.text})
    elif ev.kind is EventKind.STREAM_END:
        await send({"type": "stream_end"})
    elif ev.kind is EventKind.THINKING:
        await send({"type": "thinking"})
    elif ev.kind is EventKind.TOOL_PROPOSED:
        await send({
            "type": "tool_proposed",
            "tool": ev.payload.get("tool"),
            "permission": ev.payload.get("permission"),
            "args": ev.payload.get("args", {}),
            "preview": ev.text,
        })
    elif ev.kind is EventKind.TOOL_RESULT:
        await send({
            "type": "tool_result",
            "tool": ev.payload.get("tool"),
            "ok": bool(ev.payload.get("ok")),
            "duration_s": ev.payload.get("duration_s"),
            "text": ev.text,
        })
    elif ev.kind is EventKind.TASK_START:
        await send({"type": "task_start", "text": ev.text})
    elif ev.kind is EventKind.TASK_PROGRESS:
        await send({"type": "task_progress", "text": ev.text, "tool": ev.payload.get("tool")})
    elif ev.kind is EventKind.TASK_END:
        await send({"type": "task_end", "text": ev.text, "ok": bool(ev.payload.get("ok", True))})
    elif ev.kind is EventKind.CONFIRMATION:
        if ev.confirm_req and ev.confirm_future:
            from ..core.secrets import redact_args, redact_text
            rid = uuid.uuid4().hex[:12]
            grant_token = ev.confirm_req.reason  # orchestrator stores grant.token here
            pending[rid] = {
                "fut": ev.confirm_future,
                "token": grant_token,
                "tool": ev.confirm_req.tool,
            }
            await send({
                "type": "confirm_request",
                "id": rid,
                "token": grant_token,
                "tool": ev.confirm_req.tool,
                "permission": ev.confirm_req.permission.value,
                "preview": redact_text(ev.confirm_req.preview),
                "args": redact_args(ev.confirm_req.args),
            })

            async def _timeout(fut: asyncio.Future, rid: str) -> None:
                try:
                    await asyncio.sleep(CONFIRM_TIMEOUT_S)
                    if not fut.done():
                        fut.set_result(False)
                        pending.pop(rid, None)
                        await send({"type": "info", "text": "confirmation timeout — auto-denied"})
                except asyncio.CancelledError:
                    pass
            asyncio.create_task(_timeout(ev.confirm_future, rid))
    elif ev.kind is EventKind.MEDIA:
        msg = {"type": "media"}
        msg.update(ev.payload or {})
        if ev.text and "summary" not in msg:
            msg["summary"] = ev.text
        await send(msg)
    elif ev.kind is EventKind.UI:
        msg = {"type": "ui"}
        msg.update(ev.payload or {})
        if ev.text and "action" not in msg:
            msg["action"] = ev.text
        await send(msg)
    elif ev.kind is EventKind.PLAN:
        await send({"type": "plan", "text": ev.text, "steps": ev.payload.get("steps", [])})
    elif ev.kind is EventKind.SUGGESTIONS:
        await send({"type": "suggestions", "items": ev.payload.get("items", [])})
    elif ev.kind is EventKind.ERROR:
        await send({"type": "error", "text": ev.text})
    elif ev.kind is EventKind.INFO:
        await send({"type": "info", "text": ev.text})
    elif ev.kind is EventKind.DONE:
        await send({"type": "done"})
