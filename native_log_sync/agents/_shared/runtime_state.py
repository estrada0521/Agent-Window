from __future__ import annotations

import dataclasses
import threading
import time

from native_log_sync.agents._shared.path_state import (
    _load_path_progress,
    _load_pane_paths,
)


def initialize_native_log_runtime_state(runtime: object) -> None:
    runtime._idle_running_display_by_agent = {}
    runtime._pane_native_log_paths = {}
    runtime._native_log_bindings_by_agent = {}
    runtime._native_log_watch_reconfigure = threading.Event()
    runtime._native_log_bindings_lock = threading.Lock()
    runtime._native_log_sync_lock = threading.Lock()
    runtime._idle_running_event_seq = 0
    runtime._idle_running_display_lock = threading.Lock()
    runtime._idle_running_display_queues = {}
    runtime._idle_running_display_timers = {}

    runtime._sync_state = runtime.load_sync_state()

    # The durable record: for every native log path this session has ever
    # synced (regardless of which pane/instance is currently reading it),
    # how far into it we've read. This is the only place read progress is
    # tracked, so there is nothing to keep in sync across two stores.
    runtime._native_log_progress = _load_path_progress(runtime._sync_state.get("native_log_progress"))

    # Lightweight, disposable: which path each pane is currently resolved to.
    # Recomputed from path resolution every sync; safe to lose or rebuild.
    runtime._native_log_current_paths = _load_pane_paths(runtime._sync_state.get("native_log_current_paths"))

    runtime._native_log_blocked_paths: dict[str, str] = {}
    runtime._native_log_projection_status: dict[str, dict] = {}

    runtime._agent_first_seen_ts = {}
    raw_first_seen = runtime._sync_state.get("agent_first_seen_ts")
    if raw_first_seen is None:
        return
    if not isinstance(raw_first_seen, dict):
        raise ValueError("agent_first_seen_ts must be an object")
    for key, value in raw_first_seen.items():
        if not isinstance(key, str) or not key:
            raise ValueError("agent_first_seen_ts keys must be agent names")
        if not isinstance(value, (int, float)) or isinstance(value, bool):
            raise ValueError(f"agent_first_seen_ts[{key!r}] must be a number")
        runtime._agent_first_seen_ts[key] = float(value)


def first_seen_for_agent(runtime: object, agent: str, *, time_module=time) -> float:
    ts = runtime._agent_first_seen_ts.get(agent)
    if ts is None:
        ts = time_module.time()
        runtime._agent_first_seen_ts[agent] = ts
    return ts


def rename_agent_identity(runtime: object, old: str, new: str) -> None:
    """Move native-log-sync state keyed by `old` to `new`.

    Fires when singleton -> multi-instance renumbering changes which
    canonical name an already-running pane answers to. The pane, process,
    and log file are unchanged - only the key filing them needs to move.

    Transient runtime-display bookkeeping (queued tool-call text, its
    self-expiring timer) is deliberately left alone: it clears itself out
    within MIN_RUNTIME_DISPLAY_SECONDS on its own, and its timers already
    have `old` bound into their callback args, so renaming the dict key
    without also chasing down in-flight Timer objects would just trade one
    stale-name edge case for another.
    """
    with runtime._native_log_bindings_lock:
        binding = runtime._native_log_bindings_by_agent.pop(old, None)
        if binding is not None:
            runtime._native_log_bindings_by_agent[new] = dataclasses.replace(binding, agent=new)
        runtime._native_log_watch_reconfigure.set()

    for store_name in ("_agent_first_seen_ts", "_native_log_projection_status", "_native_log_blocked_paths"):
        store = getattr(runtime, store_name)
        if old in store:
            store[new] = store.pop(old)

    watcher = getattr(runtime, "_native_log_vnode_watcher", None)
    if watcher is not None:
        watcher.wake()
