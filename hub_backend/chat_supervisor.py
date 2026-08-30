from __future__ import annotations

import os
import shutil
from pathlib import Path

from backend_core.access.chat_server import read_chat_server_state
from backend_core.tmux.control import (
    SessionControlError,
    create_session,
    kill_session,
    stop_chat_server as stop_chat_server_impl,
)
from backend_core.access.settings import (
    agent_window_run_dir,
    agent_window_session_root,
    port_is_bindable,
    pwa_https_enabled,
    workspace_chat_port,
)
from server.chat_process import launch_chat_server, wait_for_chat_server
from hub_backend.session_query import active_session_records_query, archived_session_records

def chat_server_state(self, chat_port: int) -> dict | None:
    scheme = str(getattr(self, "hub_scheme", "") or "").strip().lower()
    return read_chat_server_state(chat_port, scheme=scheme)


def chat_server_state_matches(self, state: dict | None, *, workspace: str) -> bool:
    if not state:
        return False
    raw_workspace = str(workspace or "").strip()
    if not raw_workspace:
        return False
    reported_repo_root = str(state.get("repo_root") or "").strip()
    if reported_repo_root != str(self.repo_root):
        return False
    expected_workspace = str(Path(raw_workspace).expanduser().resolve())
    reported_workspace = str(state.get("workspace") or "").strip()
    if not reported_workspace or str(Path(reported_workspace).expanduser().resolve()) != expected_workspace:
        return False
    return True


def stop_chat_server(self, workspace: str) -> tuple[bool, str]:
    return stop_chat_server_impl(workspace)


def chat_launch_env(self) -> dict[str, str]:
    env = os.environ.copy()
    env["AGENT_WINDOW_AGENT_NAME"] = "user"
    if self.tmux_socket:
        env["AGENT_WINDOW_TMUX_SOCKET"] = self.tmux_socket
    env["AGENT_INDEX_HUB_PORT"] = str(self.hub_port)
    env["AGENT_WINDOW_RUN_DIR"] = str(agent_window_run_dir())
    pythonpath_parts = [str(self.repo_root)]
    existing_pythonpath = (env.get("PYTHONPATH") or "").strip()
    if existing_pythonpath:
        pythonpath_parts.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    if pwa_https_enabled():
        return env
    env.pop("AGENT_WINDOW_CERT_FILE", None)
    env.pop("AGENT_WINDOW_KEY_FILE", None)
    return env


def stop_inactive_chat_servers(self, *, keep_workspace: str = "") -> str:
    query = active_session_records_query(self)
    archived = archived_session_records(query.non_archived_names)
    keep = str(keep_workspace or "").strip()
    for record in archived.values():
        workspace = str(record.get("workspace") or "").strip()
        if not workspace or workspace == keep:
            continue
        port = workspace_chat_port(workspace)
        state = chat_server_state(self, port)
        if not state or state.get("active"):
            continue
        stop_ok, stop_detail = stop_chat_server(self, workspace)
        if not stop_ok:
            return stop_detail
    return ""


def ensure_chat_server(
    self,
    *,
    expected_active: bool = True,
    workspace: str = "",
) -> tuple[bool, int, str]:
    raw_workspace = str(workspace or "").strip()
    if not raw_workspace:
        return False, 0, (
            "No workspace is set for this session. A workspace is required "
            "to determine the chat server's port; if you only need to view "
            "this session, set any placeholder workspace path."
        )
    resolved_workspace = str(Path(raw_workspace).expanduser().resolve())
    lock = self._get_launch_lock(resolved_workspace)
    with lock:
        chat_port = workspace_chat_port(resolved_workspace)
        state = chat_server_state(self, chat_port)
        same_server = chat_server_state_matches(self, state, workspace=resolved_workspace)
        if same_server and bool(state.get("active")) == bool(expected_active):
            return True, chat_port, ""
        if same_server:
            stop_ok, stop_detail = stop_chat_server(self, resolved_workspace)
            if not stop_ok:
                return False, chat_port, stop_detail
        elif not port_is_bindable(chat_port):
            return False, chat_port, f"chat port {chat_port} is occupied"

        if not expected_active:
            stop_detail = stop_inactive_chat_servers(self, keep_workspace=resolved_workspace)
            if stop_detail:
                return False, chat_port, stop_detail

        env = chat_launch_env(self)
        try:
            process = launch_chat_server(resolved_workspace, env=env)
        except OSError as exc:
            return False, chat_port, str(exc)

        def _ready() -> bool:
            state = chat_server_state(self, chat_port)
            return (
                bool(state)
                and chat_server_state_matches(self, state, workspace=resolved_workspace)
                and bool(state.get("active")) == bool(expected_active)
            )

        if wait_for_chat_server(process, _ready):
            return True, chat_port, ""
        return False, chat_port, "chat server did not become ready"


