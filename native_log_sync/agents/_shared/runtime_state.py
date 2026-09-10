from __future__ import annotations

import threading


def initialize_native_log_runtime_state(runtime: object) -> None:
    runtime._idle_running_display_by_agent = {}
    runtime._native_log_bindings_by_agent = {}
    runtime._native_log_watch_reconfigure = threading.Event()
    runtime._native_log_bindings_lock = threading.Lock()
    runtime._native_log_sync_lock = threading.Lock()
    runtime._idle_running_event_seq = 0
    runtime._idle_running_display_lock = threading.Lock()
    runtime._idle_running_display_queues = {}
    runtime._idle_running_display_timers = {}
    runtime._native_log_read_offsets = {}
    runtime._native_log_projection_status: dict[str, dict] = {}
