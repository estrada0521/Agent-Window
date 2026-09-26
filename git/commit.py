from __future__ import annotations

import subprocess
from typing import Callable


def current_git_commit(workspace: str) -> dict | None:
    result = subprocess.run(
        ["git", "-C", workspace, "log", "-1", "--format=%H%x1f%h%x1f%s"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    if result.returncode != 0:
        return None
    line = result.stdout.strip()
    if not line:
        return None
    parts = line.split("\x1f", 2)
    if len(parts) != 3:
        raise RuntimeError(f"git log -1 returned a malformed commit line: {line!r}")
    return {"hash": parts[0], "short": parts[1], "subject": parts[2]}


class CommitAnnouncer:
    def __init__(self, workspace: str, announce: Callable[[dict], None]) -> None:
        self.workspace = workspace
        self._announce = announce
        self._last_hash: str | None = None

    def adopt_baseline(self) -> None:
        commit = current_git_commit(self.workspace)
        self._last_hash = commit["hash"] if commit else None

    def observe(self) -> None:
        commit = current_git_commit(self.workspace)
        if not commit:
            return
        last = self._last_hash
        self._last_hash = commit["hash"]
        if last is None or last == commit["hash"]:
            return
        self._announce(commit)