def revive_archived_session(self, session_name: str) -> tuple[bool, str]:
    query = active_session_records_query(self)
    if query.state == "unhealthy":
        return False, f"tmux is currently unresponsive ({query.detail})"
    active_records = query.records
    if session_name in active_records:
        return True, ""
    archived = archived_session_records(query.non_archived_names)
    record = archived.get(session_name)
    if not record:
        return False, "That archived session is not available in this repo."
    workspace = (record.get("workspace") or "").strip()
    if not workspace or not Path(workspace).is_dir():
        return False, f"Saved workspace is unavailable: {workspace or 'unknown'}"
    stop_ok, stop_detail = stop_chat_server(self, workspace)
    if not stop_ok:
        return False, stop_detail
    # Checked before create_session: workspace alone determines the chat
    # port, so a collision is knowable up front. Finding out only after the
    # tmux session is revived would leave it running with no way to reach
    # it, and revive_archived_session doesn't roll a revive back on failure.
    chat_port = workspace_chat_port(workspace)
    if not port_is_bindable(chat_port):
        return False, f"chat port {chat_port} is occupied"
    try:
        create_session(
            session_name=session_name,
            workspace=workspace,
            agents=[str(item).strip() for item in (record.get("agents") or []) if str(item).strip()],
            tmux_socket=self.tmux_socket,
            repo_root=self.repo_root,
            lifecycle_action="revived",
        )
    except SessionControlError as exc:
        return False, str(exc)
    return True, ""


def kill_repo_session(self, session_name: str) -> tuple[bool, str]:
    query = active_session_records_query(self)
    if query.state == "unhealthy":
        return False, f"tmux is unresponsive, cannot confirm session state ({query.detail})"

    active = query.records
    if session_name not in active:
        return False, "That active session is not available in this repo."
    try:
        kill_session(session_name=session_name, tmux_socket=self.tmux_socket)
    except SessionControlError as exc:
        return False, str(exc)
    return True, ""


def delete_archived_session(self, session_name: str) -> tuple[bool, str]:
    query = active_session_records_query(self)
    if query.state == "unhealthy":
        return False, f"tmux is unresponsive, cannot safely delete archived session ({query.detail})"

    archived = archived_session_records(query.non_archived_names)
    record = archived.get(session_name)
    if not record:
        return False, "That archived session is not available in this repo."
    workspace = str(record.get("workspace") or "").strip()
    if not workspace:
        return False, "workspace unavailable"
    stop_ok, stop_detail = stop_chat_server(self, workspace)
    if not stop_ok:
        return False, stop_detail
    log_dir = Path((record.get("log_dir") or "").strip())
    if not log_dir.exists():
        return True, ""
    allowed_roots = [
        agent_window_session_root().resolve(),
    ]
    try:
        resolved = log_dir.resolve()
    except OSError as exc:
        return False, str(exc)
    if not any(root == resolved or root in resolved.parents for root in allowed_roots):
        return False, "Refusing to delete a path outside agent-window log roots."
    try:
        shutil.rmtree(resolved)
    except OSError as exc:
        return False, str(exc)
    return True, ""
