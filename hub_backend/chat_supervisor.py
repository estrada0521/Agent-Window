from __future__ import annotations

import http.client
import json
import logging
import os
import shutil
import signal
import ssl
import subprocess
import sys
import time
import uuid
from pathlib import Path

from backend_core.tmux.process_cleanup import cleanup_target_process_groups
from backend_core.access.files import append_jsonl_entry
from backend_core.access.settings import (
    agent_window_run_dir,
    ensure_session_workspace_mirrors,
    local_runtime_log_dir,
    port_is_bindable,
    save_chat_port_override,
    session_log_path,
)


def _append_session_lifecycle_entry(session_name: str, action: str) -> None:
    normalized_action = str(action or "").strip().lower()
    message = {
        "archived": "Session archived.",
        "revived": "Session revived.",
    }.get(normalized_action)
    if not message:
        return
    try:
        append_jsonl_entry(
            session_log_path(session_name),
            {
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                "session": session_name,
                "sender": "system",
                "targets": [],
                "message": message,
                "msg_id": uuid.uuid4().hex[:12],
                "kind": "session-lifecycle",
                "lifecycle_action": normalized_action,
            },
        )
    except Exception as exc:
        logging.warning("failed to append %s lifecycle entry for %s: %s", normalized_action, session_name, exc)


def chat_ready(self, chat_port: int) -> bool:
    import socket as _sock

    try:
        with _sock.create_connection(("127.0.0.1", chat_port), timeout=0.35):
            return True
    except OSError:
        return False


def chat_server_state(self, chat_port: int, *, scheme: str = "") -> dict | None:
    schemes = (scheme,) if scheme in {"http", "https"} else ("https", "http")
    for scheme_name in schemes:
        try:
            if scheme_name == "https":
                conn = http.client.HTTPSConnection(
                    "127.0.0.1",
                    chat_port,
                    timeout=0.6,
                    context=ssl._create_unverified_context(),
                )
            else:
                conn = http.client.HTTPConnection("127.0.0.1", chat_port, timeout=0.6)
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
        except (OSError, http.client.HTTPException, json.JSONDecodeError):
            continue
    return None


def chat_server_matches(self, session_name: str, chat_port: int, *, scheme: str = "") -> bool:
    state = self.chat_server_state(chat_port, scheme=scheme)
    if not state:
        return scheme not in {"http", "https"}
    if (state.get("session") or "") != session_name:
        return False
    reported_repo_root = str(state.get("repo_root") or "").strip()
    if reported_repo_root != str(self.repo_root):
        return False
    expected_agents = self.session_agents(session_name)
    reported_agents = [str(a).strip() for a in (state.get("targets") or []) if str(a).strip()]
    if expected_agents and reported_agents and set(expected_agents) != set(reported_agents):
        return False
    if expected_agents and not reported_agents:
        return False
    return True


