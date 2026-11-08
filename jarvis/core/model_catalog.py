"""Curated LLM catalog, hardware fit scoring, and smart auto-routing.

The command-bar model switcher surfaces this catalog (not a raw Ollama dump)
with skill tags and run requirements. When the selected model is `auto`,
`pick_model_for()`:

  1. Caps candidates to what this PC can actually run (VRAM / CPU budget)
  2. Only then picks by the intelligence the question needs, inside that pool
"""
from __future__ import annotations

import logging
import re
import shutil
from typing import Any

log = logging.getLogger("jarvis.model_catalog")

# Special switcher id — routes per request instead of locking one model.
AUTO_MODEL_ID = "auto"

# Headroom so Whisper / Electron / OS don't get OOM'd by the LLM.
_GPU_COMFORT_RATIO = 0.72
_GPU_TIGHT_RATIO = 0.92
# No discrete GPU — keep Ollama on CPU-friendly sizes only.
_CPU_VRAM_BUDGET_GB = 3.2

# Curated assortment. `vram_gb` is approximate Q4/Q5 Ollama footprint.
CATALOG: list[dict[str, Any]] = [
    {
        "id": AUTO_MODEL_ID,
        "label": "Smart Auto",
        "skill": "adaptive",
        "skill_label": "Routes by question",
        "vram_gb": 0,
        "ram_gb": 8,
        "tier": "auto",
        "best_for": ["mixed workloads", "everyday use", "low-GPU PCs"],
        "needs": "PC-safe pool first, then routes by question intelligence",
        "pull": None,
        "tool_calling": "varies",
        "recommended": True,
        "summary": "Respects your GPU/CPU limits, then picks intelligence for the question.",
        "intel": 0,
    },
    {
        "id": "qwen2.5:1.5b",
        "label": "Qwen 2.5 1.5B",
        "skill": "speed",
        "skill_label": "Ultra-fast replies",
        "vram_gb": 1.5,
        "ram_gb": 4,
        "tier": "light",
        "best_for": ["greetings", "short answers", "weak GPUs"],
        "needs": "Ollama · ~1.5 GB VRAM (or CPU)",
        "pull": "ollama pull qwen2.5:1.5b",
        "tool_calling": "weak",
        "recommended": True,
        "summary": "Smallest Qwen — snappy, limited tool use.",
        "intel": 1,
    },
    {
        "id": "gemma2:2b",
        "label": "Gemma 2 2B",
        "skill": "speed",
        "skill_label": "Light & quick",
        "vram_gb": 2.0,
        "ram_gb": 6,
        "tier": "light",
        "best_for": ["chat", "summaries", "low VRAM"],
        "needs": "Ollama · ~2 GB VRAM (or CPU)",
        "pull": "ollama pull gemma2:2b",
        "tool_calling": "weak",
        "recommended": True,
        "summary": "Google's small model — fluent chat, light tools.",
        "intel": 2,
    },
    {
        "id": "llama3.2:3b",
        "label": "Llama 3.2 3B",
        "skill": "balanced",
        "skill_label": "Balanced general",
        "vram_gb": 2.5,
        "ram_gb": 8,
        "tier": "light",
        "best_for": ["general chat", "light PC control"],
        "needs": "Ollama · ~2.5 GB VRAM",
        "pull": "ollama pull llama3.2:3b",
        "tool_calling": "ok",
        "recommended": True,
        "summary": "Good everyday balance on low-GPU machines.",
        "intel": 3,
    },
    {
        "id": "qwen2.5:3b",
        "label": "Qwen 2.5 3B",
        "skill": "balanced",
        "skill_label": "Best low-GPU pick",
        "vram_gb": 2.8,
        "ram_gb": 8,
        "tier": "light",
        "best_for": ["tool calls", "chat", "low GPU"],
        "needs": "Ollama · ~3 GB VRAM",
        "pull": "ollama pull qwen2.5:3b",
        "tool_calling": "good",
        "recommended": True,
        "summary": "Recommended JARVIS starter for weak GPUs.",
        "intel": 4,
    },
    {
        "id": "phi3:mini",
        "label": "Phi-3 Mini",
        "skill": "balanced",
        "skill_label": "Efficient reasoning",
        "vram_gb": 2.8,
        "ram_gb": 8,
        "tier": "light",
        "best_for": ["reasoning", "Q&A", "compact installs"],
        "needs": "Ollama · ~3 GB VRAM",
        "pull": "ollama pull phi3:mini",
        "tool_calling": "ok",
        "recommended": True,
        "summary": "Microsoft mini — strong for its size.",
        "intel": 4,
    },
    {
        "id": "qwen2.5-coder:3b",
        "label": "Qwen Coder 3B",
        "skill": "coding",
        "skill_label": "Light coding",
        "vram_gb": 2.8,
        "ram_gb": 8,
        "tier": "light",
        "best_for": ["small code edits", "scripts", "debug hints"],
        "needs": "Ollama · ~3 GB VRAM",
        "pull": "ollama pull qwen2.5-coder:3b",
        "tool_calling": "good",
        "recommended": True,
        "summary": "Coding-tuned without a heavy GPU.",
        "intel": 5,
    },
    {
        "id": "qwen2.5:7b",
        "label": "Qwen 2.5 7B",
        "skill": "tools",
        "skill_label": "Strong tool use",
        "vram_gb": 5.5,
        "ram_gb": 12,
        "tier": "medium",
        "best_for": ["JARVIS tools", "multi-step tasks", "agents"],
        "needs": "Ollama · ~5–6 GB VRAM (8 GB+ GPU ideal)",
        "pull": "ollama pull qwen2.5:7b",
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Default full JARVIS model when VRAM allows.",
        "intel": 7,
    },
    {
        "id": "qwen2.5-coder:7b",
        "label": "Qwen Coder 7B",
        "skill": "coding",
        "skill_label": "Serious coding",
        "vram_gb": 5.5,
        "ram_gb": 12,
        "tier": "medium",
        "best_for": ["refactors", "debugging", "code generation"],
        "needs": "Ollama · ~5–6 GB VRAM",
        "pull": "ollama pull qwen2.5-coder:7b",
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Best coding specialist in the assortment.",
        "intel": 8,
    },
    {
        "id": "llama3.1:8b",
        "label": "Llama 3.1 8B",
        "skill": "tools",
        "skill_label": "General power",
        "vram_gb": 6.0,
        "ram_gb": 14,
        "tier": "medium",
        "best_for": ["general assistant", "longer context"],
        "needs": "Ollama · ~6 GB VRAM",
        "pull": "ollama pull llama3.1:8b",
        "tool_calling": "good",
        "recommended": False,
        "summary": "Capable all-rounder; heavier than Qwen 3B.",
        "intel": 7,
    },
    {
        "id": "qwen2.5:14b",
        "label": "Qwen 2.5 14B",
        "skill": "reasoning",
        "skill_label": "Deep reasoning",
        "vram_gb": 10.0,
        "ram_gb": 20,
        "tier": "heavy",
        "best_for": ["complex plans", "analysis", "hard questions"],
        "needs": "Ollama · ~10+ GB VRAM (12–16 GB GPU)",
        "pull": "ollama pull qwen2.5:14b",
        "tool_calling": "excellent",
        "recommended": False,
        "summary": "Heavyweight — only if your GPU has headroom.",
        "intel": 10,
    },
    # ── Cloud (xAI Grok) — no local VRAM; needs XAI_API_KEY ──────────────
    {
        "id": "grok-4",
        "label": "Grok 4",
        "skill": "reasoning",
        "skill_label": "Cloud · flagship",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "xAI",
        "endpoint": "https://api.x.ai/v1",
        "api_key_env": "XAI_API_KEY",
        "best_for": ["hard questions", "tools", "when local GPU is weak"],
        "needs": "Cloud · xAI API key (XAI_API_KEY in .env) · https://console.x.ai",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "xAI Grok 4 — strong cloud model; bypasses your local GPU limits.",
        "intel": 11,
    },
    {
        "id": "grok-4-fast-non-reasoning",
        "label": "Grok 4 Fast",
        "skill": "tools",
        "skill_label": "Cloud · fast",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "xAI",
        "endpoint": "https://api.x.ai/v1",
        "api_key_env": "XAI_API_KEY",
        "best_for": ["snappy chat", "tool calls", "everyday cloud use"],
        "needs": "Cloud · xAI API key (XAI_API_KEY in .env) · https://console.x.ai",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Faster Grok 4 variant — good cloud daily driver for JARVIS.",
        "intel": 9,
    },
    {
        "id": "grok-3-mini",
        "label": "Grok 3 Mini",
        "skill": "balanced",
        "skill_label": "Cloud · light",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "xAI",
        "endpoint": "https://api.x.ai/v1",
        "api_key_env": "XAI_API_KEY",
        "best_for": ["cheaper cloud calls", "quick answers"],
        "needs": "Cloud · xAI API key (XAI_API_KEY in .env) · may redirect on newer accounts",
        "pull": None,
        "tool_calling": "good",
        "recommended": False,
        "summary": "Smaller Grok cloud option when you want lower cost / latency.",
        "intel": 6,
    },
    # ── Cloud (Google Gemini) — OpenAI-compatible route; needs GEMINI_API_KEY ─
    # Note (2026): gemini-2.5-* is blocked for many new API keys ("no longer
    # available to new users"). Prefer 3.x / *-latest ids from the live catalog.
    {
        "id": "gemini-3.1-flash-lite",
        "label": "Gemini 3.1 Flash-Lite",
        "skill": "tools",
        "skill_label": "Cloud · fast",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "Google",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "best_for": ["everyday cloud use", "tool calls", "when local GPU is weak"],
        "needs": "Cloud · Gemini API key (GEMINI_API_KEY in .env) · https://aistudio.google.com/app/apikey",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Google Gemini 3.1 Flash-Lite — reliable cloud daily driver for JARVIS.",
        "intel": 9,
    },
    {
        "id": "gemini-flash-lite-latest",
        "label": "Gemini Flash-Lite Latest",
        "skill": "balanced",
        "skill_label": "Cloud · light",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "Google",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "best_for": ["cheaper cloud calls", "quick answers"],
        "needs": "Cloud · Gemini API key (GEMINI_API_KEY in .env) · https://aistudio.google.com/app/apikey",
        "pull": None,
        "tool_calling": "good",
        "recommended": True,
        "summary": "Always-current Gemini Flash-Lite pointer from Google.",
        "intel": 8,
    },
    {
        "id": "gemini-3.5-flash",
        "label": "Gemini 3.5 Flash",
        "skill": "tools",
        "skill_label": "Cloud · fast",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "Google",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "best_for": ["everyday cloud use", "tool calls"],
        "needs": "Cloud · Gemini API key (GEMINI_API_KEY in .env) · https://aistudio.google.com/app/apikey",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Google Gemini 3.5 Flash — strong general cloud model.",
        "intel": 10,
    },
    {
        "id": "gemini-pro-latest",
        "label": "Gemini Pro Latest",
        "skill": "reasoning",
        "skill_label": "Cloud · flagship",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "Google",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "best_for": ["hard questions", "planning", "deep tool workflows"],
        "needs": "Cloud · Gemini API key (GEMINI_API_KEY in .env) · https://aistudio.google.com/app/apikey",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": True,
        "summary": "Always-current Gemini Pro pointer — use when Flash is not enough.",
        "intel": 12,
    },
    {
        "id": "gemini-flash-latest",
        "label": "Gemini Flash Latest",
        "skill": "tools",
        "skill_label": "Cloud · fast",
        "vram_gb": 0,
        "ram_gb": 0,
        "tier": "cloud",
        "cloud": True,
        "provider_label": "Google",
        "endpoint": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key_env": "GEMINI_API_KEY",
        "best_for": ["everyday cloud use", "when 3.x ids shift"],
        "needs": "Cloud · Gemini API key (GEMINI_API_KEY in .env) · https://aistudio.google.com/app/apikey",
        "pull": None,
        "tool_calling": "excellent",
        "recommended": False,
        "summary": "Always-current Gemini Flash pointer from Google.",
        "intel": 9,
    },
]

