from __future__ import annotations

import re
import subprocess
import threading
import time
from pathlib import Path

_workspace: str = ""
_GIT_OVERVIEW_CACHE_TTL_SECONDS = 5.0
_git_overview_cache_lock = threading.Lock()
_git_overview_cache: dict[tuple[str, int, int, bool], tuple[float, dict]] = {}
_commit_list_cache: dict[tuple[str, str, int, int], dict] = {}


def configure(*, workspace: str) -> None:
    global _workspace
    _workspace = workspace or ""
    invalidate_git_cache(include_commits=True)


def _git_root() -> Path:
    root = str(_workspace or "").strip()
    if not root:
        raise RuntimeError("git workspace is not configured")
    path = Path(root)
    if not path.is_dir():
        raise RuntimeError("workspace is not available")
    return path


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["git", "-C", str(root), *args],
        check=False,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def invalidate_git_cache(*, include_commits: bool = False) -> None:
    with _git_overview_cache_lock:
        _git_overview_cache.clear()
        if include_commits:
            _commit_list_cache.clear()


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


def _read_commit_list(root: Path, *, offset: int, limit: int) -> dict:
    total_res = _run_git(root, "rev-list", "--count", "HEAD")
    if total_res.returncode != 0:
        raise RuntimeError((total_res.stderr or total_res.stdout or "git rev-list --count failed").strip())
    raw_count = (total_res.stdout or "").strip()
    try:
        total_commits = int(raw_count)
    except ValueError as exc:
        raise RuntimeError(f"git rev-list --count returned {raw_count!r}") from exc
    if total_commits < 0:
        raise RuntimeError(f"git rev-list --count returned {total_commits}")
    log_res = _run_git(
        root,
        "log",
        f"--skip={offset}",
        f"--max-count={limit}",
        "--format=%h\x1f%s\x1f%D",
    )
    if log_res.returncode != 0:
        raise RuntimeError((log_res.stderr or log_res.stdout or "git log failed").strip())
    recent_commits = []
    for line in (log_res.stdout or "").splitlines():
        line = line.strip()
        if not line:
            continue
        parts = line.split("\x1f")
        if len(parts) < 2:
            raise RuntimeError(f"git log returned a malformed commit line: {line!r}")
        h, subj = parts[0], parts[1]
        refs = parts[2].strip() if len(parts) > 2 else ""
        recent_commits.append({
            "hash": h,
            "subject": subj,
            "is_origin_main": "origin/main" in refs,
        })
    stat_res = _run_git(root, "log", f"--skip={offset}", f"--max-count={limit}", "--format=%h", "--shortstat")
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
            ins = dels = 0
            for part in stripped.split(","):
                part = part.strip()
                if "insertion" in part:
                    ins = int(part.split()[0])
                elif "deletion" in part:
                    dels = int(part.split()[0])
            commit_stats[current_hash] = {"ins": ins, "dels": dels}
            current_hash = None
    for commit in recent_commits:
        stats = commit_stats.get(commit["hash"]) or {}
        commit["ins"] = int(stats.get("ins", 0) or 0)
        commit["dels"] = int(stats.get("dels", 0) or 0)
    return {
        "total_commits": total_commits,
        "recent_commits": recent_commits,
    }


def git_overview(*, offset=0, limit=50, force_refresh: bool = False, include_commits: bool = True):
    root = _git_root()
    offset = int(offset)
    limit = int(limit)
    if offset < 0:
        raise ValueError(f"offset must be >= 0, got {offset}")
    if limit < 1:
        raise ValueError(f"limit must be >= 1, got {limit}")
    limit = min(limit, 200)
    cache_key = (str(root.resolve()), offset, limit, include_commits)
    now = time.monotonic()
    if not force_refresh:
        with _git_overview_cache_lock:
            cached = _git_overview_cache.get(cache_key)
            if cached and now - cached[0] < _GIT_OVERVIEW_CACHE_TTL_SECONDS:
                return cached[1]

    def _run(*args):
        return _run_git(root, *args)
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
    def _status_path(line: str) -> str:
        raw = str(line or "")
        path = raw[3:] if len(raw) > 3 else raw
        if " -> " in path:
            path = path.rsplit(" -> ", 1)[-1]
        return path.strip().strip('"')
    def _status_bucket_paths(lines: list[str]) -> tuple[set[str], set[str], set[str]]:
        staged: set[str] = set()
        unstaged: set[str] = set()
        untracked: set[str] = set()
        for raw in lines:
            line = str(raw or "")
            path = _status_path(line)
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
    origin_main_res = _run("rev-parse", "refs/remotes/origin/main")
    origin_main = (origin_main_res.stdout or "").strip() if origin_main_res.returncode == 0 else ""
    cached_commits = None
    if include_commits:
        commit_key = (str(root.resolve()), head, origin_main, offset, limit)
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
    if include_commits and cached_commits is None:
        if head_res.returncode != 0:
            cached_commits = {
                "total_commits": 0,
                "recent_commits": [],
            }
        else:
            cached_commits = _read_commit_list(root, offset=offset, limit=limit)
            with _git_overview_cache_lock:
                _commit_list_cache[commit_key] = cached_commits
    recent_commits = list(cached_commits["recent_commits"]) if cached_commits is not None else []
    total_commits = int(cached_commits["total_commits"]) if cached_commits is not None else 0
    next_offset = offset + len(recent_commits)
    has_more = next_offset < total_commits if total_commits else len(recent_commits) >= limit
    result = {
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
        "worktree_unstaged_added": worktree_unstaged_added,
        "worktree_unstaged_deleted": worktree_unstaged_deleted,
        "worktree_unstaged_changed_paths": len(unstaged_paths),
        "status_lines": status_lines[:8],
        "recent_commits": recent_commits,
    }
    with _git_overview_cache_lock:
        _git_overview_cache[cache_key] = (time.monotonic(), result)
    return result


