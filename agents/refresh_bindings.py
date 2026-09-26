from __future__ import annotations

from agents import resolve_binding
from agents.binding_models import NativeLogBinding, PaneBindingRequest


def refresh_native_log_bindings(
    state,
    pane_requests: list[PaneBindingRequest],
    *,
    replace_all: bool = True,
) -> list[NativeLogBinding]:
    bindings: list[NativeLogBinding] = []
    with state._native_log_bindings_lock:
        if replace_all:
            next_by_agent: dict[str, NativeLogBinding] = {}
        else:
            next_by_agent = dict(state._native_log_bindings_by_agent)

        for request in pane_requests:
            if not replace_all:
                next_by_agent.pop(request.agent, None)
            binding = resolve_binding(state, request)
            if binding is None:
                continue
            bindings.append(binding)
            next_by_agent[binding.agent] = binding

        state._native_log_bindings_by_agent = next_by_agent
    if state._native_log_vnode_watcher is not None:
        state._native_log_vnode_watcher.wake()
    return bindings


def remove_native_log_binding(state, agent: str) -> None:
    with state._native_log_bindings_lock:
        state._native_log_bindings_by_agent.pop(agent, None)
    if state._native_log_vnode_watcher is not None:
        state._native_log_vnode_watcher.wake()
