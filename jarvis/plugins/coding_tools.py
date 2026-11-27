"""Coding mode tools: search a codebase, read with line numbers, apply
precise edits (with backup + diff preview), and inspect/commit with git.

Writes stay inside the JARVIS folder or the coding workspace
(config `coding.workspace_dir`, default ~/JARVIS-Projects).
"""
from __future__ import annotations

import asyncio
import difflib
import fnmatch
import os
import re
from pathlib import Path

from ..core.path_guard import PathDenied, assert_readable, assert_writable, expand
from ..core.permissions import Permission
from ..core.secrets import redact_text
from ..utils import files as F
from .base import PluginInfo, tool

SKIP_DIRS = {".git", "node_modules", "venv", ".venv", "__pycache__", "dist", "build", ".next", "target", ".idea"}
TEXT_EXT_MAX = 2_000_000  # skip files bigger than this when searching


def _iter_files(root: Path, glob: str):
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS and not d.startswith(".")]
        for fn in filenames:
            if glob and glob != "*" and not fnmatch.fnmatch(fn, glob):
                continue
            yield Path(dirpath) / fn


def _unified(old: str, new: str, name: str, context: int = 2, limit: int = 60) -> str:
    diff = list(difflib.unified_diff(
        old.splitlines(), new.splitlines(), f"a/{name}", f"b/{name}", n=context, lineterm="",
    ))
    if len(diff) > limit:
        diff = diff[:limit] + [f"... ({len(diff) - limit} more diff lines)"]
    return "\n".join(diff)


async def _git(args: list[str], cwd: str, timeout: int = 120, extra_cfg: list[str] | None = None) -> tuple[int, str]:
    argv = ["git"]
    for c in extra_cfg or []:
        argv += ["-c", c]
    argv += args
    try:
        proc = await asyncio.create_subprocess_exec(
            *argv, cwd=cwd,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        )
    except FileNotFoundError:
        return 127, "git is not installed or not on PATH (https://git-scm.com/download/win)"
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return 124, f"git {' '.join(args[:2])} timed out after {timeout}s"
    return proc.returncode or 0, redact_text((out or b"").decode("utf-8", "replace"))


