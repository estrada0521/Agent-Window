from __future__ import annotations

import subprocess
from dataclasses import dataclass

from backend_core.tmux.resolve import normalize_workspace


TERMINAL_WINDOW_NAME = "terminal"


@dataclass(frozen=True)
class AgentPane:
    name: str
    pane_id: str


def _run(prefix: list[str], args: list[str], *, subprocess_module=subprocess):
    return subprocess_module.run(
        [*prefix, *args],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )


def live_sessions(prefix: list[str], *, subprocess_module=subprocess) -> list[tuple[str, str]]:
    """Return live tmux sessions as ``(name, session_path)`` pairs."""
    result = _run(
        prefix,
        ["list-sessions", "-F", "#{session_name}\t#{session_path}"],
        subprocess_module=subprocess_module,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        lowered = detail.lower()
        if "no server running" in lowered or "no such file or directory" in lowered:
            return []
        raise RuntimeError(f"tmux list-sessions failed (exit {result.returncode}): {detail}")

    sessions: list[tuple[str, str]] = []
    for raw_line in result.stdout.splitlines():
        name, separator, workspace = raw_line.partition("\t")
        name = name.strip()
        workspace = workspace.strip()
        if not separator or not name or not workspace:
            raise RuntimeError(f"tmux list-sessions returned unreadable output: {raw_line!r}")
        sessions.append((name, workspace))
    return sessions


def find_session_for_workspace(
    prefix: list[str],
    workspace: str,
    *,
    subprocess_module=subprocess,
) -> str | None:
    wanted = normalize_workspace(workspace)
    for name, session_path in live_sessions(prefix, subprocess_module=subprocess_module):
        if normalize_workspace(session_path) == wanted:
            return name
    return None


def tmux_session_workspace(
    prefix: list[str],
    session_name: str,
    *,
    subprocess_module=subprocess,
) -> str:
    result = _run(
        prefix,
        ["display-message", "-p", "-t", session_name, "#{session_path}"],
        subprocess_module=subprocess_module,
    )
    workspace = (result.stdout or "").strip()
    if result.returncode != 0 or not workspace:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or f"workspace unavailable for tmux session {session_name}")
    return workspace


def agent_topology(
    prefix: list[str],
    session_name: str,
    *,
    subprocess_module=subprocess,
) -> list[AgentPane]:
    """Project AW's one-window-per-agent tmux topology in window order."""
    result = _run(
        prefix,
        [
            "list-windows",
            "-t",
            session_name,
            "-F",
            "#{window_name}\t#{window_panes}\t#{pane_id}",
        ],
        subprocess_module=subprocess_module,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or f"cannot read tmux topology for {session_name}")

    return parse_agent_topology(result.stdout)


def parse_agent_topology(output: str) -> list[AgentPane]:
    panes: list[AgentPane] = []
    seen_names: set[str] = set()
    for raw_line in output.splitlines():
        fields = raw_line.split("\t")
        if len(fields) != 3:
            raise RuntimeError(f"tmux list-windows returned unreadable output: {raw_line!r}")
        name, pane_count_raw, pane_id = (field.strip() for field in fields)
        if not pane_count_raw.isdigit():
            raise RuntimeError(f"tmux list-windows returned unreadable output: {raw_line!r}")
        if name == TERMINAL_WINDOW_NAME:
            continue
        if int(pane_count_raw) != 1 or not name or not pane_id:
            raise RuntimeError(f"invalid agent window topology: {raw_line!r}")
        if name in seen_names:
            raise RuntimeError(f"duplicate agent window name: {name}")
        seen_names.add(name)
        panes.append(AgentPane(name, pane_id))
    return panes


def resolve_tmux_session_name(runtime, *, subprocess_module=subprocess) -> str | None:
    workspace = str(runtime.workspace or "").strip()
    if not workspace:
        return None
    return find_session_for_workspace(
        runtime.tmux_prefix,
        workspace,
        subprocess_module=subprocess_module,
    )


def pane_field(runtime, pane_id: str, field: str, *, subprocess_module=subprocess) -> str:
    if not pane_id:
        return ""
    result = subprocess_module.run(
        [*runtime.tmux_prefix, "display-message", "-p", "-t", pane_id, field],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    return result.stdout.strip()
