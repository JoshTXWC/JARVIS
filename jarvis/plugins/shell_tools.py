"""Shell command execution with privileged defaults.

run_shell / run_powershell are DANGEROUS (unrestricted command execution).
env_var is CAUTION and allowlisted — never returns secrets.
"""
from __future__ import annotations

import os
import shutil

from ..core.permissions import Permission
from ..core.secrets import env_var_allowed, looks_like_secret_exfil_command, redact_text
from ..utils.shell import run_command
from .base import PluginInfo, tool


def register(registry):
    cfg = registry.cfg
    memory = registry.services.get("memory")

    @tool(
        name="run_shell",
        description=(
            "Run a shell command. Privileged — requires user approval. "
            "cwd defaults to project root; elevated=true requests unrestricted cwd."
        ),
        permission=Permission.DANGEROUS,
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string", "description": "Shell command line."},
                "cwd": {"type": "string", "description": "Working directory.", "default": ""},
                "timeout": {"type": "integer", "default": 60},
                "elevated": {"type": "boolean", "default": False},
            },
            "required": ["command"],
        },
        preview=lambda a: f"shell> {a.get('command','')}",
    )
    async def run_shell(
        command: str, cwd: str = "", timeout: int = 60, elevated: bool = False
    ) -> str:
        if looks_like_secret_exfil_command(command):
            return "DENIED: command resembles secret exfiltration"
        target_cwd = cwd or str(cfg.project_root)
        if not elevated:
            # Stay inside project root unless explicitly elevated + approved
            root = str(cfg.project_root)
            try:
                from ..core.path_guard import assert_writable
                assert_writable(target_cwd or root, cfg.project_root)
            except Exception as e:
                return f"DENIED: {e}"
            target_cwd = root if not cwd else target_cwd
        res = await run_command(command, cwd=target_cwd, timeout=timeout)
        if memory is not None:
            memory.bump_command(command)
        return redact_text(_format_result(res))

    @tool(
        name="run_powershell",
        description="Run a PowerShell command. Privileged — requires user approval.",
        permission=Permission.DANGEROUS,
        parameters={
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "cwd": {"type": "string", "default": ""},
                "timeout": {"type": "integer", "default": 60},
                "elevated": {"type": "boolean", "default": False},
            },
            "required": ["command"],
        },
        preview=lambda a: f"PS> {a.get('command','')}",
    )
    async def run_powershell(
        command: str, cwd: str = "", timeout: int = 60, elevated: bool = False
    ) -> str:
        if looks_like_secret_exfil_command(command):
            return "DENIED: command resembles secret exfiltration"
        target_cwd = cwd or str(cfg.project_root)
        if not elevated:
            root = str(cfg.project_root)
            try:
                from ..core.path_guard import assert_writable
                assert_writable(target_cwd or root, cfg.project_root)
            except Exception as e:
                return f"DENIED: {e}"
            target_cwd = root if not cwd else target_cwd
        res = await run_command(command, cwd=target_cwd, timeout=timeout, shell="powershell")
        if memory is not None:
            memory.bump_command(f"powershell: {command}")
        return redact_text(_format_result(res))

    @tool(
        name="which",
        description="Locate an executable on PATH. Returns its absolute path or empty string.",
        permission=Permission.SAFE,
        parameters={
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
    )
    def which(name: str) -> str:
        return shutil.which(name) or ""

    @tool(
        name="env_var",
        description=(
            "Read an allowlisted environment variable. "
            "Secrets, API keys, tokens, and passwords are never returned."
        ),
        permission=Permission.CAUTION,
        parameters={
            "type": "object",
            "properties": {"name": {"type": "string"}},
            "required": ["name"],
        },
        preview=lambda a: f"env:{a.get('name','')}",
    )
    def env_var(name: str) -> str:
        n = (name or "").strip()
        if not env_var_allowed(n):
            return (
                f"DENIED: environment variable '{n}' is not allowlisted "
                "(secrets and credentials cannot be read via this tool)."
            )
        return os.environ.get(n, "")

    registry.add_pending("shell_tools")
    registry.register_plugin(PluginInfo(
        name="shell_tools",
        description="Shell + PowerShell execution, PATH lookup, env vars.",
        permissions_needed=[Permission.DANGEROUS],
    ))


def _format_result(res) -> str:
    lines = [f"$ {res.cmd}", f"cwd: {res.cwd}", f"returncode: {res.returncode}"]
    if res.timed_out:
        lines.append("TIMED OUT")
    if res.stdout:
        lines.append("--- stdout ---")
        lines.append(_clip(res.stdout, 4000))
    if res.stderr:
        lines.append("--- stderr ---")
        lines.append(_clip(res.stderr, 4000))
    return "\n".join(lines)


def _clip(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + f"\n... [clipped, {len(s)} chars total]"
