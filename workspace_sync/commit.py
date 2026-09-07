from __future__ import annotations

import subprocess


def current_git_commit(
    runtime,
    *,
    subprocess_module=subprocess,
) -> dict | None:
    result = subprocess_module.run(
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
    """Take HEAD as the baseline without announcing it -- called at startup so
    commits landed while this process was down are silently absorbed, not
    back-filled into the timeline."""
    commit = current_git_commit(runtime)
    runtime._last_announced_commit_hash = commit["hash"] if commit else None


def ensure_commit_announcements(runtime) -> None:
    """Project the commit HEAD just moved to -- only that one, and only when
    this process was running to see it move. No range walk, no catch-up: the
    timeline is what was observed, not a git-log replay."""
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
