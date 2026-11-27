"""GitHub access with a personal access token (GITHUB_TOKEN in .env).

Read tools are SAFE; cloning is CAUTION; opening a pull request is
DANGEROUS (externally visible) so it always asks first. The token is sent as
an HTTP header and is never written into .git/config or returned to the model.
"""
from __future__ import annotations

import base64
import os
import re

import httpx

from ..core.path_guard import PathDenied, assert_writable, expand
from ..core.permissions import Permission
from ..core.secrets import redact_text
from .base import PluginInfo, tool

_REPO_RE = re.compile(r"^(?:https?://github\.com/)?([A-Za-z0-9_.\-]+)/([A-Za-z0-9_.\-]+?)(?:\.git)?/?$")


def _token(cfg) -> str:
    return os.environ.get(cfg.coding.github_token_env or "GITHUB_TOKEN", "").strip()


def git_auth_config(cfg) -> list[str]:
    """`git -c` values that authenticate https://github.com with the token
    without persisting it (same technique as actions/checkout)."""
    tok = _token(cfg)
    if not tok:
        return []
    basic = base64.b64encode(f"x-access-token:{tok}".encode()).decode()
    return [f"http.https://github.com/.extraheader=AUTHORIZATION: basic {basic}"]


def parse_repo(repo: str) -> tuple[str, str] | None:
    m = _REPO_RE.match((repo or "").strip())
    return (m.group(1), m.group(2)) if m else None