# Default local route restored when leaving a cloud model.
LOCAL_ENDPOINT_DEFAULT = "http://localhost:11434/v1"
LOCAL_API_KEY_ENV_DEFAULT = "OLLAMA_API_KEY"

# Ideal models for each skill (highest intelligence first where it matters).
# Smart Auto only considers entries that already passed the PC budget filter.
_SKILL_PREFS: dict[str, list[str]] = {
    "speed": [
        "qwen2.5:1.5b",
        "gemma2:2b",
        "llama3.2:3b",
        "qwen2.5:3b",
        "phi3:mini",
    ],
    "balanced": [
        "qwen2.5:7b",
        "qwen2.5:3b",
        "llama3.2:3b",
        "phi3:mini",
        "llama3.1:8b",
        "gemma2:2b",
        "qwen2.5:1.5b",
    ],
    "tools": [
        "qwen2.5:7b",
        "llama3.1:8b",
        "qwen2.5:3b",
        "qwen2.5-coder:7b",
        "phi3:mini",
        "llama3.2:3b",
    ],
    "coding": [
        "qwen2.5-coder:7b",
        "qwen2.5-coder:3b",
        "qwen2.5:7b",
        "qwen2.5:3b",
        "llama3.1:8b",
    ],
    "reasoning": [
        "qwen2.5:14b",
        "qwen2.5:7b",
        "llama3.1:8b",
        "phi3:mini",
        "qwen2.5:3b",
    ],
}