def git_commit_info(*, commit_hash: str) -> dict:
    root = _git_root()
    res = _run_git(root, "show", "--shortstat", "--format=%an%x1f%aI%x1f%B%x1e", str(commit_hash or "").strip(), "--")
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout or "git show failed").strip())
    head, _, stat = (res.stdout or "").partition("\x1e")
    author, date, message = head.split("\x1f", 2)
    return {"author": author, "date": date, "message": message.strip(), "stat": stat.strip()}


def git_diff_files(*, commit_hash: str = "", scope: str = ""):
    root = _git_root()
    commit_hash = str(commit_hash or "").strip()
    scope = str(scope or "").strip().lower()

    def _run(*args):
        return _run_git(root, *args)

    def _diff_out(*args):
        res = _run(*args)
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout or "git diff failed").strip())
        return res.stdout or ""

    def _parse_numstat(out: str) -> tuple[list[dict], int, int]:
        tokens = out.split("\0")
        by_path: dict[str, dict] = {}
        i = 0
        while i < len(tokens):
            if not tokens[i]:
                i += 1
                continue
            ins_raw, dels_raw, path = tokens[i].split("\t", 2)
            old_path = ""
            if path:
                i += 1
            else:
                old_path, path = tokens[i + 1], tokens[i + 2]
                i += 3
            ins = int(ins_raw) if ins_raw.isdigit() else 0
            dels = int(dels_raw) if dels_raw.isdigit() else 0
            binary = not (ins_raw.isdigit() and dels_raw.isdigit())
            if path not in by_path:
                by_path[path] = {"path": path, "ins": 0, "dels": 0, "changed": 0, "binary": False}
                if old_path:
                    by_path[path]["old_path"] = old_path
            entry = by_path[path]
            entry["ins"] += ins
            entry["dels"] += dels
            entry["changed"] = entry["ins"] + entry["dels"]
            entry["binary"] = entry["binary"] or binary
        files = list(by_path.values())
        total_ins = sum(item["ins"] for item in files)
        total_dels = sum(item["dels"] for item in files)
        return files, total_ins, total_dels

    def _untracked_paths() -> list[str]:
        res = _run("ls-files", "--others", "--exclude-standard", "--full-name", "-z", "--")
        if res.returncode != 0:
            raise RuntimeError((res.stderr or res.stdout or "git ls-files failed").strip())
        return [path for path in (res.stdout or "").split("\0") if path]
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
    out = ""
    include_untracked = False
    if commit_hash:
        out = _diff_out("show", "--numstat", "-z", "--format=", "--find-renames", "--find-copies", commit_hash, "--")
    elif scope == "staged":
        out = _diff_out("diff", "--numstat", "-z", "--cached", "--")
    elif scope == "unstaged":
        out = _diff_out("diff", "--numstat", "-z", "--")
    elif scope == "untracked":
        include_untracked = True
    else:
        include_untracked = True
        if has_head:
            out = _diff_out("diff", "--numstat", "-z", "HEAD", "--")
        else:
            out = _diff_out("diff", "--numstat", "-z", "--cached", "--") + _diff_out("diff", "--numstat", "-z", "--")

    files, total_ins, total_dels = _parse_numstat(out)
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


def open_diff_tool(rel_path: str, commit_hash: str = "", old_path: str = "") -> dict:
    root = _git_root()
    rel = str(rel_path or "").strip().lstrip("/")
    if not rel:
        raise ValueError("path required")
    pathspecs = [rel]
    if old_path:
        pathspecs.insert(0, str(old_path).strip().lstrip("/"))
    for spec in pathspecs:
        try:
            (root / spec).resolve().relative_to(root.resolve())
        except ValueError:
            raise PermissionError(spec)
    revs = []
    if commit_hash:
        res = _run_git(root, "rev-parse", "--verify", "--end-of-options", f"{commit_hash}^{{commit}}")
        if res.returncode != 0:
            raise ValueError(f"unknown commit: {commit_hash}")
        revs = [f"{res.stdout.strip()}^!"]
    subprocess.Popen(
        ["git", "-C", str(root), "difftool", "-y", *revs, "--", *pathspecs],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return {"ok": True, "path": rel}
