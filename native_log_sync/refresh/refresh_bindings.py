from __future__ import annotations

from native_log_sync.agents import resolve_binding
from native_log_sync.refresh.binding_models import NativeLogBinding, PaneBindingRequest


def refresh_native_log_bindings(
    runtime,
    pane_requests: list[PaneBindingRequest],
    *,
    replace_all: bool = True,
) -> list[NativeLogBinding]:
    bindings: list[NativeLogBinding] = []
    with getattr(runtime, "_native_log_bindings_lock"):
        if replace_all:
            next_by_agent: dict[str, NativeLogBinding] = {}
        else:
            next_by_agent = dict(getattr(runtime, "_native_log_bindings_by_agent", {}))

        for request in pane_requests:
            if not replace_all:
                next_by_agent.pop(request.agent, None)
            binding = resolve_binding(runtime, request)
            if binding is None:
                continue
            bindings.append(binding)
            next_by_agent[binding.agent] = binding

        runtime._native_log_bindings_by_agent = next_by_agent
        runtime._native_log_watch_reconfigure.set()
    watcher = getattr(runtime, "_native_log_vnode_watcher", None)
    if watcher is not None:
        watcher.wake()
    return bindings


def remove_native_log_binding(runtime, agent: str) -> None:
    with getattr(runtime, "_native_log_bindings_lock"):
        getattr(runtime, "_native_log_bindings_by_agent", {}).pop(agent, None)
        runtime._native_log_watch_reconfigure.set()
    watcher = getattr(runtime, "_native_log_vnode_watcher", None)
    if watcher is not None:
        watcher.wake()