def register(registry):
    cfg = registry.cfg
    api = (cfg.coding.github_api or "https://api.github.com").rstrip("/")

    def _headers() -> dict:
        h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
             "User-Agent": "JARVIS-local"}
        tok = _token(cfg)
        if tok:
            h["Authorization"] = f"Bearer {tok}"
        return h

    async def _get(path: str, params: dict | None = None):
        async with httpx.AsyncClient(timeout=20.0) as c:
            r = await c.get(f"{api}{path}", headers=_headers(), params=params)
        if r.status_code == 401:
            raise RuntimeError("GitHub rejected the token (401). Check GITHUB_TOKEN in .env.")
        if r.status_code == 404:
            raise RuntimeError("Not found (404) — check the repo name, or the token lacks access to it.")
        if r.status_code >= 400:
            raise RuntimeError(f"GitHub API {r.status_code}: {r.text[:200]}")
        return r.json()

    def _need_repo(repo: str) -> tuple[str, str]:
        pr = parse_repo(repo)
        if not pr:
            raise RuntimeError("repo must look like owner/name or https://github.com/owner/name")
        return pr

    @tool(
        name="github_status",
        description="Check GitHub connection: whether GITHUB_TOKEN is set and which account it belongs to.",
        permission=Permission.SAFE,
    )
    async def github_status() -> str:
        if not _token(cfg):
            return ("No GitHub token. Create a fine-grained token at https://github.com/settings/tokens "
                    "(Contents + Pull requests read/write) and set GITHUB_TOKEN=... in .env, then restart JARVIS.")
        try:
            me = await _get("/user")
        except Exception as e:  # noqa: BLE001
            return str(e)
        return f"Connected to GitHub as {me.get('login')} ({me.get('name') or 'no name'})."

    @tool(
        name="github_list_repos",
        description="List GitHub repositories for the token's user (or a given owner/org).",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "owner": {"type": "string", "description": "User/org. Empty = your own repos."},
                "limit": {"type": "integer", "default": 20},
            },
        },
    )
    async def github_list_repos(owner: str = "", limit: int = 20) -> str:
        try:
            n = max(1, min(int(limit or 20), 100))
            if owner:
                data = await _get(f"/users/{owner}/repos", {"per_page": n, "sort": "updated"})
            elif _token(cfg):
                data = await _get("/user/repos", {"per_page": n, "sort": "updated", "affiliation": "owner,collaborator"})
            else:
                return "Set GITHUB_TOKEN in .env or pass an owner."
        except Exception as e:  # noqa: BLE001
            return str(e)
        lines = [
            f"- {r['full_name']}{' (private)' if r.get('private') else ''} · {r.get('language') or '-'} · "
            f"updated {str(r.get('updated_at', ''))[:10]} — {(r.get('description') or '')[:80]}"
            for r in data
        ]
        return "\n".join(lines) or "no repositories"

    @tool(
        name="github_get_repo",
        description="Show a GitHub repo's description, default branch, open issues and top-level files.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {"repo": {"type": "string", "description": "owner/name"}},
                    "required": ["repo"]},
    )
    async def github_get_repo(repo: str) -> str:
        try:
            o, n = _need_repo(repo)
            r = await _get(f"/repos/{o}/{n}")
            items = await _get(f"/repos/{o}/{n}/contents/")
        except Exception as e:  # noqa: BLE001
            return str(e)
        files = ", ".join(f"{i['name']}{'/' if i['type'] == 'dir' else ''}" for i in items[:60])
        return (f"{r['full_name']} — {r.get('description') or ''}\n"
                f"default branch: {r.get('default_branch')} · stars {r.get('stargazers_count')} · "
                f"open issues {r.get('open_issues_count')} · {'private' if r.get('private') else 'public'}\n"
                f"top level: {files}")

    @tool(
        name="github_read_file",
        description="Read a file (or list a folder) from a GitHub repo without cloning it.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {
                "repo": {"type": "string", "description": "owner/name"},
                "path": {"type": "string", "default": ""},
                "ref": {"type": "string", "default": "", "description": "Branch, tag or SHA. Empty = default."},
            },
            "required": ["repo"],
        },
    )
    async def github_read_file(repo: str, path: str = "", ref: str = "") -> str:
        try:
            o, n = _need_repo(repo)
            data = await _get(f"/repos/{o}/{n}/contents/{path.lstrip('/')}", {"ref": ref} if ref else None)
        except Exception as e:  # noqa: BLE001
            return str(e)
        if isinstance(data, list):
            return "\n".join(f"{'D' if i['type'] == 'dir' else 'F'} {i['path']}" for i in data)
        if data.get("encoding") == "base64":
            raw = base64.b64decode(data.get("content") or "")
            text = raw.decode("utf-8", "replace")
            if len(text) > 60000:
                text = text[:60000] + "\n... [truncated]"
            return redact_text(text)
        return f"{data.get('path')}: {data.get('type')} ({data.get('size')} bytes) — download: {data.get('download_url')}"

    async def _list(repo: str, kind: str, state: str, limit: int) -> str:
        o, n = _need_repo(repo)
        data = await _get(f"/repos/{o}/{n}/{kind}", {"state": state or "open", "per_page": max(1, min(limit, 50))})
        rows = []
        for it in data:
            if kind == "issues" and it.get("pull_request"):
                continue
            who = (it.get("user") or {}).get("login")
            extra = f" [{it['head']['ref']} → {it['base']['ref']}]" if kind == "pulls" else ""
            rows.append(f"#{it['number']} {it['title']}{extra} — {who} · {it['state']} · {it['html_url']}")
        return "\n".join(rows) or f"no {state} {kind}"

    @tool(
        name="github_list_issues",
        description="List issues in a GitHub repo.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "repo": {"type": "string"}, "state": {"type": "string", "default": "open"},
            "limit": {"type": "integer", "default": 20}}, "required": ["repo"]},
    )
    async def github_list_issues(repo: str, state: str = "open", limit: int = 20) -> str:
        try:
            return await _list(repo, "issues", state, limit)
        except Exception as e:  # noqa: BLE001
            return str(e)

    @tool(
        name="github_list_pulls",
        description="List pull requests in a GitHub repo.",
        permission=Permission.SAFE,
        parameters={"type": "object", "properties": {
            "repo": {"type": "string"}, "state": {"type": "string", "default": "open"},
            "limit": {"type": "integer", "default": 20}}, "required": ["repo"]},
    )
    async def github_list_pulls(repo: str, state: str = "open", limit: int = 20) -> str:
        try:
            return await _list(repo, "pulls", state, limit)
        except Exception as e:  # noqa: BLE001
            return str(e)

    @tool(
        name="github_clone",
        description=(
            "Clone a GitHub repo into the coding workspace (~/JARVIS-Projects by default) so JARVIS can "
            "read, explain and edit it. Pulls latest if it is already cloned."
        ),
        permission=Permission.CAUTION,
        parameters={"type": "object", "properties": {
            "repo": {"type": "string", "description": "owner/name or GitHub URL"},
            "branch": {"type": "string", "default": ""}}, "required": ["repo"]},
        preview=lambda a: f"git clone {a.get('repo','')} → {cfg.coding.workspace_dir}",
    )
    async def github_clone(repo: str, branch: str = "") -> str:
        from .coding_tools import _git

        pr = parse_repo(repo)
        if not pr:
            return "repo must look like owner/name or https://github.com/owner/name"
        o, n = pr
        ws = expand(cfg.coding.workspace_dir)
        dest = ws / n
        try:
            assert_writable(str(dest), cfg.project_root)
        except PathDenied as e:
            return f"DENIED: {e}"
        ws.mkdir(parents=True, exist_ok=True)
        extra = git_auth_config(cfg)
        if (dest / ".git").exists():
            code, out = await _git(["pull", "--ff-only"], str(dest), extra_cfg=extra, timeout=300)
            return f"already cloned at {dest}; git pull:\n{out.strip()}"
        args = ["clone", "--depth", "50"]
        if branch:
            args += ["--branch", branch]
        args += [f"https://github.com/{o}/{n}.git", str(dest)]
        code, out = await _git(args, str(ws), extra_cfg=extra, timeout=600)
        if code:
            return f"clone failed:\n{out.strip()}"
        return f"cloned {o}/{n} to {dest}"

    @tool(
        name="github_create_pull_request",
        description=(
            "Open a pull request on GitHub from a pushed branch (push first with git_commit_push). "
            "Externally visible — the user must approve."
        ),
        permission=Permission.DANGEROUS,
        parameters={"type": "object", "properties": {
            "repo": {"type": "string", "description": "owner/name"},
            "head": {"type": "string", "description": "Branch with the changes."},
            "base": {"type": "string", "default": "", "description": "Target branch. Empty = default branch."},
            "title": {"type": "string"},
            "body": {"type": "string", "default": ""},
            "draft": {"type": "boolean", "default": False}},
            "required": ["repo", "head", "title"]},
        preview=lambda a: f"open PR on {a.get('repo','')}: {a.get('head','')} → {a.get('base') or 'default'} — {a.get('title','')}",
    )
    async def github_create_pull_request(repo: str, head: str, title: str, base: str = "", body: str = "",
                                         draft: bool = False) -> str:
        if not _token(cfg):
            return "Set GITHUB_TOKEN in .env first."
        try:
            o, n = _need_repo(repo)
            if not base:
                base = (await _get(f"/repos/{o}/{n}")).get("default_branch") or "main"
            async with httpx.AsyncClient(timeout=30.0) as c:
                r = await c.post(f"{api}/repos/{o}/{n}/pulls", headers=_headers(), json={
                    "title": title, "head": head, "base": base, "body": body, "draft": bool(draft)})
        except Exception as e:  # noqa: BLE001
            return str(e)
        if r.status_code >= 400:
            return f"GitHub API {r.status_code}: {r.text[:300]}"
        pr = r.json()
        return f"Opened PR #{pr['number']}: {pr['html_url']}"

    registry.add_pending("github_tools")
    registry.register_plugin(PluginInfo(
        name="github_tools",
        description="GitHub via personal access token: repos, files, issues, PRs, clone, open PRs.",
        permissions_needed=[Permission.SAFE, Permission.CAUTION, Permission.DANGEROUS],
    ))