# Target intelligence score by skill — pick closest capable model at/under budget.
_SKILL_TARGET_INTEL: dict[str, int] = {
    "speed": 1,
    "balanced": 4,
    "tools": 7,
    "coding": 8,
    "reasoning": 10,
}

_SKILL_LABELS = {
    "speed": "Ultra-fast replies",
    "balanced": "Balanced general",
    "tools": "Strong tool use",
    "coding": "Coding",
    "reasoning": "Deep reasoning",
}

_CATALOG_BY_ID = {m["id"]: m for m in CATALOG}


def is_cloud_model(model_id: str) -> bool:
    entry = _CATALOG_BY_ID.get((model_id or "").strip())
    return bool(entry and entry.get("cloud"))


def catalog_entry(model_id: str) -> dict[str, Any] | None:
    return _CATALOG_BY_ID.get((model_id or "").strip())


def cloud_key_configured(entry: dict[str, Any]) -> bool:
    import os

    env_name = (entry.get("api_key_env") or "").strip()
    return bool(env_name and os.environ.get(env_name, "").strip())


def resolve_model_route(
    model_id: str,
    *,
    local_endpoint: str | None = None,
    local_api_key_env: str | None = None,
) -> dict[str, Any]:
    """Return {model, endpoint, api_key_env, cloud} for a switcher selection."""
    mid = (model_id or "").strip()
    entry = catalog_entry(mid)
    if entry and entry.get("cloud"):
        return {
            "model": mid,
            "endpoint": entry.get("endpoint") or "https://api.x.ai/v1",
            "api_key_env": entry.get("api_key_env") or "XAI_API_KEY",
            "cloud": True,
            "provider_label": entry.get("provider_label") or "cloud",
        }
    return {
        "model": mid or "auto",
        "endpoint": (local_endpoint or LOCAL_ENDPOINT_DEFAULT).rstrip("/"),
        "api_key_env": local_api_key_env or LOCAL_API_KEY_ENV_DEFAULT,
        "cloud": False,
        "provider_label": "local",
    }

