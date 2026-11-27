"""Coding mode: code search/read/edit tools, GitHub helpers, file grounding."""
from __future__ import annotations

import asyncio

import pytest

from jarvis.core import path_guard
from jarvis.core.file_refs import find_file_refs, referenced_files_block
from jarvis.plugins.github_tools import git_auth_config, parse_repo


@pytest.fixture(scope="module")
def services():
    from jarvis.main import build_services
    cfg, _l, _b, registry, memory, perms, actions, orch, agents = build_services(None)
    return cfg, registry, orch


def _call(registry, name, **args):
    return asyncio.run(registry.get(name).invoke(args))


def test_parse_repo_variants():
    assert parse_repo("JoshTXWC/JARVIS") == ("JoshTXWC", "JARVIS")
    assert parse_repo("https://github.com/JoshTXWC/JARVIS.git") == ("JoshTXWC", "JARVIS")
    assert parse_repo("https://github.com/JoshTXWC/JARVIS/") == ("JoshTXWC", "JARVIS")
    assert parse_repo("not a repo") is None


def test_git_auth_header_never_contains_raw_token(monkeypatch, services):
    cfg, _, _ = services
    monkeypatch.setenv("GITHUB_TOKEN", "ghp_secret123")
    (val,) = git_auth_config(cfg)
    assert val.startswith("http.https://github.com/.extraheader=AUTHORIZATION: basic ")
    assert "ghp_secret123" not in val
    monkeypatch.delenv("GITHUB_TOKEN")
    assert git_auth_config(cfg) == []


def test_edit_file_exact_fuzzy_and_ambiguous(tmp_path, services):
    cfg, registry, _ = services
    path_guard.set_extra_write_roots([str(tmp_path)])
    f = tmp_path / "hello.py"
    out = _call(registry, "edit_file", path=str(f), new="def greet():\n    return 'hi'\n", create=True)
    assert "created" in out
    # whitespace-mangled `old` + missing indentation in `new` still lands correctly
    out = _call(registry, "edit_file", path=str(f), old="return  'hi'", new="return 'hello, sir'")
    assert "edited" in out and "+    return 'hello, sir'" in out
    assert f.read_text() == "def greet():\n    return 'hello, sir'\n"
    f.write_text("x = 1\nx = 1\n")
    assert "matches 2 places" in _call(registry, "edit_file", path=str(f), old="x = 1", new="x = 2")
    assert "not found" in _call(registry, "edit_file", path=str(f), old="nope", new="x")


def test_edit_file_refuses_outside_roots(services):
    _, registry, _ = services
    assert _call(registry, "edit_file", path="/etc/hosts", old="a", new="b").startswith("DENIED")


def test_code_search_and_read_code(services):
    _, registry, _ = services
    out = _call(registry, "code_search", pattern="class CodeAgent", glob="*.py")
    assert "jarvis/agents/code.py" in out.replace("\\", "/")
    out = _call(registry, "read_code", path="jarvis/agents/base.py", start=1, end=3)
    assert "    1  " in out and "lines 1-3" in out


def test_git_commit_push_refuses_main(services):
    _, registry, _ = services
    out = _call(registry, "git_commit_push", path=".", message="x", branch="main")
    assert "Refusing" in out


def test_file_refs_found_and_secrets_blocked(services):
    cfg, _, _ = services
    refs = find_file_refs("explain jarvis/agents/base.py and .env please", cfg)
    assert [p.name for p in refs] == ["base.py"]
    assert find_file_refs("mail a.b@example.com about v1.2", cfg) == []
    block = referenced_files_block("what does jarvis/agents/base.py do?", cfg, budget_chars=2000)
    assert '<file path="' in block and "class Agent" in block


def test_mode_switch_phrases(services):
    _, _, orch = services
    assert "Coding mode" in orch._maybe_switch_mode("Hey JARVIS, coding mode")
    assert orch._active_agent.name == "code"
    assert orch._maybe_switch_mode("standard mode") == "Standard mode, sir."
    assert orch._active_agent is None
    assert orch._maybe_switch_mode("tell me about coding mode in vscode") == ""
