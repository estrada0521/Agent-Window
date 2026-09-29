from __future__ import annotations

import ctypes
import os
import threading
from ctypes import c_double, c_uint32, c_uint64, c_void_p

from fs.fsevents import (
    FSEVENT_CREATE_FLAGS,
    FSEVENT_RESCAN_FLAGS,
    FSEventCallback,
    KFSEVENTSTREAM_EVENT_ID_SINCE_NOW,
    cf_path_array,
    load_cf_cs,
)
from git.repo import NotGitRepository, clear_commit_list_cache, git_ignored_rel_paths, git_worktrees

_DEBOUNCE_SEC = 0.25

_GIT_HEAD_METADATA_PATHS = frozenset(
    {
        ".git",
        ".git/HEAD",
        ".git/packed-refs",
        ".git/refs",
        ".git/logs",
        ".git/reftable",
    }
)
_GIT_HEAD_METADATA_PREFIXES = (
    ".git/refs/",
    ".git/logs/",
    ".git/reftable/",
)


def _is_git_head_metadata_path(rel: str) -> bool:
    normalized = str(rel or "").strip("/")
    if normalized in _GIT_HEAD_METADATA_PATHS:
        return True
    return any(normalized.startswith(prefix) for prefix in _GIT_HEAD_METADATA_PREFIXES)


def _read_git_trees(workspace: str) -> list[tuple[str, str, str]]:
    trees = [("", workspace, os.path.realpath(os.path.join(workspace, ".git")))]
    for item in git_worktrees(workspace)[1:]:
        root = os.path.realpath(item["path"])
        try:
            with open(os.path.join(root, ".git"), encoding="utf-8") as f:
                gitdir = f.read().strip().removeprefix("gitdir: ")
        except FileNotFoundError:
            continue
        trees.append((item["path"], root, os.path.realpath(gitdir)))
    return trees


def _is_under(path: str, root: str) -> bool:
    return path == root or path.startswith(root + "/")


class _DebouncedWorkspaceRefresh:
    def __init__(self, files, *, publish_event, report_failure, on_head_changed, on_trees_changed=lambda _trees: None) -> None:
        self._files = files
        self._publish_event = publish_event
        self._report_failure = report_failure
        self._on_head_changed = on_head_changed
        self._on_trees_changed = on_trees_changed
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._trees = self._load_trees()
        self._pending: set[str] = set()
        self._tree_files: dict[str, set[str]] = {}
        self._git_pending: set[str] = set()
        self._git_head_pending = False
        self._trees_pending = False
        self._full_rescan_pending = False
        self._timer: threading.Timer | None = None

    def _load_trees(self) -> list[tuple[str, str, str]]:
        workspace = self._files.workspace
        try:
            return _read_git_trees(workspace)
        except NotGitRepository:
            return []
        except RuntimeError as exc:
            self._report_failure(f"git worktree list failed: {exc}")
            return [("", workspace, os.path.realpath(os.path.join(workspace, ".git")))]

    @property
    def trees(self) -> list[tuple[str, str, str]]:
        return self._trees

    def mark_full_rescan(self) -> None:
        with self._lock:
            self._full_rescan_pending = True
            self._git_head_pending = True
            self._trees_pending = True
            self._schedule_flush_locked()

    def add_path(self, path: str) -> None:
        normalized = os.path.realpath(path)
        with self._lock:
            marked = self._classify_git_metadata_locked(normalized)
            if marked is not None:
                if marked:
                    self._schedule_flush_locked()
                return
            tree = max(
                (tree for tree in self._trees if _is_under(normalized, tree[1])),
                key=lambda tree: len(tree[1]),
                default=None,
            )
            in_workspace = _is_under(normalized, self._files.workspace)
            if tree is None and not in_workspace:
                return
            if tree is not None:
                self._tree_files.setdefault(tree[0], set()).add(normalized)
            if in_workspace:
                self._pending.add(normalized)
            self._schedule_flush_locked()

    def _classify_git_metadata_locked(self, path: str) -> bool | None:
        if not self._trees:
            return None
        common = self._trees[0][2]
        if not _is_under(path, common):
            return None
        rel = os.path.relpath(path, common)
        parts = rel.split("/")
        if parts[0] == "worktrees":
            gitdir = os.path.join(common, *parts[:2])
            key = next((tree[0] for tree in self._trees if tree[2] == gitdir), None)
            sub = "/".join(parts[2:])
            if key is None or len(parts) <= 2:
                self._trees_pending = True
                return True
            if sub in ("HEAD", "index") or sub.startswith("logs/"):
                self._git_pending.add(key)
                return True
            return False
        git_rel = ".git" if rel == "." else f".git/{rel}"
        if _is_git_head_metadata_path(git_rel):
            self._git_head_pending = True
            self._git_pending.add("")
            return True
        if git_rel == ".git/index":
            self._git_pending.add("")
            return True
        return False

    def _schedule_flush_locked(self) -> None:
        if self._timer:
            self._timer.cancel()
        self._timer = threading.Timer(_DEBOUNCE_SEC, self._flush)
        self._timer.daemon = True
        self._timer.start()

    def _flush(self) -> None:
        if not self._flush_lock.acquire(blocking=False):
            self._schedule_flush()
            return
        try:
            self._flush_locked()
        finally:
            self._flush_lock.release()

    def _schedule_flush(self) -> None:
        with self._lock:
            self._schedule_flush_locked()

    def _flush_locked(self) -> None:
        with self._lock:
            paths = set(self._pending)
            tree_files = {key: set(values) for key, values in self._tree_files.items()}
            git_keys = set(self._git_pending)
            git_head_changed = self._git_head_pending
            trees_changed = self._trees_pending
            full_rescan = self._full_rescan_pending
            self._pending.clear()
            self._tree_files.clear()
            self._git_pending.clear()
            self._git_head_pending = False
            self._trees_pending = False
            self._full_rescan_pending = False
            self._timer = None
        if not (paths or tree_files or git_keys or git_head_changed or trees_changed or full_rescan):
            return
        if trees_changed:
            trees = self._load_trees()
            with self._lock:
                self._trees = trees
            self._on_trees_changed(trees)
        roots = {tree[0]: tree[1] for tree in self._trees}
        if full_rescan:
            git_keys.update(roots)
        for key, tree_paths in tree_files.items():
            if key in git_keys or key not in roots:
                continue
            rels = [os.path.relpath(path, roots[key]) for path in tree_paths]
            try:
                ignored = git_ignored_rel_paths(roots[key], rels)
            except RuntimeError as exc:
                self._report_failure(f"git check-ignore failed: {exc}")
                ignored = set()
            if any(rel not in ignored for rel in rels):
                git_keys.add(key)
        workspace = self._files.workspace
        file_rels = [
            rel for rel in (os.path.relpath(path, workspace) for path in paths)
            if not self._files.file_index_path_is_ignored(rel)
        ]
        if git_head_changed:
            try:
                self._on_head_changed()
            except Exception as exc:
                self._report_failure(f"Commit tracking failed: {exc}")
        if git_head_changed or full_rescan:
            clear_commit_list_cache()
        if file_rels or full_rescan:
            self._publish_event("files")
        for key in sorted(git_keys):
            self._publish_event(f"git:{key}")
        with self._lock:
            has_more = bool(self._pending or self._tree_files or self._git_pending or self._git_head_pending or self._trees_pending)
        if has_more:
            self._schedule_flush()