def stop_chat_server(
    self,
    session_name: str,
    *,
    subprocess_module=subprocess,
    os_module=os,
    signal_module=signal,
    time_module=time,
) -> tuple[bool, str]:
    chat_port = self.chat_port_for_session(session_name)
    try:
        result = subprocess_module.run(
            ["lsof", "-nP", f"-tiTCP:{chat_port}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
        pids = [int(line.strip()) for line in result.stdout.splitlines() if line.strip().isdigit()]
    except (OSError, subprocess_module.TimeoutExpired) as exc:
        return False, f"lsof failed: {exc}"
    if not pids:
        return True, ""
    for pid in pids:
        try:
            os_module.kill(pid, signal_module.SIGTERM)
        except ProcessLookupError:
            pass
        except OSError as exc:
            logging.warning("SIGTERM pid %d failed: %s", pid, exc)
    for _ in range(15):
        if not self.chat_ready(chat_port):
            return True, ""
        time_module.sleep(0.1)
    for pid in pids:
        try:
            os_module.kill(pid, signal_module.SIGKILL)
        except ProcessLookupError:
            pass
        except OSError as exc:
            logging.warning("SIGKILL pid %d failed: %s", pid, exc)
    if self.chat_ready(chat_port):
        return False, f"chat server on port {chat_port} still running after SIGKILL"
    return True, ""


def chat_launch_workspace(self, session_name: str) -> tuple[str, bool]:
    workspace, timed_out = self.tmux_env_query(session_name, "AGENT_WINDOW_WORKSPACE")
    if timed_out:
        return "", True
    workspace = (workspace or "").strip()
    if workspace:
        return workspace, False
    query = self.active_session_records_query()
    if query.state == "ok":
        workspace = str((query.records.get(session_name) or {}).get("workspace") or "").strip()
    return workspace or str(self.repo_root), False


def chat_launch_session_dir(self, session_name: str, workspace: str, explicit_log_dir: str) -> Path:
    session_dir = local_runtime_log_dir(self.repo_root) / session_name
    session_dir.mkdir(parents=True, exist_ok=True)
    canonical_index = session_log_path(session_name)
    if not canonical_index.exists():
        canonical_index.touch()
    ensure_session_workspace_mirrors(session_name, workspace)
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
    if str(getattr(self, "hub_scheme", "") or "").strip().lower() == "http":
        env.pop("AGENT_WINDOW_CERT_FILE", None)
        env.pop("AGENT_WINDOW_KEY_FILE", None)
        env.pop("AGENT_WINDOW_ENABLE_LOCAL_HTTPS", None)
    return env


def _chat_launch_port(self, session_name: str) -> tuple[int, bool, str]:
    """Find the chat port to use for session_name: an already-matching
    server, or the next bindable one (saving that as an override).

    Returns (chat_port, ready, error). ready=True means a chat server for
    this session already answers at chat_port -- the caller doesn't need to
    launch one. error is set only when stopping a stale server failed.
    """
    chat_port = self.chat_port_for_session(session_name)
    scheme = getattr(self, "hub_scheme", "")
    if self.chat_ready(chat_port):
        if self.chat_server_matches(session_name, chat_port, scheme=scheme):
            return chat_port, True, ""
        stop_ok, stop_detail = self.stop_chat_server(session_name)
        if not stop_ok:
            return chat_port, False, stop_detail

    if not port_is_bindable(chat_port):
        if self.chat_ready(chat_port) and self.chat_server_matches(session_name, chat_port, scheme=scheme):
            return chat_port, True, ""
        for candidate in range(chat_port, chat_port + 10):
            if self.chat_ready(candidate) and self.chat_server_matches(session_name, candidate, scheme=scheme):
                save_chat_port_override(self.repo_root, session_name, candidate)
                return candidate, True, ""
            if port_is_bindable(candidate):
                save_chat_port_override(self.repo_root, session_name, candidate)
                return candidate, False, ""

    return chat_port, False, ""


def stop_inactive_chat_servers(self, *, keep_session: str = "") -> None:
    query = self.active_session_records_query()
    archived = self.archived_session_records(query.records.keys())
    keep = str(keep_session or "").strip()
    scheme = getattr(self, "hub_scheme", "")
    for name in archived:
        if name == keep:
            continue
        port = self.chat_port_for_session(name)
        if not self.chat_ready(port):
            continue
        state = self.chat_server_state(port, scheme=scheme)
        if not state or state.get("active"):
            continue
        self.stop_chat_server(name)


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
        chat_port, ready, error = self._chat_launch_port(session_name)
        if error:
            logging.warning("stop_chat_server failed before relaunch: %s", error)
        if ready:
            state = self.chat_server_state(chat_port, scheme=getattr(self, "hub_scheme", ""))
            if state and bool(state.get("active")) == bool(session_is_active):
                return True, chat_port, ""
            stop_ok, stop_detail = self.stop_chat_server(session_name)
            if not stop_ok:
                return False, chat_port, stop_detail

        if not session_is_active:
            self.stop_inactive_chat_servers(keep_session=session_name)

        resolved_workspace = str(workspace or "").strip()
        if not resolved_workspace:
            if session_is_active:
                resolved_workspace, workspace_timed_out = self._chat_launch_workspace(session_name)
                if workspace_timed_out:
                    return False, chat_port, "tmux query timed out while preparing chat server launch"
            else:
                archived = self.archived_session_records(self.active_session_records_query().records.keys())
                resolved_workspace = str((archived.get(session_name) or {}).get("workspace") or "").strip()
        if not resolved_workspace:
            return False, chat_port, "workspace unavailable"
        self._chat_launch_session_dir(session_name, resolved_workspace, "")
        if session_is_active:
            log_path = session_log_path(session_name)
            try:
                self.tmux_run(["set-environment", "-t", session_name, "AGENT_WINDOW_INDEX_PATH", str(log_path)], timeout=2)
            except Exception:
                pass
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
                cwd=resolved_workspace or str(self.repo_root),
                env=env,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except Exception as exc:
            logging.error(f"Unexpected error: {exc}", exc_info=True)
            return False, chat_port, str(exc)
        for _ in range(60):
            if self.chat_ready(chat_port) and self.chat_server_state(chat_port, scheme=getattr(self, "hub_scheme", "")):
                return True, chat_port, ""
            time_module.sleep(0.1)
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
    env = os.environ.copy()
    if self.tmux_socket:
        env["AGENT_WINDOW_TMUX_SOCKET"] = self.tmux_socket
    stop_ok, stop_detail = self.stop_chat_server(session_name)
    if not stop_ok:
        logging.warning("stop_chat_server failed during revive: %s", stop_detail)
    cmd = [
        str(self.agent_window_path),
        "--session",
        session_name,
        "--workspace",
        workspace,
        "--detach",
    ]
    agents = record.get("agents") or []
    if agents:
        cmd.extend(["--agents", ",".join(agents)])
    try:
        subprocess.Popen(
            cmd,
            cwd=workspace,
            env=env,
            start_new_session=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return False, str(exc)
    for _ in range(80):
        query = self.active_session_records_query()
        if session_name in query.records:
            _append_session_lifecycle_entry(session_name, "revived")
            return True, ""
        if query.state == "unhealthy":
            return False, f"tmux became unresponsive during session startup ({query.detail})"
        time.sleep(0.15)
    return False, f"Session {session_name} did not come up in time."


def kill_repo_session(self, session_name: str) -> tuple[bool, str]:
    query = self.active_session_records_query()
    if query.state == "unhealthy":
        return False, f"tmux is unresponsive, cannot confirm session state ({query.detail})"

    active = query.records
    if session_name not in active:
        return False, "That active session is not available in this repo."

    cleanup_target_process_groups(target=session_name, tmux_prefix=self.tmux_prefix)
    result = self.tmux_run(["kill-session", "-t", session_name], timeout=4)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or "tmux kill-session failed"
        return False, detail

    for _ in range(20):
        query = self.active_session_records_query()
        if session_name not in query.records:
            stop_ok, stop_detail = self.stop_chat_server(session_name)
            _append_session_lifecycle_entry(session_name, "archived")
            if not stop_ok:
                return True, f"session killed but chat server cleanup failed: {stop_detail}"
            return True, ""
        if query.state == "unhealthy":
            return False, f"tmux became unresponsive while killing session ({query.detail})"
        time.sleep(0.1)
    return False, f"Session {session_name} did not go away in time."


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
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return False, "Archived log directory could not be resolved."
    if not any(root == resolved or root in resolved.parents for root in allowed_roots):
        return False, "Refusing to delete a path outside agent-window log roots."
    try:
        shutil.rmtree(resolved)
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return False, str(exc)
    return True, ""
