from .base import Agent


class CodeAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            name="code",
            description="Coding mode: reads a project, explains code, proposes and applies edits, GitHub.",
            system_prompt=(
                "You are in CODING MODE. Workflow: (1) locate the code — scan_project, "
                "code_search, list_dir; (2) read it with read_code before changing anything; "
                "(3) explain what you found in plain language; (4) when asked to change code, "
                "make small precise edits with edit_file (copy `old` exactly from read_code, "
                "without the line numbers), then run tests or the program with run_shell / "
                "run_python and fix failures; (5) summarise the diff. For GitHub: github_clone "
                "a repo into the workspace, work on a feature branch, git_commit_push, then "
                "github_create_pull_request. Never push to main. Ask before destructive steps."
            ),
            tool_allowlist=[
                "scan_project", "code_search", "read_code", "read_file", "list_dir", "search_files",
                "edit_file", "write_file", "mkdir",
                "run_shell", "run_python", "run_python_file", "run_node", "pip_install", "npm_install",
                "code_debug_loop", "git_status", "git_commit_push",
                "github_status", "github_list_repos", "github_get_repo", "github_read_file",
                "github_list_issues", "github_list_pulls", "github_clone", "github_create_pull_request",
                "web_search", "web_fetch", "add_fix", "lookup_fix", "remember", "recall",
            ],
        )
