from __future__ import annotations

import http.client
import json
import os
import shutil
import ssl
import subprocess
import sys
import time
from pathlib import Path

from backend_core.tmux.control import (
    SessionControlError,
    create_session,
    kill_session,
    rename_session,
    stop_chat_server as stop_chat_server_impl,
)
from backend_core.access.settings import (
    agent_window_run_dir,
    agent_window_session_root,
    default_chat_port,
    port_is_bindable,
    pwa_https_enabled,
    session_log_path,
)

SERVER_READY_TIMEOUT_SEC = 6.0
HTTPS_PROBE_TIMEOUT_SEC = 1.0


def _wait_until(predicate, timeout_sec: float, *, time_module=time, interval: float = 0.1) -> bool:
    deadline = time_module.monotonic() + timeout_sec
    while True:
        if predicate():
            return True
        remaining = deadline - time_module.monotonic()
        if remaining <= 0:
            return False
        time_module.sleep(min(interval, remaining))


def chat_ready(self, chat_port: int) -> bool:
    import socket as _sock

    try:
        with _sock.create_connection(("127.0.0.1", chat_port), timeout=HTTPS_PROBE_TIMEOUT_SEC):
            return True
    except OSError:
        return False


def chat_server_state(self, chat_port: int) -> dict | None:
    scheme = str(getattr(self, "hub_scheme", "") or "").strip().lower()
    if scheme not in {"http", "https"}:
        return None
    try:
        if scheme == "https":
            conn = http.client.HTTPSConnection(
                "127.0.0.1",
                chat_port,
                timeout=HTTPS_PROBE_TIMEOUT_SEC,
                context=ssl._create_unverified_context(),
            )
        else:
            conn = http.client.HTTPConnection(
                "127.0.0.1",
                chat_port,
                timeout=HTTPS_PROBE_TIMEOUT_SEC,
            )
        conn.request(
            "GET",
            f"/session-state?ts={int(time.time() * 1000)}",
            headers={"Host": f"127.0.0.1:{chat_port}"},
        )
        resp = conn.getresponse()
        body = resp.read()
        conn.close()
        if 200 <= resp.status < 300:
            data = json.loads(body.decode("utf-8", errors="replace"))
            if isinstance(data, dict):
                return data
    except (OSError, http.client.HTTPException, json.JSONDecodeError, TimeoutError):
        return None
    return None


def chat_server_matches(self, session_name: str, chat_port: int, *, workspace: str = "") -> bool:
    state = self.chat_server_state(chat_port)
    if not state:
        return False
    if (state.get("session") or "") != session_name:
        return False
    reported_repo_root = str(state.get("repo_root") or "").strip()
    if reported_repo_root != str(self.repo_root):
        return False
    expected_workspace = str(workspace or "").strip()
    if str(state.get("workspace") or "").strip() != expected_workspace:
        return False
    expected_agents = self.session_agents(session_name)
    reported_agents = [str(a).strip() for a in (state.get("targets") or []) if str(a).strip()]
    if expected_agents and reported_agents and set(expected_agents) != set(reported_agents):
        return False
    if expected_agents and not reported_agents:
        return False
    return True


def stop_chat_server(self, session_name: str) -> tuple[bool, str]:
    return stop_chat_server_impl(session_name)


def chat_launch_session_dir(self, session_name: str) -> Path:
    session_dir = agent_window_session_root() / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    canonical_index = session_log_path(session_name)
    if not canonical_index.exists():
        canonical_index.touch()
    return session_dir


def chat_launch_env(self, *, session_is_active: bool = True) -> dict[str, str]:
    env = os.environ.copy()
    env["AGENT_WINDOW_AGENT_NAME"] = "user"
    if self.tmux_socket:
        env["AGENT_WINDOW_TMUX_SOCKET"] = self.tmux_socket
    env["AGENT_INDEX_HUB_PORT"] = str(self.hub_port)
    env["AGENT_WINDOW_RUN_DIR"] = str(agent_window_run_dir())
    env["SESSION_IS_ACTIVE"] = "1" if session_is_active else "0"
    pythonpath_parts = [str(self.repo_root)]
    existing_pythonpath = (env.get("PYTHONPATH") or "").strip()
    if existing_pythonpath:
        pythonpath_parts.append(existing_pythonpath)
    env["PYTHONPATH"] = os.pathsep.join(pythonpath_parts)
    if pwa_https_enabled():
        return env
    env.pop("AGENT_WINDOW_CERT_FILE", None)
    env.pop("AGENT_WINDOW_KEY_FILE", None)
    env.pop("AGENT_WINDOW_ENABLE_LOCAL_HTTPS", None)
    return env


