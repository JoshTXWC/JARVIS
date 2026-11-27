"""Detect file paths mentioned in a user message and pre-read them.

Used to ground answers like "explain jarvis/core/brain.py" or "change the
greeting in ~/JARVIS-Projects/demo/hello.py" — the content is injected into
the system prompt for that turn, so even small local models work from the
real file instead of guessing. Reads go through the same path guard as the
read tools (no .env / key files, only allowed roots) and are secret-redacted.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

from .path_guard import PathDenied, assert_readable, expand, extra_write_roots
from .secrets import redact_text

_PATH_RE = re.compile(
    r"""(?<![\w@])                       # not part of an email / word
    (?:[A-Za-z]:[\\/]|~[\\/]|\.{1,2}[\\/]|[\\/])?   # optional anchor
    (?:[\w.\-]+[\\/])*                  # folders
    [\w\-][\w.\-]*\.[A-Za-z0-9]{1,8}    # file.ext
    (?![\w/\\])""",
    re.VERBOSE,
)
_SKIP_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".mp3", ".mp4", ".wav", ".zip", ".exe",
             ".dll", ".onnx", ".gguf", ".safetensors", ".bin", ".pt", ".pdf", ".glb", ".ico", ".db"}


def find_file_refs(text: str, cfg, limit: int = 3) -> list[Path]:
    out: list[Path] = []
    roots = [Path(cfg.project_root)] + [Path(r) for r in extra_write_roots()]
    for m in _PATH_RE.finditer(text or ""):
        raw = m.group(0).strip("'\"`.,;:()")
        if not raw or raw.lower().startswith(("http", "www.")) or "://" in raw:
            continue
        if Path(raw).suffix.lower() in _SKIP_EXT:
            continue
        cands = []
        p = expand(raw)
        if os.path.isabs(os.path.expanduser(raw)):
            cands.append(p)
        else:
            cands += [r / raw for r in roots]
        for c in cands:
            try:
                ok = assert_readable(str(c), cfg.project_root)
            except PathDenied:
                continue
            if ok.is_file() and ok not in out:
                out.append(ok)
                break
        if len(out) >= limit:
            break
    return out


def referenced_files_block(text: str, cfg, budget_chars: int = 6000) -> str:
    files = find_file_refs(text, cfg)
    if not files:
        return ""
    per = max(800, budget_chars // len(files))
    parts = ["Files the user referenced (already read for you — use these exact contents; "
             "line numbers are for reference only and are not part of the file):"]
    for f in files:
        try:
            lines = f.read_text(encoding="utf-8", errors="replace").splitlines()
        except OSError:
            continue
        body, used = [], 0
        for i, line in enumerate(lines, 1):
            row = f"{i:>4}  {line}"
            if used + len(row) > per:
                body.append(f"... ({len(lines) - i + 1} more lines — call read_code for the rest)")
                break
            body.append(row)
            used += len(row) + 1
        parts.append(f'<file path="{f}">\n' + "\n".join(body) + "\n</file>")
    return redact_text("\n\n".join(parts))
