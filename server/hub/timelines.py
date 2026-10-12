from __future__ import annotations

import shutil
from pathlib import Path

from fs.log.meta import read_log_meta
from server.timeline.control import (
    SessionControlError,
    create_session,
    kill_session,
)
from fs.log.paths import (
    agent_window_log_root,
    workspace_log_link_path,
)
from server.hub.timeline_query import live_timelines_query


class TmuxUnhealthy(RuntimeError):
    pass


def revive_timeline(hub, timeline_name: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if timeline_name in live.workspaces:
        return True, ""
    try:
        meta = read_log_meta(timeline_name)
    except FileNotFoundError:
        return False, "That archived timeline is not available in this repo."
    workspace = meta["workspace"]
    if not Path(workspace).is_dir():
        return False, "Workspace not found"
    with hub._get_timeline_lock(workspace):
        hub.close_timeline(workspace)
        try:
            create_session(
                timeline_name=timeline_name,
                workspace=workspace,
                agents=meta["agents"],
                revive=True,
            )
        except SessionControlError as exc:
            return False, str(exc)
    return True, ""


def archive_timeline(hub, timeline_name: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    if timeline_name not in live.workspaces:
        return False, "That active timeline is not available in this repo."
    workspace = live.workspaces[timeline_name]
    with hub._get_timeline_lock(workspace):
        hub.close_timeline(workspace)
        try:
            kill_session(timeline_name=timeline_name)
        except SessionControlError as exc:
            return False, str(exc)
    return True, ""


def delete_archived_timeline(hub, timeline_name: str) -> tuple[bool, str]:
    live = live_timelines_query(hub)
    if live.state == "unhealthy":
        raise TmuxUnhealthy(live.detail)
    directory = next((
        entry for entry in agent_window_log_root().iterdir()
        if entry.is_dir() and entry.name == timeline_name and entry.name not in live.workspaces
    ), None)
    if directory is None:
        return False, "That archived timeline is not available in this repo."
    workspace = read_log_meta(directory.name)["workspace"]
    with hub._get_timeline_lock(workspace):
        hub.close_timeline(workspace)
        link = workspace_log_link_path(workspace)
        try:
            if link.is_symlink():
                link.unlink()
            shutil.rmtree(directory)
        except OSError as exc:
            return False, str(exc)
    return True, ""