def register(registry):
    cfg = registry.cfg
    root = cfg.project_root
    backup_dir = cfg.abs_path(cfg.backups.dir)
    workspace = expand(cfg.coding.workspace_dir)

    def _resolve(path: str) -> str:
        """Relative paths resolve against the coding workspace if they exist there."""
        p = (path or "").strip()
        if p in {"", "."}:
            return str(root)
        if not os.path.isabs(os.path.expanduser(p)):
            if (root / p).exists():
                return str(root / p)
            if (workspace / p).exists():
                return str(workspace / p)
            return str(root / p)
        return p

    @tool(
        name="code_search",
        description=(
            "Search code for a regex or plain text under a folder (skips .git, node_modules, venv). "
            "Returns file:line: text matches. Use to find where something is defined or used."
        ),
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "pattern": {"type": "string", "description": "Regex or plain text to find."},
                "path": {"type": "string", "description": "Folder to search. Default: JARVIS folder."},
                "glob": {"type": "string", "description": "Filename filter, e.g. *.py", "default": "*"},
                "max_results": {"type": "integer", "default": 60},
            },
            "required": ["pattern"],
        },
    )
    def code_search(pattern: str, path: str = "", glob: str = "*", max_results: int = 60) -> str:
        try:
            base = assert_readable(_resolve(path), root)
        except PathDenied as e:
            return f"DENIED: {e}"
        if not base.exists():
            return f"path does not exist: {base}"
        try:
            rx = re.compile(pattern, re.IGNORECASE)
        except re.error:
            rx = re.compile(re.escape(pattern), re.IGNORECASE)
        hits: list[str] = []
        files = [base] if base.is_file() else _iter_files(base, glob)
        for f in files:
            try:
                if f.stat().st_size > TEXT_EXT_MAX:
                    continue
                with f.open("r", encoding="utf-8", errors="ignore") as fh:
                    for i, line in enumerate(fh, 1):
                        if rx.search(line):
                            rel = f.relative_to(base) if base.is_dir() else f.name
                            hits.append(f"{rel}:{i}: {line.rstrip()[:200]}")
                            if len(hits) >= max_results:
                                return redact_text("\n".join(hits) + f"\n... (stopped at {max_results})")
            except (OSError, UnicodeDecodeError):
                continue
        return redact_text("\n".join(hits)) if hits else f"no matches for {pattern!r} in {base}"

    @tool(
        name="read_code",
        description="Read a source file with line numbers (optionally a line range). Use before editing.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "start": {"type": "integer", "default": 1},
                "end": {"type": "integer", "default": 0, "description": "0 = to end (max 400 lines)"},
            },
            "required": ["path"],
        },
    )
    def read_code(path: str, start: int = 1, end: int = 0) -> str:
        try:
            p = assert_readable(_resolve(path), root)
        except PathDenied as e:
            return f"DENIED: {e}"
        if not p.is_file():
            return f"not a file: {p}"
        lines = F.read_text(p, max_bytes=TEXT_EXT_MAX).splitlines()
        s = max(1, int(start or 1))
        e = int(end or 0) or min(len(lines), s + 399)
        e = min(e, len(lines), s + 399)
        body = "\n".join(f"{i:>5}  {lines[i - 1]}" for i in range(s, e + 1))
        more = f"\n... ({len(lines) - e} more lines)" if e < len(lines) else ""
        return redact_text(f"{p} (lines {s}-{e} of {len(lines)})\n{body}{more}")

    def _edit_preview(a: dict) -> str:
        try:
            p = expand(_resolve(a.get("path", "")))
            old_text = p.read_text(encoding="utf-8") if p.is_file() else ""
            new_text = old_text.replace(a.get("old", ""), a.get("new", ""), 1) if a.get("old") else old_text
            return f"edit {p}\n" + _unified(old_text, new_text, p.name)
        except Exception:  # noqa: BLE001
            return f"edit {a.get('path', '')}"

    @tool(
        name="edit_file",
        description=(
            "Apply a precise edit: replace the exact text `old` with `new` in a file (backup first). "
            "`old` must match the file exactly (copy it from read_code, without line numbers) and be unique "
            "unless replace_all=true. Use empty `old` with create=true to create a new file."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "old": {"type": "string", "description": "Exact existing text to replace."},
                "new": {"type": "string", "description": "Replacement text."},
                "replace_all": {"type": "boolean", "default": False},
                "create": {"type": "boolean", "default": False},
            },
            "required": ["path", "new"],
        },
        preview=_edit_preview,
    )
    def edit_file(path: str, new: str, old: str = "", replace_all: bool = False, create: bool = False) -> str:
        try:
            p = assert_writable(_resolve(path), root)
        except PathDenied as e:
            return f"DENIED: {e}"
        if not p.exists():
            if not create and old:
                return f"file does not exist: {p}"
            F.write_text(p, new)
            return f"created {p} ({len(new)} chars)"
        text = F.read_text(p, max_bytes=TEXT_EXT_MAX * 5)
        if not old:
            return "`old` is required to edit an existing file (or use write_file to overwrite)"
        count = text.count(old)
        if count == 0:
            # Common small-model slip: whitespace differences. Try a
            # whitespace-normalised match on a single region.
            norm = lambda s: re.sub(r"[ \t]+", " ", s.strip())  # noqa: E731
            lines = text.splitlines(keepends=True)
            target = norm(old)
            n_old = max(1, len(old.strip().splitlines()))
            for i in range(len(lines) - n_old + 1):
                chunk = "".join(lines[i:i + n_old])
                if norm(chunk) == target:
                    old = chunk.rstrip("\n") if not old.endswith("\n") else chunk
                    # Keep the file's indentation if the model dropped it.
                    lead = re.match(r"[ \t]*", chunk).group()
                    if lead and not new.startswith((" ", "\t")):
                        new = lead + new
                    count = text.count(old)
                    break
        if count == 0:
            return f"`old` text not found in {p}. Read the file with read_code and copy the exact text."
        if count > 1 and not replace_all:
            return f"`old` text matches {count} places in {p}; add surrounding lines to make it unique or set replace_all=true."
        updated = text.replace(old, new) if replace_all else text.replace(old, new, 1)
        backed = None
        if cfg.backups.enabled:
            backed = F.backup_file(p, backup_dir)
            F.prune_backups(backup_dir, keep=cfg.backups.keep_last)
        F.write_text(p, updated)
        diff = _unified(text, updated, p.name)
        return f"edited {p}" + (f" (backup: {backed.name})" if backed else "") + f"\n{diff}"

    @tool(
        name="git_status",
        description="Show git branch, status, recent commits and diff summary for a repository folder.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Repository folder."},
                "diff": {"type": "boolean", "default": False, "description": "Include the full diff."},
            },
            "required": ["path"],
        },
    )
    async def git_status(path: str, diff: bool = False) -> str:
        try:
            p = assert_readable(_resolve(path), root)
        except PathDenied as e:
            return f"DENIED: {e}"
        parts = []
        for args in (["status", "-sb"], ["log", "--oneline", "-5"], ["diff", "--stat"]):
            code, out = await _git(args, str(p))
            parts.append(f"$ git {' '.join(args)}\n{out.strip()}")
            if code == 127:
                return out
        if diff:
            _, out = await _git(["diff"], str(p))
            parts.append("$ git diff\n" + out[:12000])
        return "\n\n".join(parts)

    @tool(
        name="git_commit_push",
        description=(
            "Commit all changes in a repository on a branch and push it to GitHub (uses GITHUB_TOKEN). "
            "Creates the branch if needed. Never pushes to main/master unless allow_main=true."
        ),
        permission=Permission.DANGEROUS,
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string"},
                "message": {"type": "string"},
                "branch": {"type": "string", "description": "Branch to commit on, e.g. jarvis/fix-login."},
                "push": {"type": "boolean", "default": True},
                "allow_main": {"type": "boolean", "default": False},
            },
            "required": ["path", "message", "branch"],
        },
        preview=lambda a: f"git commit -am {a.get('message','')!r} on {a.get('branch','')} "
                          f"{'+ push' if a.get('push', True) else '(no push)'} in {a.get('path','')}",
    )
    async def git_commit_push(path: str, message: str, branch: str, push: bool = True, allow_main: bool = False) -> str:
        from .github_tools import git_auth_config

        try:
            p = assert_writable(_resolve(path), root)
        except PathDenied as e:
            return f"DENIED: {e}"
        br = (branch or "").strip()
        if not re.match(r"^[A-Za-z0-9._/\-]{1,100}$", br):
            return "invalid branch name"
        if br in {"main", "master"} and not allow_main:
            return "Refusing to commit/push to main/master. Use a feature branch (or allow_main=true if the user insists)."
        log: list[str] = []
        code, cur = await _git(["rev-parse", "--abbrev-ref", "HEAD"], str(p))
        if code:
            return cur
        if cur.strip() != br:
            code, out = await _git(["checkout", "-B", br], str(p))
            log.append(out.strip())
            if code:
                return "\n".join(log)
        await _git(["add", "-A"], str(p))
        code, out = await _git(["commit", "-m", message], str(p))
        log.append(out.strip())
        if code and "nothing to commit" not in out:
            return "\n".join(log)
        if push:
            extra = git_auth_config(cfg)
            code, out = await _git(["push", "-u", "origin", br], str(p), extra_cfg=extra, timeout=300)
            log.append(out.strip())
            if code:
                log.append("push failed — check GITHUB_TOKEN in .env has repo (contents: write) access")
        return "\n".join(x for x in log if x)

    registry.add_pending("coding_tools")
    registry.register_plugin(PluginInfo(
        name="coding_tools",
        description="Code search, line-numbered reads, precise edits with backups, git status/commit/push.",
        permissions_needed=[Permission.CAUTION, Permission.DANGEROUS],
    ))
