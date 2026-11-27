"""Per-turn tool selection for small local models.

JARVIS registers 80+ tools. Sending every JSON schema (plus a prose copy of
the tool list and the full cinematic persona) on every turn costs ~11k
tokens, which overflows Ollama's default 4096-token context window and makes
small models (1.5B-8B) pick the wrong tool. In *lean* prompt mode we send a
compact persona and only the tools that look relevant to the current
request, capped at ``model.max_tools``.

Selection is deterministic and cheap: an always-on core set, a keyword map
from request words to tool groups, a light name/description word match, and
any tool already used earlier in the current turn (so a multi-hop task keeps
the tools it is working with).
"""
from __future__ import annotations

import re
from typing import Iterable
from urllib.parse import urlparse

# Always offered (when registered), in priority order.
CORE_TOOLS: tuple[str, ...] = (
    "web_search",
    "web_fetch",
    "read_file",
    "list_dir",
    "write_file",
    "run_shell",
    "remember",
    "recall",
    "system_status",
)

# request keyword (regex) -> tools to surface
KEYWORD_GROUPS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (r"\b(file|files|folder|folders|directory|dir|desktop|documents|downloads|path)\b",
     ("list_dir", "read_file", "write_file", "search_files", "mkdir", "stat", "copy", "move", "edit_file")),
    (r"\b(delete|remove|erase)\b", ("delete",)),
    (r"\b(github|gh|pull request|pr|prs|issue|issues|clone|commit|push|branch)\b",
     ("github_status", "github_list_repos", "github_get_repo", "github_read_file", "github_list_issues",
      "github_list_pulls", "github_clone", "github_create_pull_request", "git_status", "git_commit_push")),
    (r"\b(code|coding|project|repo|repository|function|class|bug|debug|refactor|explain|script|program|python|node|javascript|typescript)\b",
     ("scan_project", "code_search", "read_file", "edit_file", "write_file", "run_python", "run_node", "code_debug_loop", "run_shell")),
    (r"\b(git)\b", ("git_status", "git_commit_push")),
    (r"\b(run|execute|command|shell|terminal|cmd|install)\b", ("run_shell", "run_powershell", "which", "pip_install", "npm_install")),
    (r"\b(powershell)\b", ("run_powershell",)),
    (r"\b(search|news|latest|look up|lookup|google|find out|weather|price|who is|what is)\b",
     ("web_search", "web_fetch")),
    (r"\b(url|website|page|link|http|https|www)\b", ("web_fetch", "open_inline", "browser_open")),
    (r"\b(browser|chrome|chromium)\b", ("browser_open", "browser_search", "browser_page_text", "browser_click_text", "browser_type", "browser_close")),
    (r"\b(image|images|picture|photo|logo|wallpaper)\b", ("image_search", "image_generate")),
    (r"\b(generate|draw|render|paint)\b", ("image_generate",)),
    (r"\b(3d|hologram|glb|mesh)\b", ("text_to_3d", "image_to_3d")),
    (r"\b(video|videos|youtube|trailer|clip)\b", ("video_search",)),
    (r"\b(webcam|camera|look at me|see me|holding)\b", ("webcam_see", "webcam_show")),
    (r"\b(screen|screenshot|ocr)\b", ("screenshot", "screen_ocr", "ocr_image")),
    (r"\b(remember|memory|memories|recall|forget|note|notes|prefer|preference)\b",
     ("remember", "recall", "forget", "add_note", "list_notes", "search_memory", "memory_galaxy")),
    (r"\b(cpu|ram|gpu|vram|disk|battery|network|process|processes|system|status|uptime)\b",
     ("system_status", "list_processes", "gpu_info", "disk_usage", "network_info", "battery")),
    (r"\b(kill|terminate)\b", ("kill_process", "list_processes")),
    (r"\b(quote)\b", ("daily_quote",)),
    (r"\b(speak|say|listen|microphone|mic)\b", ("speak", "listen", "microphone_status")),
    (r"\b(claude|codex|opencode|agent|delegate)\b", ("agent_backend_run", "agent_backend_status")),
    (r"\b(barehands|hands mode|hand tracking)\b", ("barehands_open", "barehands_close")),
)

_WORD = re.compile(r"[a-z0-9]+")
_STOP = {
    "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "me", "my", "is", "it",
    "this", "that", "with", "what", "can", "you", "please", "jarvis", "i", "do", "show",
}

LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal"}


def is_local_endpoint(endpoint: str) -> bool:
    try:
        host = (urlparse(endpoint or "").hostname or "").lower()
    except ValueError:
        return False
    return host in LOCAL_HOSTS or host.endswith(".local")


def lean_mode(model_cfg) -> bool:
    """True when the compact prompt + tool subset should be used."""
    mode = (getattr(model_cfg, "prompt_mode", "auto") or "auto").strip().lower()
    if mode == "lean":
        return True
    if mode == "full":
        return False
    return is_local_endpoint(getattr(model_cfg, "endpoint", ""))


def select_tools(
    available: Iterable[str],
    user_text: str,
    *,
    descriptions: dict[str, str] | None = None,
    recent_tools: Iterable[str] = (),
    max_tools: int = 14,
    allowlist: Iterable[str] | None = None,
) -> list[str]:
    """Return an ordered subset of ``available`` tool names for this turn."""
    avail = list(dict.fromkeys(available))
    allow = set(allowlist or [])
    if allow:
        avail = [n for n in avail if n in allow]
    avail_set = set(avail)
    picked: list[str] = []

    def add(names: Iterable[str]) -> None:
        for n in names:
            if n in avail_set and n not in picked:
                picked.append(n)

    text = (user_text or "").lower()
    # 1) tools already in play this turn keep their slot
    add(recent_tools)
    # 2) explicit tool name mentioned
    add(n for n in avail if n in text)
    # 3) keyword groups
    for pattern, names in KEYWORD_GROUPS:
        if re.search(pattern, text):
            add(names)
    # 4) word overlap with tool name / description
    words = {w for w in _WORD.findall(text) if w not in _STOP and len(w) > 2}
    if words and descriptions:
        scored: list[tuple[int, str]] = []
        for n in avail:
            if n in picked:
                continue
            bag = set(_WORD.findall(n.replace("_", " "))) | set(
                _WORD.findall((descriptions.get(n) or "").lower()[:240])
            )
            score = len(words & bag)
            if score >= 2 or (score and set(_WORD.findall(n.replace("_", " "))) & words):
                scored.append((score, n))
        scored.sort(key=lambda x: (-x[0], x[1]))
        add(n for _, n in scored[:4])
    # 5) core set fills the rest (and is the whole set for chit-chat)
    add(CORE_TOOLS)
    if allow and not picked:
        add(avail)
    return picked[: max(1, max_tools)]


COMPACT_PERSONA = """You are J.A.R.V.I.S., the user's local AI assistant running on their own Windows PC.
Voice: concise British butler-AI. Address the user as "sir". Short, precise sentences. No emoji.

Rules:
- Use the provided tools to act; never claim to have done something without calling a tool.
- Information, news, facts, prices, "latest X": call web_search (then web_fetch for a specific page).
- Files and folders: list_dir / read_file / write_file. Commands: run_shell (the user must approve it).
- Code: read the relevant files first, explain clearly, then propose or apply precise edits.
- Memory: use remember / recall for the user's preferences and facts.
- If a tool fails, retry once with fixed arguments or explain the specific blocker.
- Ask before destructive operations. After finishing, give a one-line summary."""
