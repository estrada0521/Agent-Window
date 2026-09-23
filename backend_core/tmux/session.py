from __future__ import annotations

import subprocess
from dataclasses import dataclass

from backend_core.tmux import TMUX
from backend_core.tmux.resolve import normalize_workspace


TERMINAL_WINDOW_NAME = "terminal"


@dataclass(frozen=True)
class AgentPane:
    name: str
    pane_id: str


def _run(args: list[str]):
    return subprocess.run(
        [*TMUX, *args],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )


def live_sessions() -> list[tuple[str, str]]:
    result = _run(
        ["list-sessions", "-F", "#{session_name}\t#{session_path}"],
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
    workspace: str,
) -> str | None:
    wanted = normalize_workspace(workspace)
    for name, session_path in live_sessions():
        if normalize_workspace(session_path) == wanted:
            return name
    return None


def tmux_session_workspace(
    session_name: str,
) -> str:
    result = _run(
        ["display-message", "-p", "-t", session_name, "#{session_path}"],
    )
    workspace = (result.stdout or "").strip()
    if result.returncode != 0 or not workspace:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or f"workspace unavailable for tmux session {session_name}")
    return workspace


def agent_topology(
    session_name: str,
) -> list[AgentPane]:
    result = _run(
        [
            "list-windows",
            "-t",
            session_name,
            "-F",
            "#{window_name}\t#{window_panes}\t#{pane_id}",
        ],
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


def terminal_window_pane_id(
    session_name: str,
) -> str:
    result = _run(
        ["list-windows", "-t", session_name, "-F", "#{window_name}\t#{pane_id}"],
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(detail or f"cannot read tmux topology for {session_name}")
    for raw_line in result.stdout.splitlines():
        name, _, pane_id = raw_line.partition("\t")
        if name.strip() == TERMINAL_WINDOW_NAME:
            return pane_id.strip()
    return ""


def pane_field(pane_id: str, field: str) -> str:
    result = subprocess.run(
        [*TMUX, "display-message", "-p", "-t", pane_id, field],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    return result.stdout.strip()
