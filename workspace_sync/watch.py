from __future__ import annotations

import ctypes
import logging
import os
import threading
import time
from ctypes import c_double, c_uint32, c_uint64, c_void_p

from native_log_sync.io.fsevents_stream import (
    FSEVENT_CREATE_FLAGS,
    FSEVENT_RESCAN_FLAGS,
    FSEventCallback,
    KFSEVENTSTREAM_EVENT_ID_SINCE_NOW,
    cf_path_array,
    load_cf_cs,
)
from workspace_sync.git import git_ignored_rel_paths

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
    def __init__(self, workspace_sync_api) -> None:
        self._api = workspace_sync_api
        self._lock = threading.Lock()
        self._flush_lock = threading.Lock()
        self._pending: set[str] = set()
        self._git_head_pending = False
        self._full_rescan_pending = False
        self._timer: threading.Timer | None = None

    def mark_full_rescan(self) -> None:
        # FSEvents told us it coalesced or dropped individual path events, so the
        # reported paths for this batch can't be trusted to cover everything that
        # changed. Treat the whole workspace as dirty instead of guessing which
        # subtree needs a rescan.
        with self._lock:
            self._full_rescan_pending = True
            self._git_head_pending = True
            self._schedule_flush_locked()

    def add_path(self, path: str) -> None:
        normalized = os.path.realpath(path)
        workspace = self._api.file_runtime.workspace
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
        workspace = self._api.file_runtime.workspace
        rels = [os.path.relpath(path, workspace) for path in paths]
        file_rels = [rel for rel in rels if not self._api.file_runtime.file_index_path_is_ignored(rel)]
        if file_rels or full_rescan:
            try:
                self._api.invalidate_file_index_cache()
            except Exception as exc:
                logging.error("Workspace file index invalidation failed: %s", exc)
        git_relevant = git_head_changed or full_rescan
        if rels and not git_relevant:
            try:
                ignored = git_ignored_rel_paths(workspace, rels)
            except Exception as exc:
                logging.error("git check-ignore failed: %s", exc)
                ignored = set()
            git_relevant = any(rel not in ignored for rel in rels)
        if git_head_changed:
            try:
                self._api.runtime.ensure_commit_announcements()
            except Exception as exc:
                logging.error("Commit announcement refresh failed: %s", exc)
        if git_relevant:
            try:
                self._api.invalidate_git_cache()
            except Exception as exc:
                logging.error("Workspace git cache invalidation failed: %s", exc)
        try:
            self._api.publish_sync_event()
        except Exception as exc:
            logging.error("Workspace sync event publish failed: %s", exc)
        with self._lock:
            has_more = bool(self._pending) or self._git_head_pending
        if has_more:
            self._schedule_flush()


def start_workspace_fsevents_watcher(workspace_sync_api) -> None:
    workspace_root = workspace_sync_api.file_runtime.workspace
    if not workspace_root or not os.path.isdir(workspace_root):
        return

    debouncer = _DebouncedWorkspaceRefresh(workspace_sync_api)

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
        FSEventStreamStop = cs.FSEventStreamStop
        FSEventStreamStop.argtypes = [c_void_p, c_void_p]
        FSEventStreamStop.restype = None
        FSEventStreamInvalidate = cs.FSEventStreamInvalidate
        FSEventStreamInvalidate.argtypes = [c_void_p]
        FSEventStreamInvalidate.restype = None
        FSEventStreamRelease = cs.FSEventStreamRelease
        FSEventStreamRelease.argtypes = [c_void_p]
        FSEventStreamRelease.restype = None
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
                try:
                    raw = paths[index]
                    if not raw:
                        continue
                    debouncer.add_path(raw.decode("utf-8"))
                except Exception:
                    continue

        callback = FSEventCallback(on_events)

        while True:
            try:
                watch_root = workspace_sync_api.file_runtime.workspace
                if not watch_root or not os.path.isdir(watch_root):
                    time.sleep(2.0)
                    continue
                cfarr = cf_path_array(cf, [watch_root])
                if not cfarr:
                    time.sleep(2.0)
                    continue
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
                    time.sleep(2.0)
                    continue
                run_loop_handle = CFRunLoopGetCurrent()
                FSEventStreamScheduleWithRunLoop(stream, run_loop_handle, kCFRunLoopDefaultMode)
                if not FSEventStreamStart(stream):
                    FSEventStreamInvalidate(stream)
                    FSEventStreamRelease(stream)
                    time.sleep(2.0)
                    continue
                CFRunLoopRun()
                FSEventStreamStop(stream, run_loop_handle)
                FSEventStreamInvalidate(stream)
                FSEventStreamRelease(stream)
            except Exception as exc:
                logging.error("Workspace FSEvents watcher error: %s", exc)
                time.sleep(2.0)

    threading.Thread(target=run_loop, daemon=True, name="workspace-fsevents").start()
