"""Secret detection, redaction, and env-var allowlisting.

Authorization is enforced in code — name heuristics are defense-in-depth only.
Reading credentials is never SAFE.
"""
from __future__ import annotations

import hashlib
import json
import re
from typing import Any

# Harmless configuration variables the env_var tool may return.
ENV_ALLOWLIST: frozenset[str] = frozenset({
    "PATH", "PATHEXT", "HOME", "USERPROFILE", "USERNAME", "USER", "LOGNAME",
    "COMPUTERNAME", "HOSTNAME", "OS", "PROCESSOR_ARCHITECTURE",
    "NUMBER_OF_PROCESSORS", "SystemRoot", "WINDIR", "TEMP", "TMP", "TMPDIR",
    "LANG", "LC_ALL", "TERM", "SHELL", "COMSPEC", "PROMPT",
    "JARVIS_PORT", "JARVIS_HOST", "JARVIS_ENV", "JARVIS_UI_THEME",
    "NODE_ENV", "PYTHONPATH", "VIRTUAL_ENV",
})

# Names matching these patterns are always denied (even if somehow allowlisted).
_SECRET_NAME_RE = re.compile(
    r"(api[_-]?key|secret|token|password|passwd|pwd|credential|cookie|"
    r"auth|bearer|private[_-]?key|access[_-]?key|session|smtp_pass|"
    r"openai|anthropic|gemini|groq|hf_|aws_|azure_)",
    re.IGNORECASE,
)

# Value shapes that look like secrets (redacted in logs/output).
_SECRET_VALUE_RE = re.compile(
    r"(?i)("
    r"sk-[A-Za-z0-9_-]{16,}"
    r"|ghp_[A-Za-z0-9]{20,}"
    r"|xox[baprs]-[A-Za-z0-9-]{10,}"
    r"|Bearer\s+[A-Za-z0-9._\-]{16,}"
    r"|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----"
    r"|AIza[0-9A-Za-z\-_]{20,}"
    r")"
)

_REDACTED = "***REDACTED***"


def is_secret_env_name(name: str) -> bool:
    n = (name or "").strip()
    if not n:
        return True
    if _SECRET_NAME_RE.search(n):
        return True
    # JARVIS_* keys that look like credentials
    if n.upper().startswith("JARVIS_") and _SECRET_NAME_RE.search(n):
        return True
    return False


def env_var_allowed(name: str) -> bool:
    """True only for explicitly allowlisted, non-secret names."""
    n = (name or "").strip()
    if not n or is_secret_env_name(n):
        return False
    if n in ENV_ALLOWLIST:
        return True
    # Safe JARVIS_* non-key config knobs
    up = n.upper()
    if up.startswith("JARVIS_") and not is_secret_env_name(n):
        if any(x in up for x in ("KEY", "TOKEN", "SECRET", "PASS", "AUTH")):
            return False
        return True
    return False


def redact_text(text: str | None) -> str:
    if not text:
        return ""
    return _SECRET_VALUE_RE.sub(_REDACTED, text)


def redact_args(args: dict[str, Any] | None) -> dict[str, Any]:
    """Deep-copy args with secret-looking values and names redacted."""
    if not args:
        return {}
    out: dict[str, Any] = {}
    for k, v in args.items():
        if is_secret_env_name(str(k)):
            out[k] = _REDACTED
        elif isinstance(v, str):
            out[k] = redact_text(v)
        elif isinstance(v, dict):
            out[k] = redact_args(v)
        elif isinstance(v, list):
            out[k] = [
                redact_args(x) if isinstance(x, dict)
                else (redact_text(x) if isinstance(x, str) else x)
                for x in v
            ]
        else:
            out[k] = v
    return out


def canonical_args_hash(args: dict[str, Any] | None) -> str:
    """Stable hash of tool arguments for approval binding."""
    payload = json.dumps(args or {}, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def looks_like_secret_exfil_command(cmd: str) -> bool:
    """Heuristic: shell trying to dump env secrets / credential files."""
    c = (cmd or "").lower()
    needles = (
        "printenv", "env |", "set | find", "get-childitem env:",
        "type .env", "cat .env", "get-content .env",
        "id_rsa", "credentials.json", "aws/credentials",
        "echo %", "$env:", "os.environ", "process.env",
    )
    if any(n in c for n in needles) and any(
        x in c for x in ("key", "token", "secret", "password", "api", "auth", ".env")
    ):
        return True
    if re.search(r"(cat|type|get-content).*\.env\b", c):
        return True
    return False
