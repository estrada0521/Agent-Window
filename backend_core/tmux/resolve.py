from __future__ import annotations

from pathlib import Path
from typing import Callable, Iterable


def normalize_workspace(value: str) -> str:
    return str(Path(value).expanduser().resolve())


def live_tmux_workspaces(
    session_names: Iterable[str],
    workspace_of: Callable[[str], str | None],
) -> dict[str, str]:
    """Map every live tmux session's recorded workspace to its session name.

    tmux never knows an AW session's own name -- only the workspace it was
    started in (AGENT_WINDOW_WORKSPACE, set once at creation and never
    rewritten) -- so this is the only bridge from a workspace to whichever
    live tmux session currently backs it. `workspace_of` is the caller's
    own way of reading that one value off a given tmux session (a bare
    subprocess call, an env dict, a timeout-tracked runtime query); this
    function only owns the matching, not how tmux gets talked to.

    On the (should-not-happen; a workspace is only ever claimed by one AW
    session) collision of two live tmux sessions recording the same
    workspace, the first one encountered wins.
    """
    result: dict[str, str] = {}
    for name in session_names:
        name = (name or "").strip()
        if not name:
            continue
        value = workspace_of(name)
        if not value:
            continue
        key = normalize_workspace(value)
        if key not in result:
            result[key] = name
    return result


def find_tmux_session_for_workspace(
    workspace: str,
    session_names: Iterable[str],
    workspace_of: Callable[[str], str | None],
) -> str | None:
    return live_tmux_workspaces(session_names, workspace_of).get(normalize_workspace(workspace))
