"""Local model manager API (Ollama), modelled on the Ollama desktop app.

  GET  /api/ollama/status         — is Ollama installed / running, version
  POST /api/ollama/start          — start `ollama serve` in the background
  GET  /api/ollama/models         — installed models (+ running, active)
  GET  /api/ollama/library        — curated models you can pull (+ fit/installed)
  GET  /api/ollama/show?model=    — capabilities / context / params
  POST /api/ollama/pull           — {model} start a background pull
  GET  /api/ollama/pulls          — progress of pull jobs
  POST /api/ollama/pull/cancel    — {model}
  POST /api/ollama/delete         — {model} remove from disk
Switching the active chat model reuses POST /api/models/select.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from ..core import ollama

router = APIRouter()

# Popular Ollama library models beyond the curated Smart-Auto catalog.
# (id, label, approx download GB, tags, summary)
LIBRARY_EXTRA: list[tuple[str, str, float, list[str], str]] = [
    ("llama3.2:1b", "Llama 3.2 1B", 1.3, ["tools", "tiny"], "Meta's smallest; fast on CPU."),
    ("qwen3:1.7b", "Qwen 3 1.7B", 1.4, ["tools", "thinking"], "Small reasoning model with tool use."),
    ("qwen3:4b", "Qwen 3 4B", 2.6, ["tools", "thinking"], "Strong small all-rounder; good tool calls."),
    ("qwen3:8b", "Qwen 3 8B", 5.2, ["tools", "thinking"], "Best tool-calling under 8 GB VRAM."),
    ("gemma3:4b", "Gemma 3 4B", 3.3, ["vision"], "Google; sees images. No native tools."),
    ("mistral:7b", "Mistral 7B", 4.1, ["tools"], "Classic 7B with function calling."),
    ("deepseek-r1:7b", "DeepSeek R1 7B", 4.7, ["thinking"], "Reasoning model; slower, no tools."),
    ("gpt-oss:20b", "gpt-oss 20B", 14.0, ["tools", "thinking"], "OpenAI open-weight; needs 16 GB+."),
    ("qwen2.5-coder:14b", "Qwen 2.5 Coder 14B", 9.0, ["tools", "code"], "Big local coder."),
    ("llava:7b", "LLaVA 7B", 4.7, ["vision"], "Image understanding."),
    ("nomic-embed-text", "Nomic Embed Text", 0.27, ["embedding"], "Embeddings for JARVIS semantic memory."),
]

_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._\-/:]{0,120}$")


class ModelBody(BaseModel):
    model: str


def _clean(name: str) -> str | None:
    n = (name or "").strip()
    if n.lower().startswith("ollama pull "):
        n = n[12:].strip()
    return n if _NAME_RE.match(n) else None


def _base(request: Request) -> str:
    return ollama.native_base(request.app.state.cfg)


def _norm(n: str) -> str:
    n = (n or "").strip().lower()
    return n if ":" in n else f"{n}:latest"


@router.get("/ollama/status")
async def ollama_status(request: Request):
    base = _base(request)
    ver = await ollama.version(base)
    cfg = request.app.state.cfg
    return {
        "ok": True,
        "base": base,
        "running": ver is not None,
        "version": ver,
        "installed": ollama.find_ollama_binary() is not None,
        "download_url": "https://ollama.com/download",
        "active_model": cfg.model.model,
        "active_endpoint": cfg.model.endpoint,
    }


@router.post("/ollama/start")
async def ollama_start(request: Request):
    status = await ollama.ensure_running(request.app.state.cfg)
    return {"ok": status in {"running", "started"}, "status": status}


@router.get("/ollama/models")
async def ollama_models(request: Request):
    base = _base(request)
    cfg = request.app.state.cfg
    try:
        installed = await ollama.list_installed(base)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": f"Ollama not reachable at {base}: {e}",
                             "installed": [], "running": []}, status_code=503)
    try:
        running = await ollama.list_running(base)
    except Exception:  # noqa: BLE001
        running = []
    resident = {_norm(r["name"]) for r in running}
    active = _norm(cfg.model.model)
    for m in installed:
        m["running"] = _norm(m["name"]) in resident
        m["active"] = _norm(m["name"]) == active
    return {"ok": True, "installed": installed, "running": running, "active_model": cfg.model.model}


@router.get("/ollama/library")
async def ollama_library(request: Request):
    from ..core.model_catalog import CATALOG, detect_gpu, fit_for_vram

    base = _base(request)
    try:
        installed = {_norm(m["name"]) for m in await ollama.list_installed(base)}
    except Exception:  # noqa: BLE001
        installed = set()
    gpu = detect_gpu()
    vram = gpu.get("vram_gb")
    items: list[dict] = []
    seen: set[str] = set()
    for e in CATALOG:
        pull = e.get("pull")
        if not pull or e.get("cloud"):
            continue
        mid = pull.replace("ollama pull ", "").strip()
        seen.add(mid)
        tags = []
        if e.get("tool_calling") not in (None, "none", "weak"):
            tags.append("tools")
        if "coder" in mid:
            tags.append("code")
        items.append({
            "id": mid,
            "label": e.get("label") or mid,
            "size_gb": e.get("vram_gb"),
            "vram_gb": e.get("vram_gb"),
            "ram_gb": e.get("ram_gb"),
            "tags": tags,
            "summary": e.get("summary") or "",
            "recommended": bool(e.get("recommended")),
            "fit": fit_for_vram(float(e.get("vram_gb") or 0), vram),
            "fit_label": {
                "fits": "Fits this PC",
                "cpu": "Fits (CPU)",
                "tight": "Tight fit",
                "heavy": "May not fit",
            }.get(fit_for_vram(float(e.get("vram_gb") or 0), vram), "Fit unknown"),
            "needs": e.get("needs") or "",
            "installed": _norm(mid) in installed,
        })
    for mid, label, size, tags, summary in LIBRARY_EXTRA:
        if mid in seen:
            continue
        items.append({
            "id": mid, "label": label, "size_gb": size, "tags": tags, "summary": summary,
            "recommended": False, "fit": fit_for_vram(size, vram),
            "installed": _norm(mid) in installed,
        })
    return {"ok": True, "models": items, "hardware": gpu,
            "browse_url": "https://ollama.com/library"}


@router.get("/ollama/show")
async def ollama_show(request: Request, model: str):
    name = _clean(model)
    if not name:
        return JSONResponse({"ok": False, "error": "invalid model name"}, status_code=400)
    try:
        return {"ok": True, **(await ollama.show(_base(request), name))}
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)


@router.post("/ollama/pull")
async def ollama_pull(request: Request, body: ModelBody):
    name = _clean(body.model)
    if not name:
        return JSONResponse({"ok": False, "error": "invalid model name"}, status_code=400)
    base = _base(request)
    if not await ollama.is_up(base):
        return JSONResponse({"ok": False, "error": f"Ollama is not running at {base}"}, status_code=503)
    job = ollama.start_pull(base, name)
    return {"ok": True, "job": job.as_dict()}


@router.get("/ollama/pulls")
async def ollama_pulls():
    return {"ok": True, "jobs": ollama.pull_jobs()}


@router.post("/ollama/pull/cancel")
async def ollama_pull_cancel(body: ModelBody):
    return {"ok": ollama.cancel_pull((body.model or "").strip())}


@router.post("/ollama/delete")
async def ollama_delete(request: Request, body: ModelBody):
    name = _clean(body.model)
    if not name:
        return JSONResponse({"ok": False, "error": "invalid model name"}, status_code=400)
    cfg = request.app.state.cfg
    if _norm(name) == _norm(cfg.model.model):
        return JSONResponse(
            {"ok": False, "error": "That is the active chat model. Switch to another model first."},
            status_code=400,
        )
    try:
        await ollama.delete(_base(request), name)
    except Exception as e:  # noqa: BLE001
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    return {"ok": True, "deleted": name}