def _watch_paths(paths: list[str], on_path, on_rescan, report_failure, name: str) -> None:
    def run_loop():
        cf, cs = load_cf_cs()
        CFRelease = cf.CFRelease
        CFRelease.argtypes = [c_void_p]
        CFRelease.restype = None

        FSEventStreamCreate = cs.FSEventStreamCreate
        FSEventStreamCreate.restype = c_void_p
        FSEventStreamCreate.argtypes = [c_void_p, FSEventCallback, c_void_p, c_void_p, c_uint64, c_double, c_uint32]
        FSEventStreamScheduleWithRunLoop = cs.FSEventStreamScheduleWithRunLoop
        FSEventStreamScheduleWithRunLoop.argtypes = [c_void_p, c_void_p, c_void_p]
        FSEventStreamScheduleWithRunLoop.restype = None
        FSEventStreamStart = cs.FSEventStreamStart
        FSEventStreamStart.argtypes = [c_void_p]
        FSEventStreamStart.restype = ctypes.c_bool
        CFRunLoopGetCurrent = cf.CFRunLoopGetCurrent
        CFRunLoopGetCurrent.restype = c_void_p
        CFRunLoopGetCurrent.argtypes = []
        CFRunLoopRun = cf.CFRunLoopRun
        CFRunLoopRun.restype = None
        CFRunLoopRun.argtypes = []
        kCFRunLoopDefaultMode = c_void_p.in_dll(cf, "kCFRunLoopDefaultMode")

        def on_events(_stream, _info, num, event_paths, flags, _ids):
            if not num or not event_paths:
                return
            if any(flags[index] & FSEVENT_RESCAN_FLAGS for index in range(num)):
                on_rescan()
                return
            for index in range(num):
                if event_paths[index]:
                    on_path(os.fsdecode(event_paths[index]))

        callback = FSEventCallback(on_events)

        cfarr = cf_path_array(cf, paths)
        stream = FSEventStreamCreate(
            None,
            callback,
            None,
            cfarr,
            c_uint64(KFSEVENTSTREAM_EVENT_ID_SINCE_NOW),
            0.05,
            c_uint32(FSEVENT_CREATE_FLAGS),
        )
        CFRelease(cfarr)
        if not stream:
            report_failure("Workspace watch failed: FSEventStreamCreate returned null")
            return
        FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode)
        if not FSEventStreamStart(stream):
            report_failure("Workspace watch failed: FSEventStreamStart returned false")
            return
        CFRunLoopRun()

    threading.Thread(target=run_loop, daemon=True, name=name).start()


def start_workspace_fsevents_watcher(files, *, publish_event, report_failure, on_head_changed) -> None:
    workspace_root = files.workspace
    if not workspace_root or not os.path.isdir(workspace_root):
        return
    watched_roots: set[str] = set()

    def watch_outside_trees(trees) -> None:
        for _key, root, _gitdir in trees:
            if root in watched_roots or _is_under(root, workspace_root):
                continue
            watched_roots.add(root)
            _watch_paths([root], debouncer.add_path, debouncer.mark_full_rescan, report_failure, f"worktree-fsevents:{root}")

    debouncer = _DebouncedWorkspaceRefresh(
        files,
        publish_event=publish_event,
        report_failure=report_failure,
        on_head_changed=on_head_changed,
        on_trees_changed=watch_outside_trees,
    )
    _watch_paths([workspace_root], debouncer.add_path, debouncer.mark_full_rescan, report_failure, "workspace-fsevents")
    watch_outside_trees(debouncer.trees)
