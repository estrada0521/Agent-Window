from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import time
from collections import Counter
from pathlib import Path

from backend_core.access.files import append_jsonl_entry
from backend_core.access.chat_server import read_chat_server_state
from backend_core.access.session_meta import (
    SessionMetaError,
    find_session_for_workspace,
    session_workspace,
    write_session_meta_file,
)
from backend_core.access.settings import (
    agent_window_session_root,
    ensure_session_workspace_mirrors,
    session_log_path,
    workspace_chat_port,
)
from backend_core.agents.executables import agent_launch_cmd, resolve_agent_executable
from backend_core.agents.names import agent_base_name
from backend_core.agents.instances import (
    next_instance_name,
    resolve_canonical_instance,
)
from backend_core.agents.registry import AGENTS
from backend_core.tmux.process_cleanup import cleanup_target_process_groups
from backend_core.tmux.session import (
    TERMINAL_WINDOW_NAME,
    agent_topology,
    find_session_for_workspace as find_live_session_for_workspace,
    tmux_session_workspace,
)
from backend_core.tmux.topology import (
    acquire_topology_lock,
    default_tmux_socket_name,
    release_topology_lock,
    session_topology_lock_path,
)
from backend_core.tmux.window import (
    configure_window_size,
    create_agent_window,
    kill_window_target,
    tmux_prefix_args,
    window_target_for_pane,
)


SESSION_WIDTH = 66
SESSION_HEIGHT = 40


class SessionControlError(RuntimeError):
    pass


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _prefix(tmux_socket: str) -> list[str]:
    socket = (tmux_socket or "").strip() or default_tmux_socket_name()
    return tmux_prefix_args(socket)


