from __future__ import annotations

import os
import shutil
from pathlib import Path

from backend_core.access.chat_server import read_chat_server_state
from backend_core.access.session_meta import read_session_meta, session_workspace_claims
from backend_core.tmux.control import (
    SessionControlError,
    create_session,
    kill_session,
    stop_chat_server,
)
from backend_core.access.settings import (
    port_is_bindable,
    session_artifact_dir,
    workspace_chat_port,
    workspace_log_link_path,
)
from server.chat_process import launch_chat_server, wait_for_chat_server
from hub_backend.session_query import live_sessions_query


class TmuxUnhealthy(RuntimeError):
    pass


def chat_server_state_matches(hub, state: dict | None, *, workspace: str) -> bool:
    if not state:
        return False
    reported_repo_root = str(state.get("repo_root") or "").strip()
    if reported_repo_root != str(hub.repo_root):
        return False
    expected_workspace = str(Path(workspace).expanduser().resolve())
    reported_workspace = str(state.get("workspace") or "").strip()
    if not reported_workspace or str(Path(reported_workspace).expanduser().resolve()) != expected_workspace:
        return False
    return True


def chat_launch_env(hub) -> dict[str, str]:
    env = os.environ.copy()
    pythonpath_parts = [str(hub.repo_root)]
    existing_pythonpath = (env.get("PYTHONPATH") or "").strip()
    if existing_pythonpath:
        pythonpath_parts.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    return env


def stop_inactive_chat_servers(*, keep_workspace: str = "") -> str:
    for _name, workspace in session_workspace_claims().values():
        if workspace == keep_workspace:
            continue
        port = workspace_chat_port(workspace)
        state = read_chat_server_state(port)
        if not state or state.get("active"):
            continue
        stop_ok, stop_detail = stop_chat_server(workspace)
        if not stop_ok:
            return stop_detail
    return ""


def ensure_chat_server(
    hub,
    *,
    expected_active: bool = True,
    workspace: str,
) -> tuple[bool, int, str]:
    resolved_workspace = str(Path(workspace).expanduser().resolve())
    lock = hub._get_launch_lock(resolved_workspace)
    with lock:
        chat_port = workspace_chat_port(resolved_workspace)
        state = read_chat_server_state(chat_port)
        same_server = chat_server_state_matches(hub, state, workspace=resolved_workspace)
        if same_server and bool(state.get("active")) == bool(expected_active):
            return True, chat_port, ""
        if same_server:
            stop_ok, stop_detail = stop_chat_server(resolved_workspace)
            if not stop_ok:
                return False, chat_port, stop_detail
        elif not port_is_bindable(chat_port):
            return False, chat_port, f"chat port {chat_port} is occupied"

        if not expected_active:
            stop_detail = stop_inactive_chat_servers(keep_workspace=resolved_workspace)
            if stop_detail:
                return False, chat_port, stop_detail

        env = chat_launch_env(hub)
        try:
            process = launch_chat_server(resolved_workspace, env=env)
        except OSError as exc:
            return False, chat_port, str(exc)

        def _ready() -> bool:
            state = read_chat_server_state(chat_port)
            return (
                bool(state)
                and chat_server_state_matches(hub, state, workspace=resolved_workspace)
                and bool(state.get("active")) == bool(expected_active)
            )

        detail = wait_for_chat_server(process, _ready)
        return not detail, chat_port, detail


def revive_archived_session(hub, session_name: str) -> tuple[bool, str]:
    live = live_sessions_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if session_name in live.workspaces:
        return True, ""
    try:
        meta = read_session_meta(session_name)
    except FileNotFoundError:
        return False, "That archived session is not available in this repo."
    workspace = meta["workspace"]
    if not Path(workspace).is_dir():
        return False, f"Saved workspace is unavailable: {workspace}"
    stop_ok, stop_detail = stop_chat_server(workspace)
    if not stop_ok:
        return False, stop_detail
    chat_port = workspace_chat_port(workspace)
    if not port_is_bindable(chat_port):
        return False, f"chat port {chat_port} is occupied"
    try:
        create_session(
            session_name=session_name,
            workspace=workspace,
            agents=meta["agents"],
            repo_root=hub.repo_root,
            revive=True,
        )
    except SessionControlError as exc:
        return False, str(exc)
    return True, ""


def kill_repo_session(hub, session_name: str) -> tuple[bool, str]:
    live = live_sessions_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if session_name not in live.workspaces:
        return False, "That active session is not available in this repo."
    try:
        kill_session(session_name=session_name)
    except SessionControlError as exc:
        return False, str(exc)
    return True, ""


def delete_archived_session(hub, session_name: str) -> tuple[bool, str]:
    live = live_sessions_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if session_name in live.workspaces:
        return False, "That archived session is not available in this repo."
    try:
        workspace = read_session_meta(session_name)["workspace"]
    except FileNotFoundError:
        return False, "That archived session is not available in this repo."
    stop_ok, stop_detail = stop_chat_server(workspace)
    if not stop_ok:
        return False, stop_detail
    link = workspace_log_link_path(workspace)
    if link.is_symlink():
        try:
            link.unlink()
        except OSError as exc:
            return False, str(exc)
    try:
        shutil.rmtree(session_artifact_dir(session_name))
    except OSError as exc:
        return False, str(exc)
    return True, ""