_CODE_RE = re.compile(
    r"\b(code|coding|debug|refactor|typescript|javascript|python|function|"
    r"class|compile|stack\s*trace|bug|lint|unittest|regex|sql|api\s*route|"
    r"implement|script|dockerfile|git)\b",
    re.I,
)
_REASON_RE = re.compile(
    r"\b(analy[sz]e|compare|trade-?offs?|architect|design\s+a|plan\s+(?:out|this|a)|"
    r"why\s+(?:does|is|are|did)|deep\s+dive|reason\s+about|pros\s+and\s+cons|"
    r"evaluate|critique|multi-?step|strategy)\b",
    re.I,
)
_TOOL_RE = re.compile(
    r"\b(search|browse|open|fetch|generate|create\s+(?:an?\s+)?image|remember|"
    r"recall|webcam|screenshot|run|launch|install|download|file|folder|"
    r"terminal|shell|news|video|3d|hologram|populate|show\s+me)\b",
    re.I,
)
_GREETING_RE = re.compile(
    r"^\s*(hi|hello|hey|yo|sup|good\s+(?:morning|afternoon|evening)|"
    r"how\s+are\s+you|thanks|thank\s+you|cheers|bye|goodbye|"
    r"what(?:'s|\s+is)\s+up)\b[\s,.!?]*$",
    re.I,
)


def _system_ram_gb() -> float | None:
    """Total system RAM in GB. Best-effort."""
    try:
        import psutil  # type: ignore

        return float(psutil.virtual_memory().total) / (1024.0**3)
    except Exception:  # noqa: BLE001
        pass
    try:
        import ctypes

        class _MEMORYSTATUSEX(ctypes.Structure):
            _fields_ = [
                ("dwLength", ctypes.c_ulong),
                ("dwMemoryLoad", ctypes.c_ulong),
                ("ullTotalPhys", ctypes.c_ulonglong),
                ("ullAvailPhys", ctypes.c_ulonglong),
                ("ullTotalPageFile", ctypes.c_ulonglong),
                ("ullAvailPageFile", ctypes.c_ulonglong),
                ("ullTotalVirtual", ctypes.c_ulonglong),
                ("ullAvailVirtual", ctypes.c_ulonglong),
                ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
            ]

        stat = _MEMORYSTATUSEX()
        stat.dwLength = ctypes.sizeof(_MEMORYSTATUSEX)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
            return float(stat.ullTotalPhys) / (1024.0**3)
    except Exception:  # noqa: BLE001
        pass
    return None


