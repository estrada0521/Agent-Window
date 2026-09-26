from __future__ import annotations

import os
import shutil
from pathlib import Path

from server.room.probe import read_room_server_state
from fs.log.meta import read_log_meta, log_workspace_claims
from tmux.control import (
    RoomControlError,
    open_room,
    archive_room,
    stop_room_server,
)
from fs.log.paths import (
    port_is_bindable,
    log_dir,
    workspace_room_port,
    workspace_log_link_path,
)
from server.room.room_process import launch_room_server, wait_for_room_server
from server.hub.timeline_query import live_timelines_query


class TmuxUnhealthy(RuntimeError):
    pass


def room_server_state_matches(hub, state: dict | None, *, workspace: str) -> bool:
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


def room_launch_env(hub) -> dict[str, str]:
    env = os.environ.copy()
    pythonpath_parts = [str(hub.repo_root)]
    existing_pythonpath = (env.get("PYTHONPATH") or "").strip()
    if existing_pythonpath:
        pythonpath_parts.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    return env


def stop_inactive_room_servers(*, keep_workspace: str = "") -> str:
    for _name, workspace in log_workspace_claims().values():
        if workspace == keep_workspace:
            continue
        port = workspace_room_port(workspace)
        state = read_room_server_state(port)
        if not state or state.get("active"):
            continue
        stop_ok, stop_detail = stop_room_server(workspace)
        if not stop_ok:
            return stop_detail
    return ""


def ensure_room_server(
    hub,
    *,
    expected_active: bool = True,
    workspace: str,
) -> tuple[bool, int, str]:
    resolved_workspace = str(Path(workspace).expanduser().resolve())
    lock = hub._get_launch_lock(resolved_workspace)
    with lock:
        room_port = workspace_room_port(resolved_workspace)
        state = read_room_server_state(room_port)
        same_server = room_server_state_matches(hub, state, workspace=resolved_workspace)
        if same_server and bool(state.get("active")) == bool(expected_active):
            return True, room_port, ""
        if same_server:
            stop_ok, stop_detail = stop_room_server(resolved_workspace)
            if not stop_ok:
                return False, room_port, stop_detail
        elif not port_is_bindable(room_port):
            return False, room_port, f"room port {room_port} is occupied"

        if not expected_active:
            stop_detail = stop_inactive_room_servers(keep_workspace=resolved_workspace)
            if stop_detail:
                return False, room_port, stop_detail

        env = room_launch_env(hub)
        try:
            process = launch_room_server(resolved_workspace, env=env)
        except OSError as exc:
            return False, room_port, str(exc)

        def _ready() -> bool:
            state = read_room_server_state(room_port)
            return (
                bool(state)
                and room_server_state_matches(hub, state, workspace=resolved_workspace)
                and bool(state.get("active")) == bool(expected_active)
            )

        detail = wait_for_room_server(process, _ready)
        return not detail, room_port, detail


def request_room_revive(hub, timeline_label: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if timeline_label in live.workspaces:
        return True, ""
    try:
        meta = read_log_meta(timeline_label)
    except FileNotFoundError:
        return False, "That archived timeline is not available in this repo."
    workspace = meta["workspace"]
    if not Path(workspace).is_dir():
        return False, f"Saved workspace is unavailable: {workspace}"
    stop_ok, stop_detail = stop_room_server(workspace)
    if not stop_ok:
        return False, stop_detail
    room_port = workspace_room_port(workspace)
    if not port_is_bindable(room_port):
        return False, f"room port {room_port} is occupied"
    try:
        open_room(
            timeline_label=timeline_label,
            workspace=workspace,
            agents=meta["agents"],
            repo_root=hub.repo_root,
            revive=True,
        )
    except RoomControlError as exc:
        return False, str(exc)
    return True, ""


def request_room_archive(hub, timeline_label: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if timeline_label not in live.workspaces:
        return False, "That active timeline is not available in this repo."
    try:
        archive_room(timeline_label=timeline_label)
    except RoomControlError as exc:
        return False, str(exc)
    return True, ""


def delete_archived_timeline(hub, timeline_label: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if timeline_label in live.workspaces:
        return False, "That archived timeline is not available in this repo."
    try:
        workspace = read_log_meta(timeline_label)["workspace"]
    except FileNotFoundError:
        return False, "That archived timeline is not available in this repo."
    stop_ok, stop_detail = stop_room_server(workspace)
    if not stop_ok:
        return False, stop_detail
    link = workspace_log_link_path(workspace)
    if link.is_symlink():
        try:
            link.unlink()
        except OSError as exc:
            return False, str(exc)
    try:
        shutil.rmtree(log_dir(timeline_label))
    except OSError as exc:
        return False, str(exc)
    return True, ""
