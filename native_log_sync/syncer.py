from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable

from native_log_sync.agents._shared.runtime_state import initialize_native_log_runtime_state as _init_state
from native_log_sync.agents._shared.workspace_paths import workspace_aliases as _workspace_aliases_impl
from native_log_sync.agents._shared.projection_status import (
    record_projection_sync_failure as _record_projection_sync_failure_impl,
)
from native_log_sync.refresh.binding_models import PaneBindingRequest
from native_log_sync.refresh.refresh_bindings import (
    refresh_native_log_bindings as _refresh_bindings_impl,
    remove_native_log_binding as _remove_binding_impl,
)
from native_log_sync.watch.emit_events import (
    clear_agent_runtime_display,
    idle_running_display_for_api,
    refresh_idle_statuses,
)


class NativeLogSyncer:
    """Owns all native-log-sync state. ChatRuntime holds one instance and delegates."""

    def __init__(
        self,
        *,
        session_binding,
        workspace: str,
        mark_idle_fn: Callable[[str], None],
        mark_running_from_native_activity_fn: Callable[[str], None],
        notify_state_fn: Callable[..., None],
        active_agents_fn: Callable[[], list[str]],
        running_agents_fn: Callable[[], set[str]],
        pane_id_fn: Callable[[str], str | None],
        session_is_active_fn: Callable[[], bool],
    ) -> None:
        self._session_binding = session_binding
        self.workspace = workspace
        self._mark_idle = mark_idle_fn
        self._mark_running_from_native_activity = mark_running_from_native_activity_fn
        self._notify_state_fn = notify_state_fn
        self._active_agents_fn = active_agents_fn
        self._running_agents_fn = running_agents_fn
        self._pane_id_fn = pane_id_fn
        self._session_is_active_fn = session_is_active_fn
        _init_state(self)

    @property
    def log_path(self) -> Path:
        return self._session_binding.log_path

    @property
    def session_name(self) -> str:
        return self._session_binding.session_name

    # ── callbacks required by native_log_sync internals ──

    def notify_session_state_changed(self, keys, *, reason: str = "") -> None:
        self._notify_state_fn(keys, reason=reason)

    def active_agents(self) -> list[str]:
        return self._active_agents_fn()

    def running_agents(self) -> set[str]:
        return self._running_agents_fn()

    def pane_id_for_agent(self, agent: str) -> str | None:
        return self._pane_id_fn(agent)

    @property
    def session_is_active(self) -> bool:
        return bool(self._session_is_active_fn())

    # ── helpers used by sync functions ──

    def _workspace_aliases(self, workspace: str) -> list[str]:
        return _workspace_aliases_impl(self, workspace, path_class=Path)

    # ── public API called by ChatRuntime ──

    def refresh(
        self,
        pane_requests: list[PaneBindingRequest],
        *,
        replace_all: bool = True,
        start_at_end: bool = False,
    ) -> list[dict]:
        bindings = _refresh_bindings_impl(self, pane_requests, replace_all=replace_all)
        from native_log_sync.dispatch import sync_agent
        for binding in bindings:
            try:
                sync_agent(self, binding.agent, binding.path, start_at_end=start_at_end)
            except Exception as exc:
                logging.exception("native log sync failed for %s", binding.agent)
                _record_projection_sync_failure_impl(self, binding.agent, exc)
        return [
            {
                "agent": item.agent,
                "type": item.base,
                "pane_id": item.pane_id,
                "pane_pid": item.pane_pid,
                "log_path": item.path,
                "watch_roots": list(item.watch_roots),
                "source": item.source,
            }
            for item in bindings
        ]

    def remove_binding(self, agent: str) -> None:
        _remove_binding_impl(self, agent)

    def agent_statuses(self, running_agents: set[str]) -> dict[str, str]:
        return refresh_idle_statuses(self, running_agents)

    def clear_agent_runtime_display(self, agent: str) -> bool:
        return clear_agent_runtime_display(self, agent)

    def agent_runtime_state(self) -> dict[str, dict]:
        return idle_running_display_for_api(self._idle_running_display_by_agent)

    def watched_paths(self) -> dict[str, str]:
        watcher = getattr(self, "_native_log_vnode_watcher", None)
        return watcher.get_watched_paths() if watcher else {}

    def has_log_binding(self, agent: str) -> bool:
        return bool(getattr(self, "_native_log_bindings_by_agent", {}).get(agent))