def _vendor_from_adapter(name: str, pnp: str = "") -> str | None:
    blob = f"{name} {pnp}".upper()
    if "VEN_10DE" in blob or "NVIDIA" in blob:
        return "nvidia"
    if "VEN_1002" in blob or "AMD" in blob or "RADEON" in blob:
        return "amd"
    if "VEN_8086" in blob or "INTEL" in blob or "ARC" in blob or "UHD" in blob or "IRIS" in blob:
        return "intel"
    if "MICROSOFT" in blob or "BASIC DISPLAY" in blob or "REMOTE" in blob:
        return None
    return "other"


def _shared_vram_estimate_gb(adapter_ram_bytes: float | None) -> tuple[float, bool]:
    """Estimate usable VRAM for UMA / iGPU adapters.

    Windows often reports ~512 MB dedicated for AMD/Intel iGPUs even though
    they share system RAM. Use reported RAM when it looks real; otherwise
    estimate a conservative slice of system RAM.
    """
    reported = None
    if adapter_ram_bytes and adapter_ram_bytes > 0:
        # AdapterRAM is unsigned; some drivers overflow to ~4GB-1.
        reported = float(adapter_ram_bytes) / (1024.0**3)
        if reported > 32:
            reported = None
    if reported is not None and reported >= 2.0:
        return reported, False
    ram = _system_ram_gb() or 8.0
    # ~25% of system RAM, clamped — keeps Smart Auto on light models for 16 GB laptops.
    shared = min(6.0, max(2.0, ram * 0.25))
    return shared, True


def _detect_windows_gpu() -> dict[str, Any] | None:
    """Probe Win32_VideoController for AMD / Intel / other non-NVIDIA GPUs."""
    try:
        import json
        import subprocess

        cmd = (
            "Get-CimInstance Win32_VideoController | "
            "Select-Object Name,AdapterRAM,PNPDeviceID | ConvertTo-Json -Compress"
        )
        out = subprocess.check_output(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", cmd],
            timeout=5,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        data = json.loads(out or "null")
        if not data:
            return None
        adapters = data if isinstance(data, list) else [data]
    except Exception as e:  # noqa: BLE001
        log.debug("windows gpu probe failed: %s", e)
        return None

    scored: list[tuple[int, dict[str, Any]]] = []
    for ad in adapters:
        name = str(ad.get("Name") or "").strip()
        if not name:
            continue
        pnp = str(ad.get("PNPDeviceID") or "")
        vendor = _vendor_from_adapter(name, pnp)
        if vendor is None:
            continue
        # Prefer discrete-looking adapters, then AMD, then Intel, then other.
        score = 10
        upper = name.upper()
        if any(tok in upper for tok in ("RX ", "RTX", "GTX", "ARC", "PRO W", "RADEON RX")):
            score += 50
        if vendor == "amd":
            score += 30
        elif vendor == "intel":
            score += 20
        elif vendor == "nvidia":
            score += 40
        vram_gb, shared = _shared_vram_estimate_gb(ad.get("AdapterRAM"))
        scored.append((score, {
            "vram_gb": vram_gb,
            "gpu_name": name,
            "vendor": vendor,
            "shared_memory": shared,
            "has_gpu": True,
        }))
    if not scored:
        return None
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1]


