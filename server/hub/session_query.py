from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from fs.session.meta import (
    read_session_meta_file,
    session_workspace_claims,
)
from fs.session.paths import (
    SESSION_LOG_FILENAME,
    SESSION_META_FILENAME,
    agent_window_session_root,
    session_log_path,
)
from fs.session.paths import normalize_workspace
from fs.session.log import iter_log_entries_reversed


@dataclass(frozen=True)
class LiveSessions:
    workspaces: dict[str, str]
    state: str
    detail: str = ""


def _compact_message_preview(entry: dict[str, Any]) -> dict[str, str]:
    sender = entry["sender"]
    if sender == "system":
        return {"sender": "", "text": "", "revision": ""}
    message = entry["message"].strip()
    if not message:
        return {"sender": "", "text": "", "revision": ""}
    compact = re.sub(r"^\[From:\s*[^\]]+\]\s*", "", message, flags=re.IGNORECASE)
    compact = re.sub(r"\s+", " ", compact)
    compact = compact.strip()
    compact = compact[:140].rstrip()
    if not compact:
        return {"sender": "", "text": "", "revision": ""}
    context_hash = entry["context_hash"]
    revision = f"{context_hash}:{entry['native_log_offset']}" if "native_log_offset" in entry else context_hash
    return {"sender": sender, "text": compact, "revision": revision}


def latest_message_preview(log_path: Path) -> dict[str, str]:
    for entry in iter_log_entries_reversed(log_path):
        preview = _compact_message_preview(entry)
        if preview["text"]:
            return preview
    return {"sender": "", "text": "", "revision": ""}


def build_session_record(*, name: str, workspace: str) -> dict:
    preview = latest_message_preview(session_log_path(name))
    return {
        "name": name,
        "workspace": workspace,
        "latest_message_sender": preview["sender"],
        "latest_message_preview": preview["text"],
        "latest_message_revision": preview["revision"],
    }


def live_tmux_sessions_query(hub: Any) -> tuple[dict[str, tuple[str, int]], str, str]:
    result = hub.tmux_run(
        ["list-sessions", "-F", "#{session_name}\t#{session_created}\t#{session_path}"]
    )
    if result.timed_out:
        return {}, "unhealthy", "tmux list-sessions timed out"
    if result.returncode != 0:
        stderr = result.stderr.strip()
        if "no server running" in stderr or "No such file or directory" in stderr:
            return {}, "ok", ""
        return {}, "unhealthy", stderr or f"tmux list-sessions failed (exit {result.returncode})"

    workspace_to_tmux: dict[str, tuple[str, int]] = {}
    for raw_line in result.stdout.splitlines():
        fields = raw_line.split("\t", 2)
        if len(fields) != 3:
            return {}, "unhealthy", f"tmux list-sessions returned unreadable output: {raw_line!r}"
        tmux_name, created_raw, workspace = fields
        tmux_name = tmux_name.strip()
        workspace = workspace.strip()
        if not tmux_name or not workspace or not created_raw.isdigit():
            return {}, "unhealthy", f"tmux list-sessions returned unreadable output: {raw_line!r}"
        workspace_to_tmux.setdefault(
            normalize_workspace(workspace),
            (tmux_name, int(created_raw)),
        )
    return workspace_to_tmux, "ok", ""


def live_sessions_query(hub: Any) -> LiveSessions:
    claims = session_workspace_claims()
    workspace_to_tmux, state, detail = live_tmux_sessions_query(hub)
    if state != "ok":
        return LiveSessions({}, state, detail)
    live = sorted(
        (
            (workspace_to_tmux[normalized][1], name, workspace)
            for normalized, (name, workspace) in claims.items()
            if normalized in workspace_to_tmux
        ),
        reverse=True,
    )
    return LiveSessions({name: workspace for _created, name, workspace in live}, "ok")


def active_session_records(live: LiveSessions) -> list[dict]:
    return [build_session_record(name=name, workspace=workspace) for name, workspace in live.workspaces.items()]


def archived_session_records(live: LiveSessions) -> list[dict]:
    root = agent_window_session_root()
    if not root.is_dir():
        return []
    sessions: list[tuple[float, dict]] = []
    for entry in root.iterdir():
        if not entry.is_dir() or entry.name in live.workspaces:
            continue
        meta = read_session_meta_file(entry / SESSION_META_FILENAME)
        record = build_session_record(name=entry.name, workspace=meta["workspace"])
        record["agents"] = meta["agents"]
        sessions.append(((entry / SESSION_LOG_FILENAME).stat().st_mtime, record))
    sessions.sort(key=lambda item: item[0], reverse=True)
    return [record for _mtime, record in sessions]
