"""First-run setup + health check ("doctor") for JARVIS.

    python -m jarvis.bootstrap            # set up: Ollama, chat model, embeddings, voice
    python -m jarvis.bootstrap --check    # report only, change nothing
    python -m jarvis.bootstrap --no-pull  # skip model downloads

Steps (each is best-effort and never aborts the others):
  1. Ollama reachable? Start `ollama serve` if installed but stopped.
  2. Configured chat model installed? If not, pull it — or, if it's the stock
     default and this PC can do better, pick a model sized for the GPU and
     write it to config.yaml.
  3. Embedding model for semantic memory (nomic-embed-text).
  4. JARVIS Piper voice (data/voices/jarvis.onnx) from huggingface.co/jgkawell/jarvis.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

import httpx

from .config import DEFAULT_CONFIG_PATH, load_config
from .core import ollama

VOICE_BASE = "https://huggingface.co/jgkawell/jarvis/resolve/main/en/en_GB/jarvis/medium/"
VOICE_FILES = {"jarvis-medium.onnx": "jarvis.onnx", "jarvis-medium.onnx.json": "jarvis.onnx.json"}

# (min VRAM GB, model) — tool-calling Ollama models, best first.
HARDWARE_PICKS: list[tuple[float, str]] = [
    (10.0, "qwen2.5:14b"),
    (6.0, "qwen2.5:7b"),
    (3.0, "qwen2.5:3b"),
    (0.0, "qwen2.5:1.5b"),
]
STOCK_DEFAULTS = {"qwen2.5:1.5b", "local-model", ""}


def _p(tag: str, msg: str) -> None:
    print(f"[{tag:<6}] {msg}", flush=True)


def pick_model_for_hardware(vram_gb: float | None, ram_gb: float | None = None) -> str:
    """Largest tool-capable model that fits the GPU (or RAM when CPU-only)."""
    budget = vram_gb if vram_gb else 0.0
    if not budget and ram_gb:
        # CPU inference: be conservative — big models are painfully slow on CPU.
        budget = 3.0 if ram_gb >= 16 else 0.0
    for need, model in HARDWARE_PICKS:
        if budget >= need:
            return model
    return HARDWARE_PICKS[-1][1]


def set_config_model(name: str, path: Path = DEFAULT_CONFIG_PATH) -> bool:
    text = path.read_text(encoding="utf-8")
    new, n = re.subn(r"(?m)^(model:\s*\n(?:[ \t].*\n|\s*\n)*?  model:\s*)([^\n#]+)", lambda m: m.group(1) + name, text, count=1)
    if n:
        path.write_text(new, encoding="utf-8")
    return bool(n)


def _norm(n: str) -> str:
    n = (n or "").strip().lower()
    return n if ":" in n else f"{n}:latest"


async def _pull(base: str, name: str) -> bool:
    _p("model", f"pulling {name} (first time can take a while)…")
    last = -10.0
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, read=None)) as c:
            async with c.stream("POST", f"{base}/api/pull", json={"model": name, "stream": True}) as r:
                if r.status_code >= 400:
                    _p("model", f"pull failed: HTTP {r.status_code} {(await r.aread())[:200]!r}")
                    return False
                import json as _json
                async for line in r.aiter_lines():
                    if not line.strip():
                        continue
                    ev = _json.loads(line)
                    if ev.get("error"):
                        _p("model", f"pull failed: {ev['error']}")
                        return False
                    if ev.get("total"):
                        pct = 100.0 * (ev.get("completed") or 0) / ev["total"]
                        if pct - last >= 10 or pct >= 100:
                            last = pct
                            _p("model", f"  {name}: {pct:5.1f}% of {ev['total'] / 1e9:.2f} GB")
        _p("model", f"{name} ready")
        return True
    except Exception as e:  # noqa: BLE001
        _p("model", f"pull failed: {e}")
        return False


def fetch_voice(cfg, check: bool) -> None:
    dest_model = cfg.abs_path(cfg.voice.piper_model)
    if dest_model.exists() and Path(str(dest_model) + ".json").exists():
        _p("voice", f"JARVIS Piper voice present ({dest_model.name})")
        return
    if check:
        _p("voice", "JARVIS Piper voice missing (Edge British voice will be used as fallback)")
        return
    dest_model.parent.mkdir(parents=True, exist_ok=True)
    for src, dst in VOICE_FILES.items():
        target = dest_model.parent / (dest_model.name if dst == "jarvis.onnx" else dest_model.name + ".json")
        if target.exists():
            continue
        _p("voice", f"downloading {src} …")
        tmp = target.with_suffix(target.suffix + ".part")
        try:
            urllib.request.urlretrieve(VOICE_BASE + src, tmp)  # noqa: S310
            tmp.replace(target)
        except Exception as e:  # noqa: BLE001
            _p("voice", f"download failed ({e}); Edge voice will be used instead")
            try:
                tmp.unlink()
            except OSError:
                pass
            return
    _p("voice", "JARVIS Piper voice installed")


async def run(check: bool = False, pull: bool = True) -> int:
    cfg = load_config()
    problems = 0
    base = ollama.native_base(cfg)
    _p("llm", f"endpoint {cfg.model.endpoint} · model {cfg.model.model}")
    is_ollama = "11434" in (cfg.model.endpoint or "")
    if is_ollama:
        if not await ollama.is_up(base):
            if check:
                _p("ollama", "not running")
            else:
                _p("ollama", f"starting: {await ollama.ensure_running(cfg)}")
        ver = await ollama.version(base)
        if not ver:
            problems += 1
            exe = ollama.find_ollama_binary()
            _p("ollama", "NOT RUNNING — " + ("start the Ollama app" if exe else
                                             "install it from https://ollama.com/download (or: winget install Ollama.Ollama)"))
        else:
            _p("ollama", f"running v{ver} at {base}")
            installed = {_norm(m["name"]) for m in await ollama.list_installed(base)}
            want = cfg.model.model
            if want.strip().lower() == "auto":
                _p("model", "Smart Auto mode — skipping single-model check")
            elif _norm(want) in installed:
                _p("model", f"{want} installed")
            else:
                from .core.model_catalog import _system_ram_gb, detect_gpu
                gpu = detect_gpu()
                pick = want
                if want in STOCK_DEFAULTS:
                    pick = pick_model_for_hardware(gpu.get("vram_gb"), _system_ram_gb())
                    _p("model", f"GPU: {gpu.get('gpu_name') or 'none'} ({gpu.get('vram_gb') or 0:.1f} GB) → recommended {pick}")
                if check or not pull:
                    problems += 1
                    _p("model", f"{want} is NOT installed — run: ollama pull {pick}")
                elif await _pull(base, pick):
                    if pick != want and set_config_model(pick):
                        _p("model", f"config.yaml → model: {pick}")
                else:
                    problems += 1
            embed = getattr(cfg.ultimate, "embed_model", "") or ""
            if cfg.ultimate.enabled and cfg.ultimate.semantic_memory and embed:
                if _norm(embed) in installed:
                    _p("memory", f"embedding model {embed} installed")
                elif check or not pull:
                    _p("memory", f"{embed} missing — semantic memory falls back to keywords (ollama pull {embed})")
                else:
                    await _pull(base, embed)
        if not os.environ.get("OLLAMA_CONTEXT_LENGTH"):
            _p("ollama", "tip: OLLAMA_CONTEXT_LENGTH is not set (Ollama default 4096). setup.bat sets 8192.")
    else:
        try:
            async with httpx.AsyncClient(timeout=5.0) as c:
                r = await c.get(cfg.model.endpoint.rstrip("/") + "/models",
                                headers={"Authorization": f"Bearer {cfg.model.api_key}"} if cfg.model.api_key else {})
            _p("llm", f"endpoint answered HTTP {r.status_code}")
        except Exception as e:  # noqa: BLE001
            problems += 1
            _p("llm", f"endpoint not reachable: {e}")

    fetch_voice(cfg, check)

    try:
        import faster_whisper  # noqa: F401
        _p("stt", "faster-whisper installed (model downloads on first use)")
    except Exception:  # noqa: BLE001
        _p("stt", "faster-whisper missing — voice input disabled (pip install -r requirements.txt)")
    web = cfg.project_root / "web" / "dist" / "index.html"
    _p("web", "UI built" if web.exists() else "UI not built — run: cd web && npm install && npm run build")
    if os.environ.get(cfg.coding.github_token_env or "GITHUB_TOKEN"):
        _p("github", "GITHUB_TOKEN set")
    else:
        _p("github", "no GITHUB_TOKEN in .env (public repos only; needed to push / open PRs)")
    _p("done", "all good" if not problems else f"{problems} item(s) need attention (see above)")
    return 0 if not problems else 1


def main(argv: list[str] | None = None) -> int:
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
        except Exception:  # noqa: BLE001
            pass
    ap = argparse.ArgumentParser(prog="jarvis.bootstrap")
    ap.add_argument("--check", action="store_true", help="report only")
    ap.add_argument("--no-pull", action="store_true", help="don't download models")
    a = ap.parse_args(argv)
    t0 = time.time()
    code = asyncio.run(run(check=a.check, pull=not a.no_pull))
    _p("time", f"{time.time() - t0:.1f}s")
    return code


if __name__ == "__main__":
    sys.exit(main())
