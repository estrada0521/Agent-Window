from __future__ import annotations

import subprocess


def current_git_commit(runtime) -> dict | None:
    result = subprocess.run(
        ["git", "-C", runtime.workspace, "log", "-1", "--format=%H%x1f%h%x1f%s"],
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


def adopt_commit_baseline(runtime) -> None:
    commit = current_git_commit(runtime)
    runtime._last_announced_commit_hash = commit["hash"] if commit else None


def ensure_commit_announcements(runtime) -> None:
    commit = current_git_commit(runtime)
    if not commit:
        return
    last = getattr(runtime, "_last_announced_commit_hash", None)
    runtime._last_announced_commit_hash = commit["hash"]
    if last is None or last == commit["hash"]:
        return
    runtime.append_system_entry(
        f"Commit {commit['short']} {commit['subject']}",
        kind="git-commit",
        commit_hash=commit["hash"],
        commit_short=commit["short"],
    )
