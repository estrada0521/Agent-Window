from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from backend_core.access.session_meta import (
    read_session_meta_file,
    session_workspace_claims,
)
from backend_core.access.settings import (
    SESSION_LOG_FILENAME,
    SESSION_META_FILENAME,
    agent_window_session_root,
    session_log_path,
)
from backend_core.tmux.resolve import normalize_workspace
from server.index_cache import iter_log_entries_reversed


@dataclass(frozen=True)
class SessionQueryResult:
    records: dict[str, dict]
    state: str
    detail: str = ""

    @property
    def non_archived_names(self) -> set[str]:
        return set(self.records)


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


def build_session_record(
    *,
    name: str,
    workspace: str,
) -> dict:
    preview = latest_message_preview(session_log_path(name))
    return {
        "name": name,
        "workspace": workspace,
        "latest_message_sender": preview["sender"],
        "latest_message_preview": preview["text"],
        "latest_message_revision": preview["revision"],
    }


def live_tmux_sessions_query(runtime: Any) -> tuple[dict[str, tuple[str, int]], str, str]:
    result = runtime.tmux_run(
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


def collect_repo_sessions(runtime: Any) -> tuple[list[dict], str, str]:
    claims = session_workspace_claims()
    workspace_to_tmux, state, detail = live_tmux_sessions_query(runtime)
    if state != "ok":
        return [], state, detail

    sessions: list[tuple[int, dict]] = []

    for normalized_workspace, (name, workspace) in claims.items():
        tmux_session = workspace_to_tmux.get(normalized_workspace)
        if not tmux_session:
            continue
        _tmux_name, created_epoch = tmux_session
        sessions.append(
            (
                created_epoch,
                build_session_record(name=name, workspace=workspace),
            )
        )

    sessions.sort(key=lambda item: item[0], reverse=True)
    return [record for _created_epoch, record in sessions], "ok", ""


def active_session_records_query(runtime: Any) -> SessionQueryResult:
    sessions, state, detail = collect_repo_sessions(runtime)
    return SessionQueryResult(
        records={item["name"]: item for item in sessions},
        state=state,
        detail=detail,
    )


def archived_sessions(excluded_names: set[str] | list[str] | None = None) -> list[dict]:
    excluded_names_set = set(excluded_names or [])
    root = agent_window_session_root()
    if not root.is_dir():
        return []
    sessions: list[tuple[float, dict]] = []
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        session_name = entry.name
        if session_name in excluded_names_set:
            continue
        meta_path = entry / SESSION_META_FILENAME
        log_path = entry / SESSION_LOG_FILENAME
        meta = read_session_meta_file(meta_path)
        workspace = meta["workspace"]
        mtime = log_path.stat().st_mtime
        record = build_session_record(name=session_name, workspace=workspace)
        record["agents"] = meta["agents"]
        sessions.append((mtime, record))
    sessions.sort(key=lambda item: item[0], reverse=True)
    return [record for _mtime, record in sessions]


def archived_session_records(
    excluded_names: set[str] | list[str] | None = None,
) -> dict[str, dict]:
    return {item["name"]: item for item in archived_sessions(excluded_names)}
