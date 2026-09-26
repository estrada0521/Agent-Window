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
from git.commit import ensure_commit_announcements
from git.repo import git_ignored_rel_paths, invalidate_git_cache

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


class _DebouncedWorkspaceRefresh:
    def __init__(self, runtime, file_runtime) -> None:
        self._runtime = runtime
        self._file_runtime = file_runtime
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._pending: set[str] = set()
        self._git_head_pending = False
        self._full_rescan_pending = False
        self._timer: threading.Timer | None = None

    def mark_full_rescan(self) -> None:
        with self._lock:
            self._full_rescan_pending = True
            self._git_head_pending = True
            self._schedule_flush_locked()

    def add_path(self, path: str) -> None:
        normalized = os.path.realpath(path)
        workspace = self._file_runtime.workspace
        if not normalized.startswith(workspace):
            return
        rel = os.path.relpath(normalized, workspace)
        if rel == ".git" or rel.startswith(".git/"):
            if _is_git_head_metadata_path(rel):
                with self._lock:
                    self._git_head_pending = True
                    self._schedule_flush_locked()
            return
        with self._lock:
            self._pending.add(normalized)
            self._schedule_flush_locked()

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
            git_head_changed = self._git_head_pending
            full_rescan = self._full_rescan_pending
            self._pending.clear()
            self._git_head_pending = False
            self._full_rescan_pending = False
            self._timer = None
        if not paths and not git_head_changed and not full_rescan:
            return
        workspace = self._file_runtime.workspace
        rels = [os.path.relpath(path, workspace) for path in paths]
        file_rels = [rel for rel in rels if not self._file_runtime.file_index_path_is_ignored(rel)]
        if file_rels or full_rescan:
            self._file_runtime.invalidate_file_list_cache()
        git_relevant = git_head_changed or full_rescan
        if rels and not git_relevant:
            try:
                ignored = git_ignored_rel_paths(workspace, rels)
            except RuntimeError as exc:
                self._runtime.report_failure(f"git check-ignore failed: {exc}")
                ignored = set()
            git_relevant = any(rel not in ignored for rel in rels)
        if git_head_changed:
            try:
                ensure_commit_announcements(self._runtime)
            except Exception as exc:
                self._runtime.report_failure(f"commit tracking failed: {exc}")
        if git_relevant:
            invalidate_git_cache(include_commits=git_head_changed or full_rescan)
        if file_rels or full_rescan:
            self._runtime.publish_event("files")
        if git_relevant:
            self._runtime.publish_event("git")
        with self._lock:
            has_more = bool(self._pending) or self._git_head_pending
        if has_more:
            self._schedule_flush()


def start_workspace_fsevents_watcher(runtime, file_runtime) -> None:
    workspace_root = file_runtime.workspace
    if not workspace_root or not os.path.isdir(workspace_root):
        return

    debouncer = _DebouncedWorkspaceRefresh(runtime, file_runtime)

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

        def on_events(_stream, _info, num, paths, flags, _ids):
            if not num or not paths:
                return
            if any(flags[index] & FSEVENT_RESCAN_FLAGS for index in range(num)):
                debouncer.mark_full_rescan()
                return
            for index in range(num):
                if paths[index]:
                    debouncer.add_path(os.fsdecode(paths[index]))

        callback = FSEventCallback(on_events)

        cfarr = cf_path_array(cf, [workspace_root])
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
            runtime.report_failure("workspace watch failed: FSEventStreamCreate returned null")
            return
        FSEventStreamScheduleWithRunLoop(stream, CFRunLoopGetCurrent(), kCFRunLoopDefaultMode)
        if not FSEventStreamStart(stream):
            runtime.report_failure("workspace watch failed: FSEventStreamStart returned false")
            return
        CFRunLoopRun()

    threading.Thread(target=run_loop, daemon=True, name="workspace-fsevents").start()