def _chat_launch_port(
    self,
    session_name: str,
    *,
    workspace: str = "",
    session_is_active: bool = True,
) -> tuple[int, bool, str]:
    """Return the session's designated chat port, or fail if it cannot be used.

    Returns (chat_port, ready, error). ready=True means this session already
    answers at chat_port on the Hub scheme with the expected workspace.
    Occupied-by-something-else is an error; this does not stop or replace a
    foreign listener. A listener for this session with the wrong workspace or
    active flag is not ready; the caller stops it and relaunches.
    """
    chat_port = self.chat_port_for_session(session_name)
    state = self.chat_server_state(chat_port)
    if (
        self.chat_server_matches(session_name, chat_port, workspace=workspace)
        and state is not None
        and bool(state.get("active")) == bool(session_is_active)
    ):
        return chat_port, True, ""
    if self.chat_ready(chat_port) or not port_is_bindable(chat_port):
        if state and str(state.get("session") or "").strip() == session_name:
            return chat_port, False, ""
        return chat_port, False, f"chat port {chat_port} is occupied"
    return chat_port, False, ""


def stop_inactive_chat_servers(self, *, keep_session: str = "") -> str:
    query = self.active_session_records_query()
    archived = self.archived_session_records(query.records.keys())
    keep = str(keep_session or "").strip()
    for name in archived:
        if name == keep:
            continue
        port = self.chat_port_for_session(name)
        if not self.chat_ready(port):
            continue
        state = self.chat_server_state(port)
        if not state or state.get("active"):
            continue
        stop_ok, stop_detail = self.stop_chat_server(name)
        if not stop_ok:
            return stop_detail
    return ""


def ensure_chat_server(
    self,
    session_name: str,
    *,
    session_is_active: bool = True,
    workspace: str = "",
    subprocess_module=subprocess,
    sys_module=sys,
    time_module=time,
) -> tuple[bool, int, str]:
    lock = self._get_launch_lock(session_name)
    with lock:
        resolved_workspace = str(workspace or "").strip()

        chat_port, ready, error = self._chat_launch_port(
            session_name,
            workspace=resolved_workspace,
            session_is_active=session_is_active,
        )
        if error:
            return False, chat_port, error
        if ready:
            return True, chat_port, ""
        if self.chat_ready(chat_port):
            stop_ok, stop_detail = self.stop_chat_server(session_name)
            if not stop_ok:
                return False, chat_port, stop_detail

        if not session_is_active:
            stop_detail = self.stop_inactive_chat_servers(keep_session=session_name)
            if stop_detail:
                return False, chat_port, stop_detail

        session_dir = self._chat_launch_session_dir(session_name)
        env = self._chat_launch_env(session_is_active=session_is_active)
        try:
            subprocess_module.Popen(
                [
                    sys_module.executable,
                    "-m",
                    "server.server",
                    session_name,
                    resolved_workspace,
                ],
                cwd=str(self.repo_root),
                env=env,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError as exc:
            return False, chat_port, str(exc)

        def _ready() -> bool:
            state = self.chat_server_state(chat_port)
            return (
                bool(state)
                and str(state.get("session") or "").strip() == session_name
                and str(state.get("workspace") or "").strip() == resolved_workspace
                and bool(state.get("active")) == bool(session_is_active)
            )

        if _wait_until(_ready, SERVER_READY_TIMEOUT_SEC, time_module=time_module):
            return True, chat_port, ""
        return False, chat_port, "chat server did not become ready"


def revive_archived_session(self, session_name: str) -> tuple[bool, str]:
    query = self.active_session_records_query()
    if query.state == "unhealthy":
        return False, f"tmux is currently unresponsive ({query.detail})"
    active_records = query.records
    if session_name in active_records:
        return True, ""
    archived = self.archived_session_records(active_records.keys())
    record = archived.get(session_name)
    if not record:
        return False, "That archived session is not available in this repo."
    workspace = (record.get("workspace") or "").strip()
    if not workspace or not Path(workspace).is_dir():
        return False, f"Saved workspace is unavailable: {workspace or 'unknown'}"
    stop_ok, stop_detail = self.stop_chat_server(session_name)
    if not stop_ok:
        return False, stop_detail
    # Checked before create_session: session_name alone determines the chat
    # port, so a collision is knowable up front. Finding out only after the
    # tmux session is revived would leave it running with no way to reach
    # it, and revive_archived_session doesn't roll a revive back on failure.
    chat_port = default_chat_port(session_name)
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


def rename_repo_session(self, old_name: str, new_name: str) -> tuple[bool, str]:
    query = self.active_session_records_query()
    if query.state == "unhealthy":
        return False, f"tmux is unresponsive, cannot safely rename ({query.detail})"

    active = query.records
    archived = self.archived_session_records(active.keys())
    if old_name not in active and old_name not in archived:
        return False, "That session is not available in this repo."
    try:
        rename_session(old_name=old_name, new_name=new_name)
    except SessionControlError as exc:
        return False, str(exc)
    return True, ""


def kill_repo_session(self, session_name: str) -> tuple[bool, str]:
    query = self.active_session_records_query()
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
    query = self.active_session_records_query()
    if query.state == "unhealthy":
        return False, f"tmux is unresponsive, cannot safely delete archived session ({query.detail})"

    active = query.records
    archived = self.archived_session_records(active.keys())
    record = archived.get(session_name)
    if not record:
        return False, "That archived session is not available in this repo."
    stop_ok, stop_detail = self.stop_chat_server(session_name)
    if not stop_ok:
        return False, stop_detail
    log_dir = Path((record.get("log_dir") or "").strip())
    if not log_dir.exists():
        return True, ""
    allowed_roots = [
        self.central_log_dir.resolve(),
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
