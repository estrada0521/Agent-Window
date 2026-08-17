from __future__ import annotations

import hashlib
import re
import subprocess
import threading
import time
from pathlib import Path

_workspace: str = ""
_runtime = None
_GIT_OVERVIEW_CACHE_TTL_SECONDS = 5.0
_git_overview_cache_lock = threading.Lock()
_git_overview_cache: dict[tuple[str, int, int], tuple[float, dict]] = {}
_commit_list_cache: dict[tuple[str, str, int, int], dict] = {}


def configure(*, workspace: str, runtime) -> None:
    global _workspace, _runtime
    _workspace = workspace or ""
    _runtime = runtime
    _clear_git_overview_cache()


def _git_root() -> Path:
    root = str(_workspace or "").strip()
    if not root:
        raise RuntimeError("git workspace is not configured")
    return Path(root)


def _clear_git_overview_cache() -> None:
    with _git_overview_cache_lock:
        _git_overview_cache.clear()
        _commit_list_cache.clear()


def invalidate_git_overview_cache() -> None:
    with _git_overview_cache_lock:
        _git_overview_cache.clear()


def git_ignored_rel_paths(workspace: str, rel_paths: list[str]) -> set[str]:
    paths = [str(rel or "").replace("\\", "/").strip("/") for rel in rel_paths if str(rel or "").strip()]
    if not paths:
        return set()
    result = subprocess.run(
        ["git", "-C", workspace, "check-ignore", "-z", "--stdin"],
        input="".join(f"{path}\0" for path in paths),
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode not in (0, 1):
        raise RuntimeError((result.stderr or result.stdout or "git check-ignore failed").strip())
    return {item.replace("\\", "/").strip("/") for item in (result.stdout or "").split("\0") if item.strip()}


def _read_commit_list(_run, *, branch: str, offset: int, limit: int) -> dict:
    total_res = _run("rev-list", "--count", "HEAD")
    if total_res.returncode != 0:
        raise RuntimeError((total_res.stderr or total_res.stdout or "git rev-list --count failed").strip())
    raw_count = (total_res.stdout or "").strip()
    try:
        total_commits = int(raw_count)
    except ValueError as exc:
        raise RuntimeError(f"git rev-list --count returned {raw_count!r}") from exc
    if total_commits < 0:
        raise RuntimeError(f"git rev-list --count returned {total_commits}")
    upstream_res = _run("rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}")
    upstream = (upstream_res.stdout or "").strip() if upstream_res.returncode == 0 else ""
    ahead_behind = ""
    if upstream:
        count_res = _run("rev-list", "--left-right", "--count", f"{branch}...{upstream}")
        if count_res.returncode != 0:
            raise RuntimeError((count_res.stderr or count_res.stdout or "git rev-list ahead/behind failed").strip())
        parts = (count_res.stdout or "").strip().split()
        if len(parts) != 2:
            raise RuntimeError(f"git rev-list --left-right --count returned {count_res.stdout!r}")
        ahead_behind = f"ahead {parts[0]} / behind {parts[1]}"
    log_res = _run(
        "log",
        f"--skip={offset}",
        f"--max-count={limit}",
        "--format=%h\x1f%aI\x1f%s\x1f%D",
    )
    if log_res.returncode != 0:
        raise RuntimeError((log_res.stderr or log_res.stdout or "git log failed").strip())
    recent_commits = []
    for line in (log_res.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\x1f")
        if len(parts) < 3:
            raise RuntimeError(f"git log returned a malformed commit line: {line!r}")
        h, ts, subj = parts[0], parts[1], parts[2]
        hhmm = ""
        t_part = ts.split("T")[1] if "T" in ts else ""
        if t_part:
            hhmm = t_part[:5]
        refs = parts[3].strip() if len(parts) > 3 else ""
        recent_commits.append({
            "hash": h,
            "time": hhmm,
            "subject": subj,
            "is_origin_main": "origin/main" in refs,
        })
    stat_res = _run("log", f"--skip={offset}", f"--max-count={limit}", "--format=%h", "--shortstat")
    if stat_res.returncode != 0:
        raise RuntimeError((stat_res.stderr or stat_res.stdout or "git log --shortstat failed").strip())
    commit_stats = {}
    current_hash = None
    for line in (stat_res.stdout or "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if len(stripped) <= 12 and all(c in "0123456789abcdef" for c in stripped):
            current_hash = stripped
        elif current_hash and "changed" in stripped:
            ins = dels = changed_paths = 0
            for part in stripped.split(","):
                part = part.strip()
                files_match = re.search(r"(\d+)\s+files?\s+changed", part)
                if files_match:
                    changed_paths = int(files_match.group(1))
                    continue
                if "insertion" in part:
                    ins = int(part.split()[0])
                elif "deletion" in part:
                    dels = int(part.split()[0])
            commit_stats[current_hash] = {"ins": ins, "dels": dels, "changed_paths": changed_paths}
            current_hash = None
    for commit in recent_commits:
        stats = commit_stats.get(commit["hash"]) or {}
        commit["ins"] = int(stats.get("ins", 0) or 0)
        commit["dels"] = int(stats.get("dels", 0) or 0)
        commit["changed_paths"] = int(stats.get("changed_paths", 0) or 0)
    return {
        "total_commits": total_commits,
        "upstream": upstream,
        "ahead_behind": ahead_behind,
        "recent_commits": recent_commits,
    }


def git_overview(*, offset=0, limit=50, force_refresh: bool = False):
    root = _git_root()
    offset = int(offset)
    limit = int(limit)
    if offset < 0:
        raise ValueError(f"offset must be >= 0, got {offset}")
    if limit < 1:
        raise ValueError(f"limit must be >= 1, got {limit}")
    limit = min(limit, 200)
    cache_key = (str(root.resolve()), offset, limit)
    now = time.monotonic()
    if not force_refresh:
        with _git_overview_cache_lock:
            cached = _git_overview_cache.get(cache_key)
            if cached and now - cached[0] < _GIT_OVERVIEW_CACHE_TTL_SECONDS:
                return cached[1]

    def _run(*args):
        return subprocess.run(
            ["git", "-C", str(root), *args],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    def _parse_numstat(res):
        added = 0
        deleted = 0
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout or "git diff --numstat failed").strip())
        for line in (res.stdout or "").splitlines():
            parts = line.split("\t", 2)
            if len(parts) < 3:
                continue
            ins, dels = parts[0], parts[1]
            if ins.isdigit():
                added += int(ins)
            if dels.isdigit():
                deleted += int(dels)
        return added, deleted
    def _status_bucket_paths(lines: list[str]) -> tuple[set[str], set[str], set[str]]:
        staged: set[str] = set()
        unstaged: set[str] = set()
        untracked: set[str] = set()
        for raw in lines:
            line = str(raw or "")
            path = _status_path_for_fingerprint(line)
            if not path:
                continue
            if line.startswith("??"):
                untracked.add(path)
                continue
            x = line[0] if len(line) > 0 else " "
            y = line[1] if len(line) > 1 else " "
            if x not in {" ", "?"}:
                staged.add(path)
            if y not in {" ", "?"}:
                unstaged.add(path)
        return staged, unstaged, untracked
    head_res = _run("rev-parse", "HEAD")
    has_head = head_res.returncode == 0
    head = (head_res.stdout or "").strip() if has_head else ""
    if has_head:
        branch_res = _run("rev-parse", "--abbrev-ref", "HEAD")
        if branch_res.returncode != 0:
            raise RuntimeError((branch_res.stderr or branch_res.stdout or "git rev-parse --abbrev-ref HEAD failed").strip())
        branch = (branch_res.stdout or "").strip()
    else:
        branch = ""
    commit_key = (str(root.resolve()), head, offset, limit)
    with _git_overview_cache_lock:
        cached_commits = _commit_list_cache.get(commit_key)
    status_res = _run("status", "--short", "--branch", "--untracked-files=all")
    if status_res.returncode != 0:
        raise RuntimeError((status_res.stderr or status_res.stdout or "git status failed").strip())
    status_lines = []
    for line in (status_res.stdout or "").splitlines():
        line = line.rstrip()
        if not line or line.startswith("## "):
            continue
        status_lines.append(line)
    def _status_path_for_fingerprint(line: str) -> str:
        raw = str(line or "")
        path = raw[3:] if len(raw) > 3 else raw
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        return path.strip().strip('"')
    def _worktree_fingerprint() -> str:
        digest = hashlib.sha1()
        for line in sorted(status_lines):
            digest.update(line.encode("utf-8", "surrogateescape"))
            digest.update(b"\0")
            rel = _status_path_for_fingerprint(line)
            if not rel:
                continue
            try:
                st = (root / rel).stat()
            except OSError:
                digest.update(b"missing\0")
                continue
            digest.update(str(st.st_size).encode("ascii", "ignore"))
            digest.update(b":")
            digest.update(str(st.st_mtime_ns).encode("ascii", "ignore"))
            digest.update(b"\0")
        return digest.hexdigest()
    staged_paths, unstaged_paths, untracked_paths = _status_bucket_paths(status_lines)
    staged_diff_res = _run("diff", "--numstat", "--cached", "--")
    unstaged_diff_res = _run("diff", "--numstat", "--")
    worktree_staged_added, worktree_staged_deleted = _parse_numstat(staged_diff_res)
    worktree_unstaged_added, worktree_unstaged_deleted = _parse_numstat(unstaged_diff_res)
    worktree_has_untracked_diff = bool(untracked_paths)
    worktree_has_staged_diff = bool((staged_diff_res.stdout or "").strip())
    worktree_has_unstaged_diff = bool((unstaged_diff_res.stdout or "").strip())
    if has_head:
        diff_head_res = _run("diff", "--numstat", "HEAD", "--")
        worktree_added, worktree_deleted = _parse_numstat(diff_head_res)
        worktree_has_diff = bool((diff_head_res.stdout or "").strip()) or worktree_has_untracked_diff
    else:
        worktree_added = worktree_unstaged_added + worktree_staged_added
        worktree_deleted = worktree_unstaged_deleted + worktree_staged_deleted
        worktree_has_diff = worktree_has_staged_diff or worktree_has_unstaged_diff or worktree_has_untracked_diff
    if cached_commits is None:
        if head_res.returncode != 0:
            cached_commits = {
                "total_commits": 0,
                "upstream": "",
                "ahead_behind": "",
                "recent_commits": [],
            }
        else:
            cached_commits = _read_commit_list(_run, branch=branch, offset=offset, limit=limit)
            with _git_overview_cache_lock:
                _commit_list_cache[commit_key] = cached_commits
    recent_commits = list(cached_commits["recent_commits"])
    total_commits = int(cached_commits["total_commits"])
    upstream = str(cached_commits["upstream"])
    ahead_behind = str(cached_commits["ahead_behind"])
    next_offset = offset + len(recent_commits)
    has_more = next_offset < total_commits if total_commits else len(recent_commits) >= limit
    result = {
        "branch": branch,
        "upstream": upstream,
        "ahead_behind": ahead_behind,
        "offset": offset,
        "limit": limit,
        "next_offset": next_offset,
        "total_commits": total_commits,
        "has_more": has_more,
        "worktree_added": worktree_added,
        "worktree_deleted": worktree_deleted,
        "worktree_has_diff": worktree_has_diff,
        "worktree_changed_paths": len(status_lines),
        "worktree_staged_added": worktree_staged_added,
        "worktree_staged_deleted": worktree_staged_deleted,
        "worktree_staged_changed_paths": len(staged_paths),
        "worktree_staged_has_diff": worktree_has_staged_diff,
        "worktree_unstaged_added": worktree_unstaged_added,
        "worktree_unstaged_deleted": worktree_unstaged_deleted,
        "worktree_unstaged_changed_paths": len(unstaged_paths),
        "worktree_unstaged_has_diff": worktree_has_unstaged_diff,
        "worktree_untracked_has_diff": worktree_has_untracked_diff,
        "worktree_untracked_changed_paths": len(untracked_paths),
        "worktree_fingerprint": _worktree_fingerprint(),
        "status_lines": status_lines[:8],
        "recent_commits": recent_commits,
    }
    with _git_overview_cache_lock:
        _git_overview_cache[cache_key] = (time.monotonic(), result)
    return result


def git_diff_files(*, commit_hash: str = "", scope: str = ""):
    root = _git_root()
    commit_hash = str(commit_hash or "").strip()
    scope = str(scope or "").strip().lower()

    def _run(*args):
        return subprocess.run(
            ["git", "-C", str(root), *args],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def _parse_numstat_lines(lines: list[str]) -> tuple[list[dict], int, int]:
        by_path: dict[str, dict] = {}
        order: list[str] = []
        for raw in lines:
            line = str(raw or "").rstrip()
            if not line:
                continue
            parts = line.split("\t", 2)
            if len(parts) < 3:
                continue
            ins_raw, dels_raw, path_raw = parts[0], parts[1], parts[2]
            path = path_raw.strip()
            if not path:
                continue
            ins = int(ins_raw) if ins_raw.isdigit() else 0
            dels = int(dels_raw) if dels_raw.isdigit() else 0
            binary = not (ins_raw.isdigit() and dels_raw.isdigit())
            if path not in by_path:
                by_path[path] = {
                    "path": path,
                    "ins": 0,
                    "dels": 0,
                    "changed": 0,
                    "binary": False,
                }
                order.append(path)
            entry = by_path[path]
            entry["ins"] += ins
            entry["dels"] += dels
            entry["changed"] = entry["ins"] + entry["dels"]
            entry["binary"] = bool(entry.get("binary")) or binary
        files = [by_path[path] for path in order]
        total_ins = sum(int(item.get("ins") or 0) for item in files)
        total_dels = sum(int(item.get("dels") or 0) for item in files)
        return files, total_ins, total_dels
    def _untracked_paths() -> list[str]:
        res = _run("ls-files", "--others", "--exclude-standard", "--full-name", "--")
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout or "git ls-files failed").strip())
        return [line.strip() for line in (res.stdout or "").splitlines() if line.strip()]
    def _append_untracked(files: list[dict], paths: list[str]) -> list[dict]:
        seen = {str(item.get("path") or "").strip() for item in files}
        merged = list(files)
        for path in paths:
            if path in seen:
                continue
            merged.append({
                "path": path,
                "ins": 0,
                "dels": 0,
                "changed": 0,
                "binary": False,
                "untracked": True,
            })
            seen.add(path)
        return merged

    head_res = _run("rev-parse", "HEAD")
    has_head = head_res.returncode == 0
    lines: list[str] = []
    include_untracked = False
    if commit_hash:
        diff_res = _run(
            "show",
            "--numstat",
            "--format=",
            "--find-renames",
            "--find-copies",
            commit_hash,
            "--",
        )
        if diff_res.returncode != 0:
            raise RuntimeError((diff_res.stderr or diff_res.stdout or "git diff failed").strip())
        lines = (diff_res.stdout or "").splitlines()
    else:
        if scope == "staged":
            diff_res = _run("diff", "--numstat", "--cached", "--")
            if diff_res.returncode != 0:
                raise RuntimeError((diff_res.stderr or diff_res.stdout or "git diff failed").strip())
            lines = (diff_res.stdout or "").splitlines()
        elif scope == "unstaged":
            diff_res = _run("diff", "--numstat", "--")
            if diff_res.returncode != 0:
                raise RuntimeError((diff_res.stderr or diff_res.stdout or "git diff failed").strip())
            lines = (diff_res.stdout or "").splitlines()
        elif scope == "untracked":
            lines = []
            include_untracked = True
        else:
            include_untracked = True
            if has_head:
                diff_res = _run("diff", "--numstat", "HEAD", "--")
                if diff_res.returncode != 0:
                    raise RuntimeError((diff_res.stderr or diff_res.stdout or "git diff failed").strip())
                lines = (diff_res.stdout or "").splitlines()
            else:
                staged = _run("diff", "--numstat", "--cached", "--")
                unstaged = _run("diff", "--numstat", "--")
                if staged.returncode != 0:
                    raise RuntimeError((staged.stderr or staged.stdout or "git diff --cached failed").strip())
                if unstaged.returncode != 0:
                    raise RuntimeError((unstaged.stderr or unstaged.stdout or "git diff failed").strip())
                lines = (staged.stdout or "").splitlines() + (unstaged.stdout or "").splitlines()

    files, total_ins, total_dels = _parse_numstat_lines(lines)
    if include_untracked:
        files = _append_untracked(files, _untracked_paths())
    return {
        "hash": commit_hash,
        "scope": scope,
        "changed_paths": len(files),
        "total_ins": total_ins,
        "total_dels": total_dels,
        "files": files,
    }