def _run(prefix: list[str], args: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*prefix, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _live_tmux_session_for_workspace(prefix: list[str], workspace: str) -> str | None:
    return find_live_session_for_workspace(prefix, workspace)


def _resolve_tmux_name(prefix: list[str], session_name: str) -> str | None:
    try:
        workspace = session_workspace(session_name)
    except SessionMetaError as exc:
        raise SessionControlError(str(exc)) from exc
    if not workspace:
        return None
    return _live_tmux_session_for_workspace(prefix, workspace)


def _set_env(prefix: list[str], session_name: str, key: str, value: str) -> None:
    _run(prefix, ["set-environment", "-t", session_name, key, value])


def _unset_env(prefix: list[str], session_name: str, key: str) -> None:
    _run(prefix, ["set-environment", "-t", session_name, "-u", key])


def _instance_names(bases: list[str]) -> list[str]:
    counts = Counter(bases)
    indices: dict[str, int] = {}
    result: list[str] = []
    for base in bases:
        if counts[base] > 1:
            indices[base] = indices.get(base, 0) + 1
            result.append(f"{base}-{indices[base]}")
        else:
            result.append(base)
    return result


def _write_meta(prefix: list[str], tmux_name: str, aw_name: str) -> None:
    workspace = tmux_session_workspace(prefix, tmux_name)
    agents = [pane.name for pane in agent_topology(prefix, tmux_name)]
    write_session_meta_file(aw_name, workspace, agents)


def _append_log(session_name: str, message: str, *, kind: str, extra: dict | None = None) -> None:
    entry = {
        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
        "session": session_name,
        "sender": "system",
        "targets": [],
        "message": message,
        "kind": kind,
    }
    if extra:
        entry.update(extra)
    append_jsonl_entry(session_log_path(session_name), entry)


def append_session_lifecycle_entry(session_name: str, action: str) -> None:
    try:
        message = {
            "archived": "Session archived.",
            "revived": "Session revived.",
        }[action]
    except KeyError:
        raise SessionControlError(f"Unknown session lifecycle action: {action!r}") from None
    _append_log(
        session_name,
        message,
        kind="session-lifecycle",
        extra={"lifecycle_action": action},
    )


def _chat_listener_pids(chat_port: int) -> list[int]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-tiTCP:{int(chat_port)}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SessionControlError(f"lsof timed out for port {chat_port}") from exc
    except OSError as exc:
        raise SessionControlError(f"lsof failed for port {chat_port}: {exc}") from exc
    if result.returncode not in (0, 1):
        detail = (result.stderr or result.stdout or "").strip() or f"lsof exited {result.returncode}"
        raise SessionControlError(f"lsof failed for port {chat_port}: {detail}")
    return sorted({int(line.strip()) for line in (result.stdout or "").splitlines() if line.strip().isdigit()})


def _own_chat_listener_pids(chat_port: int, workspace: str) -> list[int]:
    listeners = _chat_listener_pids(chat_port)
    if not listeners:
        return []
    state = read_chat_server_state(chat_port)
    expected_workspace = str(Path(workspace).expanduser().resolve())
    reported_workspace = str((state or {}).get("workspace") or "").strip()
    if not reported_workspace or str(Path(reported_workspace).expanduser().resolve()) != expected_workspace:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(
            f"chat port {chat_port} is occupied by pid {shown}, not this workspace's chat server"
        )
    try:
        reported_pid = int(state.get("pid") or 0)
    except (TypeError, ValueError):
        reported_pid = 0
    if reported_pid <= 0 or listeners != [reported_pid]:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(f"chat server pid mismatch on port {chat_port}: {shown}")
    return listeners


def _chat_port_open(chat_port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", int(chat_port)), timeout=0.35):
            return True
    except OSError:
        return False


_CHAT_STOP_WAIT_SEC = 2.0


def _signal_chat_pids(pids: list[int], sig: int) -> str:
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except OSError as exc:
            return f"failed to signal chat server pid {pid}: {exc}"
    return ""


def stop_chat_server(workspace: str) -> tuple[bool, str]:
    raw_workspace = str(workspace or "").strip()
    if not raw_workspace:
        return False, "workspace is required"
    resolved_workspace = str(Path(raw_workspace).expanduser().resolve())
    chat_port = workspace_chat_port(resolved_workspace)
    try:
        pids = _own_chat_listener_pids(chat_port, resolved_workspace)
    except SessionControlError as exc:
        return False, str(exc)
    if not pids:
        return True, ""
    detail = _signal_chat_pids(pids, signal.SIGTERM)
    if detail:
        return False, detail
    deadline = time.monotonic() + _CHAT_STOP_WAIT_SEC
    while time.monotonic() < deadline:
        if not _chat_port_open(chat_port):
            return True, ""
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.1, remaining))
    detail = _signal_chat_pids(pids, signal.SIGKILL)
    if detail:
        return False, detail
    if _chat_port_open(chat_port):
        return False, f"chat server on port {chat_port} still running after SIGKILL"
    return True, ""


