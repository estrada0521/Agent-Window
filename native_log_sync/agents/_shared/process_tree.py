from __future__ import annotations

import subprocess

_PROBE_TIMEOUT_SEC = 5.0
_PROBE_ERRORS = (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired)


def process_tree(pid: str) -> set[str]:
    """PIDs in the tree rooted at pane_pid.

    pane_pid is the identity we already have from tmux. ps only expands
    children; if that expansion cannot be read, probe the given pid alone.
    """
    pid = str(pid or "").strip()
    if not pid:
        return set()
    try:
        out = subprocess.run(
            ["ps", "-eo", "pid,ppid"],
            capture_output=True,
            text=True,
            check=True,
            timeout=_PROBE_TIMEOUT_SEC,
        ).stdout
    except _PROBE_ERRORS:
        return {pid}
    children_map: dict[str, list[str]] = {}
    for line in out.splitlines()[1:]:
        parts = line.strip().split()
        if len(parts) >= 2:
            child, parent = parts[0], parts[1]
            children_map.setdefault(parent, []).append(child)
    found = {pid}
    queue = [pid]
    while queue:
        current = queue.pop(0)
        for child in children_map.get(current, []):
            if child not in found:
                found.add(child)
                queue.append(child)
    return found


def lsof_text(pid: str) -> str | None:
    """lsof stdout for one pid, or None if that pid could not be inspected."""
    pid = str(pid or "").strip()
    if not pid:
        return None
    try:
        return subprocess.run(
            ["lsof", "-p", pid],
            capture_output=True,
            text=True,
            check=True,
            timeout=_PROBE_TIMEOUT_SEC,
        ).stdout
    except _PROBE_ERRORS:
        return None
