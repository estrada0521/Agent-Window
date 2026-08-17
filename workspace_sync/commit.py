from __future__ import annotations

import fcntl
import json
import subprocess
from collections import deque
from pathlib import Path

_COMMIT_STATE_FILENAME = ".agent-index-commit-state.json"


def _commit_state_path(runtime) -> Path:
    return runtime.log_path.parent / _COMMIT_STATE_FILENAME


def read_commit_state_locked(runtime, handle, *, json_module=json) -> dict:
    handle.seek(0)
    raw = handle.read().strip()
    if not raw:
        return {}
    try:
        data = json_module.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("corrupt commit state") from exc
    if not isinstance(data, dict):
        raise ValueError("commit state is not an object")
    return data


def commit_state_payload(commit: dict) -> dict:
    return {
        "last_commit_hash": commit["hash"],
        "last_commit_short": commit["short"],
        "last_commit_subject": commit["subject"],
    }


def write_commit_state_locked(runtime, handle, commit: dict, *, json_module=json) -> None:
    handle.seek(0)
    handle.truncate()
    handle.write(json_module.dumps(commit_state_payload(commit), ensure_ascii=False))
    handle.flush()


def has_logged_commit_entry(
    runtime,
    commit_hash: str,
    *,
    recent_limit: int = 256,
    deque_class=deque,
    json_module=json,
) -> bool:
    commit_hash = (commit_hash or "").strip()
    if not commit_hash or not runtime.log_path.exists():
        return False
    try:
        recent_lines: deque[str] = deque_class(maxlen=max(32, int(recent_limit)))
        with runtime.log_path.open("r", encoding="utf-8") as f:
            for line in f:
                recent_lines.append(line)
        for line in reversed(recent_lines):
            try:
                entry = json_module.loads(line)
            except json.JSONDecodeError:
                continue
            if entry.get("kind") != "git-commit":
                continue
            if (entry.get("commit_hash") or "").strip() == commit_hash:
                return True
    except OSError as exc:
        raise RuntimeError(f"failed to read commit log {runtime.log_path}: {exc}") from exc
    return False


def record_git_commit_locked(runtime, handle, commit: dict) -> bool:
    if has_logged_commit_entry(runtime, commit["hash"]):
        write_commit_state_locked(runtime, handle, commit)
        return False
    runtime.append_system_entry(
        f"Commit {commit['short']} {commit['subject']}",
        kind="git-commit",
        commit_hash=commit["hash"],
        commit_short=commit["short"],
    )
    write_commit_state_locked(runtime, handle, commit)
    return True


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


def git_commits_since(
    runtime,
    base_hash: str,
    *,
    subprocess_module=subprocess,
) -> list[dict]:
    result = subprocess_module.run(
        ["git", "-C", runtime.workspace, "log", "--reverse", "--format=%H%x1f%h%x1f%s", f"{base_hash}..HEAD"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError((result.stderr or result.stdout or "git log failed").strip())
    commits = []
    for line in result.stdout.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) != 3:
            raise RuntimeError(f"git log returned a malformed commit line: {line!r}")
        commits.append({"hash": parts[0], "short": parts[1], "subject": parts[2]})
    return commits


def ensure_commit_announcements(
    runtime,
    *,
    fcntl_module=fcntl,
) -> None:
    current = current_git_commit(runtime)
    if not current:
        return
    _commit_state_path(runtime).parent.mkdir(parents=True, exist_ok=True)
    with _commit_state_path(runtime).open("a+", encoding="utf-8") as handle:
        fcntl_module.flock(handle.fileno(), fcntl_module.LOCK_EX)
        try:
            state = read_commit_state_locked(runtime, handle)
            last_hash = (state.get("last_commit_hash") or "").strip()
            if not last_hash:
                record_git_commit_locked(runtime, handle, current)
                return
            if last_hash == current["hash"]:
                return
            commits = git_commits_since(runtime, last_hash)
            if not commits:
                record_git_commit_locked(runtime, handle, current)
                return
            for commit in commits:
                record_git_commit_locked(runtime, handle, commit)
        finally:
            fcntl_module.flock(handle.fileno(), fcntl_module.LOCK_UN)