def _start_agent(
    *,
    prefix: list[str],
    workspace: str,
    pane_id: str,
    instance_name: str,
) -> None:
    command = agent_launch_cmd(instance_name)
    _run(prefix, ["select-pane", "-t", pane_id, "-T", instance_name])
    shell = os.environ.get("SHELL") or "/bin/zsh"
    result = _run(
        prefix,
        ["respawn-pane", "-k", "-t", pane_id, "-c", workspace, shell, "-lc", command],
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"failed to start {instance_name}"
        raise SessionControlError(detail)


def _prepare_instances(requested: list[str]) -> list[str]:
    bases: list[str] = []
    for raw in requested:
        base = agent_base_name(raw)
        if not base or base not in AGENTS:
            raise SessionControlError(f"Unknown agent: {raw}")
        bases.append(base)
    if not bases:
        return []
    kept: list[str] = []
    for base in bases:
        if not resolve_agent_executable(base):
            raise SessionControlError(f"Required command not found for {base}")
        kept.append(base)
    return _instance_names(kept)


def _create_tmux_session(prefix: list[str], workspace: Path) -> str:
    created = _run(
        prefix,
        [
            "new-session",
            "-d",
            "-P",
            "-F",
            "#{session_name}",
            "-x",
            str(SESSION_WIDTH),
            "-y",
            str(SESSION_HEIGHT),
            "-c",
            str(workspace),
        ],
    )
    if created.returncode != 0:
        detail = (created.stderr or created.stdout or "").strip() or "tmux new-session failed"
        raise SessionControlError(detail)
    return (created.stdout or "").strip()


def _pane_status(prefix: list[str], pane_id: str) -> dict:
    title = _run(prefix, ["display-message", "-p", "-t", pane_id, "#{pane_title}"]).stdout.strip()
    command = _run(prefix, ["display-message", "-p", "-t", pane_id, "#{pane_current_command}"]).stdout.strip()
    dead = _run(prefix, ["display-message", "-p", "-t", pane_id, "#{pane_dead}"]).stdout.strip() == "1"
    return {"pane_id": pane_id, "title": title, "command": command, "dead": dead}


def describe_session(session_name: str, *, tmux_socket: str = "") -> dict:
    """Folder-first status for one AW session.

    The log folder (its .meta) is the only identity; tmux is asked only
    whether a live session is currently bound to the workspace it records,
    never by matching on the AW name (tmux doesn't know it).
    """
    name = (session_name or "").strip()
    if not name:
        raise SessionControlError("session_name is required")
    meta_path = agent_window_session_root() / name / ".meta"
    if not meta_path.is_file():
        raise SessionControlError(f"Session does not exist: {name}")
    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SessionControlError(f"invalid session meta: {meta_path}") from exc
    if not isinstance(meta, dict):
        raise SessionControlError(f"invalid session meta: {meta_path}")

    workspace = str(meta.get("workspace") or "").strip()
    meta_agents = meta.get("agents")
    info: dict = {
        "session": name,
        "workspace": workspace or None,
        "agents": [str(a).strip() for a in meta_agents if str(a).strip()] if isinstance(meta_agents, list) else [],
        "active": False,
    }
    if not workspace:
        return info

    prefix = _prefix(tmux_socket)
    tmux_name = _live_tmux_session_for_workspace(prefix, workspace)
    if not tmux_name:
        return info

    attached = _run(prefix, ["display-message", "-p", "-t", tmux_name, "#{session_attached}"]).stdout.strip()
    created_epoch = _run(prefix, ["display-message", "-p", "-t", tmux_name, "#{session_created}"]).stdout.strip()
    window_count = len(_run(prefix, ["list-windows", "-t", tmux_name, "-F", "#{window_id}"]).stdout.splitlines())
    dead_panes = sum(
        1
        for line in _run(prefix, ["list-panes", "-s", "-t", tmux_name, "-F", "#{pane_dead}"]).stdout.splitlines()
        if line.strip() == "1"
    )
    topology = agent_topology(prefix, tmux_name)
    agents = [pane.name for pane in topology]
    current_pane = os.environ.get("TMUX_PANE") or ""
    this_pane_role = None
    panes: dict[str, dict | None] = {}
    for pane in topology:
        panes[pane.name] = _pane_status(prefix, pane.pane_id)
        if current_pane and pane.pane_id == current_pane:
            this_pane_role = pane.name

    info.update(
        {
            "active": True,
            "tmux_name": tmux_name,
            "attached": int(attached) if attached.isdigit() else 0,
            "created_epoch": int(created_epoch) if created_epoch.isdigit() else 0,
            "window_count": window_count,
            "dead_panes": dead_panes,
            "agents": agents,
            "panes": panes,
            "this_pane_role": this_pane_role,
        }
    )
    return info


def create_session(
    *,
    session_name: str,
    workspace: str,
    agents: list[str] | None = None,
    tmux_socket: str = "",
    repo_root: Path | str | None = None,
    fresh: bool = False,
    lifecycle_action: str | None = None,
) -> None:
    name = (session_name or "").strip()
    workspace_path = Path(workspace).expanduser().resolve()
    if not name:
        raise SessionControlError("session_name is required")
    if not workspace_path.is_dir():
        raise SessionControlError(f"Invalid workspace: {workspace_path}")
    try:
        existing = find_session_for_workspace(workspace_path, exclude_session=name)
    except SessionMetaError as exc:
        raise SessionControlError(str(exc)) from exc
    if existing:
        raise SessionControlError(f"A session already exists for this workspace: {existing}")
    root = Path(repo_root).resolve() if repo_root is not None else _repo_root()
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    instances = _prepare_instances(
        [str(item).strip() for item in (agents or []) if str(item).strip()],
    )

    if fresh:
        log_dir = agent_window_session_root() / name
        if log_dir.is_dir():
            shutil.rmtree(log_dir)
        workspace_runtime = workspace_path / ".agent-window"
        if workspace_runtime.is_dir():
            shutil.rmtree(workspace_runtime)

    log_path = session_log_path(name)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    if not log_path.exists():
        log_path.touch()
    ensure_session_workspace_mirrors(name, str(workspace_path))

    tmux_name = _create_tmux_session(prefix, workspace_path)

    configure_window_size(target=f"{tmux_name}:0", width=SESSION_WIDTH, tmux_socket=socket_name)
    _run(prefix, ["rename-window", "-t", f"{tmux_name}:0", TERMINAL_WINDOW_NAME])
    for args in (
        ["set-option", "-t", tmux_name, "-g", "remain-on-exit", "on"],
        ["set-option", "-t", tmux_name, "-g", "mouse", "on"],
        ["set-option", "-t", tmux_name, "-g", "pane-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "pane-active-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "status-style", "bg=#38393D,fg=#ACB4BE"],
        ["set-option", "-t", tmux_name, "-g", "history-limit", "50000"],
    ):
        _run(prefix, args)
    _run(prefix, ["set-option", "-t", tmux_name, "-g", "@scroll-speed-num-lines-per-scroll", "1"])

    panes: list[str] = []
    for instance in instances:
        pane_id = create_agent_window(
            session=tmux_name,
            instance_name=instance,
            workspace=str(workspace_path),
            width=SESSION_WIDTH,
            tmux_socket=socket_name,
        )
        if not pane_id:
            raise SessionControlError(f"Failed to create agent window for {instance}")
        panes.append(pane_id)

    bin_dir = str(root / "bin")
    path_value = f"{bin_dir}:{os.environ.get('PATH', '')}"
    _set_env(prefix, tmux_name, "PATH", path_value)
    _unset_env(prefix, tmux_name, "CLAUDECODE")
    _write_meta(prefix, tmux_name, name)

    if panes:
        for instance, pane_id in zip(instances, panes):
            _start_agent(
                prefix=prefix,
                workspace=str(workspace_path),
                pane_id=pane_id,
                instance_name=instance,
            )
        _run(prefix, ["select-pane", "-t", panes[0]])

    if lifecycle_action:
        append_session_lifecycle_entry(name, lifecycle_action)


def kill_session(
    *,
    session_name: str,
    tmux_socket: str = "",
) -> None:
    name = (session_name or "").strip()
    if not name:
        raise SessionControlError("session_name is required")
    prefix = _prefix(tmux_socket)
    tmux_name = _resolve_tmux_name(prefix, name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {name}")
    workspace = tmux_session_workspace(prefix, tmux_name)
    stop_ok, stop_detail = stop_chat_server(workspace)
    if not stop_ok:
        raise SessionControlError(f"failed to stop chat server for {name}: {stop_detail}")
    cleanup_target_process_groups(target=tmux_name, tmux_prefix=prefix)
    result = _run(prefix, ["kill-session", "-t", tmux_name], timeout=4)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or "tmux kill-session failed"
        raise SessionControlError(detail)
    append_session_lifecycle_entry(name, "archived")


def _with_topology_lock(tmux_socket: str, session_name: str):
    lock_dir = session_topology_lock_path(tmux_socket, session_name)
    if not acquire_topology_lock(lock_dir, os.getpid()):
        raise SessionControlError(f"Timed out waiting for topology lock: {session_name}")
    return lock_dir


def add_agent(
    *,
    session_name: str,
    agent: str,
    tmux_socket: str = "",
) -> str:
    name = (session_name or "").strip()
    base = agent_base_name(agent)
    if not name:
        raise SessionControlError("session_name is required")
    if not base or base not in AGENTS:
        raise SessionControlError(f"Unknown agent: {agent}")
    if not resolve_agent_executable(base):
        raise SessionControlError(f"Required command not found for {base}")
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    tmux_name = _resolve_tmux_name(prefix, name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {name}")
    workspace = tmux_session_workspace(prefix, tmux_name)
    ensure_session_workspace_mirrors(name, workspace)

    lock_dir = _with_topology_lock(socket_name, name)
    try:
        topology = agent_topology(prefix, tmux_name)
        current = [pane.name for pane in topology]
        instance = next_instance_name(current, base)
        if any(pane.name == instance for pane in topology):
            raise SessionControlError(f"Agent instance already exists: {instance}")
        pane_id = create_agent_window(
            session=tmux_name,
            instance_name=instance,
            workspace=workspace,
            width=SESSION_WIDTH,
            tmux_socket=socket_name,
        )
        if not pane_id:
            raise SessionControlError("Failed to create agent window")
        _write_meta(prefix, tmux_name, name)
        _start_agent(
            prefix=prefix,
            workspace=workspace,
            pane_id=pane_id,
            instance_name=instance,
        )
        _append_log(
            name,
            f"Add Agent: {instance}",
            kind="session-topology",
            extra={"topology_action": "add-agent", "agent_instance": instance},
        )
        return instance
    finally:
        release_topology_lock(lock_dir)


def remove_agent(
    *,
    session_name: str,
    agent: str,
    tmux_socket: str = "",
) -> str:
    name = (session_name or "").strip()
    requested = (agent or "").strip()
    if not name:
        raise SessionControlError("session_name is required")
    if not requested:
        raise SessionControlError("agent is required")
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    tmux_name = _resolve_tmux_name(prefix, name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {name}")
    workspace = tmux_session_workspace(prefix, tmux_name)
    ensure_session_workspace_mirrors(name, workspace)

    lock_dir = _with_topology_lock(socket_name, name)
    try:
        topology = agent_topology(prefix, tmux_name)
        current = [pane.name for pane in topology]
        canonical = resolve_canonical_instance(current, requested)
        if not canonical:
            raise SessionControlError(f"Agent instance not in this session: {agent}")
        # Zero agents is a valid state -- the "terminal" window (0) keeps the
        # tmux session alive and add_agent can bring one back. Agent Window
        # doesn't own a "sessions must have an agent" rule.
        pane_id = next((pane.pane_id for pane in topology if pane.name == canonical), "")
        if not pane_id:
            raise SessionControlError(f"No tmux pane found for instance: {canonical}")
        window_target = window_target_for_pane(pane_id=pane_id, tmux_socket=socket_name)
        if not window_target:
            raise SessionControlError(f"No tmux window recorded for instance: {canonical}")
        if not kill_window_target(window_target=window_target, tmux_socket=socket_name):
            raise SessionControlError(f"tmux kill-window failed for {window_target}")
        _write_meta(prefix, tmux_name, name)
        _append_log(
            name,
            f"Remove Agent: {canonical}",
            kind="session-topology",
            extra={"topology_action": "remove-agent", "agent_instance": canonical},
        )
        return canonical
    finally:
        release_topology_lock(lock_dir)