def detect_gpu() -> dict[str, Any]:
    """Best-effort GPU probe for NVIDIA and Windows AMD/Intel adapters.

    Returns keys: vram_gb, gpu_name, vendor, shared_memory, has_gpu.
    """
    empty = {
        "vram_gb": None,
        "gpu_name": None,
        "vendor": None,
        "shared_memory": False,
        "has_gpu": False,
    }
    try:
        import pynvml  # type: ignore

        pynvml.nvmlInit()
        h = pynvml.nvmlDeviceGetHandleByIndex(0)
        mem = pynvml.nvmlDeviceGetMemoryInfo(h)
        name = pynvml.nvmlDeviceGetName(h)
        if isinstance(name, bytes):
            name = name.decode("utf-8", "replace")
        return {
            "vram_gb": mem.total / 1e9,
            "gpu_name": str(name),
            "vendor": "nvidia",
            "shared_memory": False,
            "has_gpu": True,
        }
    except Exception:  # noqa: BLE001
        pass

    smi = shutil.which("nvidia-smi")
    if smi:
        try:
            import subprocess

            out = subprocess.check_output(
                [smi, "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                timeout=2,
                text=True,
                stderr=subprocess.DEVNULL,
            )
            line = out.strip().splitlines()[0]
            parts = [p.strip() for p in line.split(",")]
            if len(parts) >= 2:
                return {
                    "vram_gb": float(parts[1]) / 1024.0,
                    "gpu_name": parts[0],
                    "vendor": "nvidia",
                    "shared_memory": False,
                    "has_gpu": True,
                }
        except Exception as e:  # noqa: BLE001
            log.debug("nvidia-smi probe failed: %s", e)

    win = _detect_windows_gpu()
    if win:
        return win
    return empty


def detect_gpu_vram() -> tuple[float | None, str | None]:
    """Return (vram_gb, gpu_name). Best-effort; never raises."""
    info = detect_gpu()
    return info.get("vram_gb"), info.get("gpu_name")


def classify_skill(text: str) -> str:
    """Map a user question to a catalog skill bucket."""
    t = (text or "").strip()
    if not t:
        return "balanced"
    if len(t) < 48 and _GREETING_RE.match(t):
        return "speed"
    if _CODE_RE.search(t):
        return "coding"
    if _REASON_RE.search(t) or len(t) > 280:
        return "reasoning"
    if _TOOL_RE.search(t):
        return "tools"
    if len(t) < 40:
        return "speed"
    return "balanced"


def pc_vram_budget(gpu_total_gb: float | None, *, tight: bool = False) -> float:
    """Max model footprint this PC should load.

    Comfort budget leaves headroom; tight budget is a last-resort expand.
    """
    if gpu_total_gb is None or gpu_total_gb <= 0:
        return _CPU_VRAM_BUDGET_GB
    ratio = _GPU_TIGHT_RATIO if tight else _GPU_COMFORT_RATIO
    return float(gpu_total_gb) * ratio


def fit_for_vram(vram_needed: float, gpu_total_gb: float | None) -> str:
    """Return fits | tight | heavy | cpu for a model vs detected GPU."""
    if vram_needed <= 0:
        return "fits"
    if gpu_total_gb is None or gpu_total_gb <= 0:
        # No discrete VRAM reported — keep light models; Ollama may still use iGPU.
        if vram_needed <= _CPU_VRAM_BUDGET_GB:
            return "cpu"
        return "heavy"
    if vram_needed <= pc_vram_budget(gpu_total_gb, tight=False):
        return "fits"
    if vram_needed <= pc_vram_budget(gpu_total_gb, tight=True):
        return "tight"
    return "heavy"


def _normalize_id(mid: str) -> str:
    return (mid or "").strip().lower()


def _installed_set(installed_ids: list[str]) -> set[str]:
    return {_normalize_id(i) for i in installed_ids if i}


def _id_match(candidate: str, installed: set[str]) -> str | None:
    """Return the installed id that matches candidate (exact or tag-prefix)."""
    c = _normalize_id(candidate)
    if c in installed:
        # Prefer exact casing from installed list via reverse lookup later.
        return c
    # Allow `qwen2.5:7b` to match `qwen2.5:7b-instruct-q4_K_M` style tags.
    for inst in installed:
        if inst == c or inst.startswith(c + "-") or inst.startswith(c + ":"):
            return inst
        # Also match when installed is bare family and candidate has tag.
        if c.startswith(inst + ":"):
            return inst
    return None


def enrich_catalog(
    *,
    installed_ids: list[str],
    gpu_total_gb: float | None,
    gpu_name: str | None = None,
    selected: str | None = None,
    gpu_vendor: str | None = None,
    shared_memory: bool = False,
) -> dict[str, Any]:
    """Build the API payload for the model switcher."""
    installed = _installed_set(installed_ids)
    # Preserve original casing for display of installed ids.
    installed_display = { _normalize_id(i): i for i in installed_ids if i }
    has_gpu = bool(gpu_name) or bool(gpu_total_gb and gpu_total_gb > 0)

    models: list[dict[str, Any]] = []
    for entry in CATALOG:
        mid = entry["id"]
        is_auto = mid == AUTO_MODEL_ID
        is_cloud = bool(entry.get("cloud"))
        matched = None if is_auto or is_cloud else _id_match(mid, installed)
        if is_cloud:
            key_ok = cloud_key_configured(entry)
            fit = "fits"
            env_name = entry.get("api_key_env") or "API_KEY"
            fit_label = (
                "Cloud · no local GPU needed"
                if key_ok
                else f"Needs {env_name}"
            )
            installed_flag = key_ok
        else:
            fit = "fits" if is_auto else fit_for_vram(float(entry["vram_gb"]), gpu_total_gb)
            fit_label = {
                "fits": "Fits this PC",
                "tight": "Tight on this GPU",
                "heavy": "Needs more VRAM",
                "cpu": (
                    "Light model · shared / iGPU OK"
                    if has_gpu
                    else "CPU / no GPU detected"
                ),
            }.get(fit, fit)
            installed_flag = is_auto or matched is not None
        models.append({
            **entry,
            "installed": installed_flag,
            "installed_id": installed_display.get(matched, mid) if matched else mid,
            "fit": fit,
            "fit_label": fit_label,
            "active": _normalize_id(selected or "") == _normalize_id(mid),
            "section": "cloud" if is_cloud else ("auto" if is_auto else "local"),
        })

    # Extra installed Ollama models not in the curated list.
    catalog_ids = {_normalize_id(m["id"]) for m in CATALOG}
    extras: list[dict[str, Any]] = []
    for raw in installed_ids:
        nid = _normalize_id(raw)
        if not nid or nid in catalog_ids or nid == AUTO_MODEL_ID:
            continue
        # Skip if already represented via prefix match against catalog.
        if any(
            _id_match(c["id"], {nid})
            for c in CATALOG
            if c["id"] != AUTO_MODEL_ID and not c.get("cloud")
        ):
            continue
        extras.append({
            "id": raw,
            "label": raw,
            "skill": "custom",
            "skill_label": "Installed locally",
            "vram_gb": 0,
            "ram_gb": 0,
            "tier": "custom",
            "best_for": ["local install"],
            "needs": "Already installed in Ollama",
            "pull": None,
            "tool_calling": "unknown",
            "recommended": False,
            "summary": "Detected on your Ollama endpoint — not in the curated list.",
            "installed": True,
            "installed_id": raw,
            "fit": "fits",
            "fit_label": "Installed",
            "active": _normalize_id(selected or "") == nid,
            "section": "local",
            "cloud": False,
        })

    # Recommended strip: local fits + cloud (always PC-safe) when key present.
    recommended = [
        m for m in models
        if m.get("recommended") and (
            (m.get("cloud") and m.get("installed"))
            or (not m.get("cloud") and m["fit"] in ("fits", "cpu", "tight"))
        )
    ]
    cloud_ids = [m["id"] for m in models if m.get("cloud")]

    return {
        "selected": selected or "",
        "auto": _normalize_id(selected or "") == AUTO_MODEL_ID,
        "hardware": {
            "gpu_name": gpu_name,
            "vram_gb": gpu_total_gb,
            "has_gpu": has_gpu,
            "vendor": gpu_vendor,
            "shared_memory": bool(shared_memory),
        },
        "models": models + extras,
        "recommended_ids": [m["id"] for m in recommended],
        "cloud_ids": cloud_ids,
        "skills": [
            {"id": "adaptive", "label": "Routes by question"},
            {"id": "speed", "label": "Ultra-fast replies"},
            {"id": "balanced", "label": "Balanced general"},
            {"id": "tools", "label": "Strong tool use"},
            {"id": "coding", "label": "Coding"},
            {"id": "reasoning", "label": "Deep reasoning"},
            {"id": "custom", "label": "Installed locally"},
        ],
    }


def _pc_safe_pool(
    installed_ids: list[str],
    gpu_total_gb: float | None,
) -> tuple[list[dict[str, Any]], float, str]:
    """Build the PC-capable candidate pool (catalog ∩ installed ∩ budget).

    Returns (pool, budget_gb, pool_quality) where pool_quality is
    'comfort' | 'tight' | 'any'.
    """
    installed = _installed_set(installed_ids)
    installed_display = {_normalize_id(i): i for i in installed_ids if i}
    comfort = pc_vram_budget(gpu_total_gb, tight=False)
    tight = pc_vram_budget(gpu_total_gb, tight=True)

    def _collect(budget: float) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for entry in CATALOG:
            mid = entry["id"]
            if mid == AUTO_MODEL_ID or entry.get("cloud"):
                continue  # Smart Auto stays on local PC-safe models
            matched = _id_match(mid, installed)
            if not matched:
                continue
            need = float(entry.get("vram_gb") or 0)
            if need > budget:
                continue
            out.append({
                **entry,
                "installed_id": installed_display.get(matched, matched),
                "fit": fit_for_vram(need, gpu_total_gb),
            })
        return out

    pool = _collect(comfort)
    if pool:
        return pool, comfort, "comfort"

    pool = _collect(tight)
    if pool:
        return pool, tight, "tight"

    # Absolute last resort: any installed local catalog model, lightest first.
    pool = []
    for entry in CATALOG:
        mid = entry["id"]
        if mid == AUTO_MODEL_ID or entry.get("cloud"):
            continue
        matched = _id_match(mid, installed)
        if not matched:
            continue
        pool.append({
            **entry,
            "installed_id": installed_display.get(matched, matched),
            "fit": fit_for_vram(float(entry.get("vram_gb") or 0), gpu_total_gb),
        })
    pool.sort(key=lambda m: float(m.get("vram_gb") or 0))
    return pool, comfort, "any"


def pick_model_for(
    text: str,
    *,
    installed_ids: list[str],
    gpu_total_gb: float | None,
    fallback: str | None = None,
) -> dict[str, Any]:
    """PC capability first, then question intelligence inside that pool.

    1. Cap candidates to what this machine can run.
    2. Score desired intelligence from the question skill.
    3. Prefer skill-matched models that fit; never exceed the PC budget
       just because the question is hard.
    """
    skill = classify_skill(text)
    target_intel = _SKILL_TARGET_INTEL.get(skill, 4)
    prefs = _SKILL_PREFS.get(skill, _SKILL_PREFS["balanced"])
    pool, budget, pool_quality = _pc_safe_pool(installed_ids, gpu_total_gb)
    by_id = {m["id"]: m for m in pool}

    chosen_entry: dict[str, Any] | None = None

    # Prefer explicit skill prefs that are already in the PC-safe pool.
    for mid in prefs:
        if mid in by_id:
            chosen_entry = by_id[mid]
            break

    # Otherwise pick the pool member closest to the target intelligence
    # without going over it when possible; if all are weaker, take the
    # strongest PC-safe option.
    if chosen_entry is None and pool:
        under_or_eq = [m for m in pool if int(m.get("intel") or 0) <= target_intel]
        candidates = under_or_eq or pool
        # Closest to target; for speed prefer smaller, else prefer smarter.
        if skill == "speed":
            chosen_entry = min(candidates, key=lambda m: int(m.get("intel") or 0))
        else:
            chosen_entry = min(
                candidates,
                key=lambda m: (
                    abs(int(m.get("intel") or 0) - target_intel),
                    -int(m.get("intel") or 0),
                ),
            )

    # Non-catalog installed fallback (still never invent a heavy id).
    if chosen_entry is None:
        for raw in installed_ids:
            n = _normalize_id(raw)
            if not n or "embed" in n or "whisper" in n:
                continue
            return {
                "model": raw,
                "skill": skill,
                "skill_label": _SKILL_LABELS.get(skill, skill),
                "reason": (
                    f"PC budget ~{budget:.1f} GB VRAM ({pool_quality}); "
                    f"question={skill}; using installed {raw}"
                ),
                "budget_gb": round(budget, 2),
                "pool_quality": pool_quality,
                "target_intel": target_intel,
            }
        return {
            "model": fallback or "qwen2.5:3b",
            "skill": skill,
            "skill_label": _SKILL_LABELS.get(skill, skill),
            "reason": f"no installed models; fallback ({skill})",
            "budget_gb": round(budget, 2),
            "pool_quality": pool_quality,
            "target_intel": target_intel,
        }

    actual_intel = int(chosen_entry.get("intel") or 0)
    capped = actual_intel < target_intel
    gpu_bit = (
        f"{gpu_total_gb:.1f} GB GPU → budget {budget:.1f} GB"
        if gpu_total_gb and gpu_total_gb > 0
        else f"no discrete VRAM → budget {budget:.1f} GB"
    )
    reason = (
        f"{gpu_bit} ({pool_quality}); question={skill} "
        f"(want intel {target_intel}, using {actual_intel}"
        f"{', capped by PC' if capped else ''})"
    )

    return {
        "model": chosen_entry["installed_id"],
        "skill": skill,
        "skill_label": _SKILL_LABELS.get(skill, skill),
        "reason": reason,
        "budget_gb": round(budget, 2),
        "pool_quality": pool_quality,
        "target_intel": target_intel,
        "model_intel": actual_intel,
        "capped_by_pc": capped,
    }
