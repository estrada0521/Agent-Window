from __future__ import annotations

import os
import signal
import socket
import subprocess
import time
from collections import Counter
from pathlib import Path

from fs.log.jsonl import append_jsonl_entry
from server.room.probe import read_room_server_state
from fs.log.meta import (
    SessionMetaError,
    create_session_folder,
    read_session_meta,
    session_workspace,
    write_session_meta_file,
)
from fs.log.paths import (
    ensure_workspace_log_link,
    log_jsonl_path,
    workspace_room_port,
)
from agents.executables import agent_launch_cmd, resolve_agent_executable
from agents import agent_base_name
from agents import next_instance_name
from agents.registry import AGENTS
from tmux.process_cleanup import cleanup_target_process_groups
from tmux.session import (
    TERMINAL_WINDOW_NAME,
    agent_topology,
    find_session_for_workspace as find_live_session_for_workspace,
    tmux_session_workspace,
)
from tmux import TMUX
from tmux.window import (
    configure_window_size,
    create_agent_window,
    kill_window_target,
    window_target_for_pane,
)


SESSION_WIDTH = 66
SESSION_HEIGHT = 40


class SessionControlError(RuntimeError):
    pass


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _run(args: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*TMUX, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _resolve_tmux_name(session_name: str) -> str | None:
    try:
        workspace = session_workspace(session_name)
    except SessionMetaError as exc:
        raise SessionControlError(str(exc)) from exc
    return find_live_session_for_workspace(workspace)


def _set_env(session_name: str, key: str, value: str) -> None:
    _run(["set-environment", "-t", session_name, key, value])


def _unset_env(session_name: str, key: str) -> None:
    _run(["set-environment", "-t", session_name, "-u", key])


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


def _write_meta(tmux_name: str, aw_name: str) -> None:
    workspace = tmux_session_workspace(tmux_name)
    agents = [pane.name for pane in agent_topology(tmux_name)]
    write_session_meta_file(aw_name, workspace, agents)


def _append_log(session_name: str, message: str) -> None:
    append_jsonl_entry(
        log_jsonl_path(session_name),
        {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sender": "system",
            "targets": [],
            "message": message,
        },
    )


def _room_listener_pids(room_port: int) -> list[int]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-tiTCP:{int(room_port)}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SessionControlError(f"lsof timed out for port {room_port}") from exc
    except OSError as exc:
        raise SessionControlError(f"lsof failed for port {room_port}: {exc}") from exc
    if result.returncode not in (0, 1):
        detail = (result.stderr or result.stdout or "").strip() or f"lsof exited {result.returncode}"
        raise SessionControlError(f"lsof failed for port {room_port}: {detail}")
    return sorted({int(line.strip()) for line in (result.stdout or "").splitlines() if line.strip().isdigit()})


def _own_room_listener_pids(room_port: int, workspace: str) -> list[int]:
    listeners = _room_listener_pids(room_port)
    if not listeners:
        return []
    state = read_room_server_state(room_port)
    expected_workspace = str(Path(workspace).expanduser().resolve())
    reported_workspace = str((state or {}).get("workspace") or "").strip()
    if not reported_workspace or str(Path(reported_workspace).expanduser().resolve()) != expected_workspace:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(
            f"room port {room_port} is occupied by pid {shown}, not this workspace's room server"
        )
    try:
        reported_pid = int(state.get("pid") or 0)
    except (TypeError, ValueError):
        reported_pid = 0
    if reported_pid <= 0 or listeners != [reported_pid]:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(f"room server pid mismatch on port {room_port}: {shown}")
    return listeners


def _room_port_open(room_port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", int(room_port)), timeout=0.35):
            return True
    except OSError:
        return False


_ROOM_STOP_WAIT_SEC = 2.0


def _signal_room_pids(pids: list[int], sig: int) -> str:
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except OSError as exc:
            return f"failed to signal room server pid {pid}: {exc}"
    return ""


def stop_room_server(workspace: str) -> tuple[bool, str]:
    resolved_workspace = str(Path(workspace).expanduser().resolve())
    room_port = workspace_room_port(resolved_workspace)
    try:
        pids = _own_room_listener_pids(room_port, resolved_workspace)
    except SessionControlError as exc:
        return False, str(exc)
    if not pids:
        return True, ""
    detail = _signal_room_pids(pids, signal.SIGTERM)
    if detail:
        return False, detail
    deadline = time.monotonic() + _ROOM_STOP_WAIT_SEC
    while time.monotonic() < deadline:
        if not _room_port_open(room_port):
            return True, ""
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.1, remaining))
    detail = _signal_room_pids(pids, signal.SIGKILL)
    if detail:
        return False, detail
    if _room_port_open(room_port):
        return False, f"room server on port {room_port} still running after SIGKILL"
    return True, ""


def _start_agent(
    *,
    workspace: str,
    pane_id: str,
    instance_name: str,
) -> None:
    command = agent_launch_cmd(instance_name)
    _run(["select-pane", "-t", pane_id, "-T", instance_name])
    shell = os.environ.get("SHELL") or "/bin/zsh"
    result = _run(
        ["respawn-pane", "-k", "-t", pane_id, "-c", workspace, shell, "-lc", command],
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"failed to start {instance_name}"
        raise SessionControlError(detail)


def _prepare_instances(requested: list[str]) -> list[str]:
    bases: list[str] = []
    for raw in requested:
        base = agent_base_name(raw)
        if base not in AGENTS:
            raise SessionControlError(f"Unknown agent: {raw}")
        if not resolve_agent_executable(base):
            raise SessionControlError(f"Required command not found for {base}")
        bases.append(base)
    return _instance_names(bases)


def _create_tmux_session(workspace: Path) -> str:
    created = _run(
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


def _pane_status(pane_id: str) -> dict:
    title = _run(["display-message", "-p", "-t", pane_id, "#{pane_title}"]).stdout.strip()
    command = _run(["display-message", "-p", "-t", pane_id, "#{pane_current_command}"]).stdout.strip()
    dead = _run(["display-message", "-p", "-t", pane_id, "#{pane_dead}"]).stdout.strip() == "1"
    return {"pane_id": pane_id, "title": title, "command": command, "dead": dead}


def describe_session(session_name: str) -> dict:
    try:
        meta = read_session_meta(session_name)
    except FileNotFoundError as exc:
        raise SessionControlError(f"Session does not exist: {session_name}") from exc
    workspace = meta["workspace"]
    info: dict = {
        "session": session_name,
        "workspace": workspace,
        "agents": meta["agents"],
        "active": False,
    }
    tmux_name = find_live_session_for_workspace(workspace)
    if not tmux_name:
        return info

    attached = _run(["display-message", "-p", "-t", tmux_name, "#{session_attached}"]).stdout.strip()
    created_epoch = _run(["display-message", "-p", "-t", tmux_name, "#{session_created}"]).stdout.strip()
    window_count = len(_run(["list-windows", "-t", tmux_name, "-F", "#{window_id}"]).stdout.splitlines())
    dead_panes = sum(
        1
        for line in _run(["list-panes", "-s", "-t", tmux_name, "-F", "#{pane_dead}"]).stdout.splitlines()
        if line.strip() == "1"
    )
    topology = agent_topology(tmux_name)
    agents = [pane.name for pane in topology]
    current_pane = os.environ.get("TMUX_PANE") or ""
    this_pane_role = None
    panes: dict[str, dict | None] = {}
    for pane in topology:
        panes[pane.name] = _pane_status(pane.pane_id)
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
    agents: list[str],
    repo_root: Path | str | None = None,
    revive: bool = False,
) -> None:
    workspace_path = Path(workspace).expanduser().resolve()
    if not workspace_path.is_dir():
        raise SessionControlError(f"Invalid workspace: {workspace_path}")
    root = Path(repo_root).resolve() if repo_root is not None else _repo_root()
    instances = _prepare_instances(agents)
    if not revive:
        create_session_folder(session_name, str(workspace_path), instances)
    ensure_workspace_log_link(session_name, str(workspace_path))

    tmux_name = _create_tmux_session(workspace_path)

    configure_window_size(target=f"{tmux_name}:0", width=SESSION_WIDTH)
    _run(["rename-window", "-t", f"{tmux_name}:0", TERMINAL_WINDOW_NAME])
    for args in (
        ["set-option", "-t", tmux_name, "-g", "remain-on-exit", "on"],
        ["set-option", "-t", tmux_name, "-g", "mouse", "on"],
        ["set-option", "-t", tmux_name, "-g", "pane-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "pane-active-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "status-style", "bg=#38393D,fg=#ACB4BE"],
        ["set-option", "-t", tmux_name, "-g", "history-limit", "50000"],
    ):
        _run(args)
    _run(["set-option", "-t", tmux_name, "-g", "@scroll-speed-num-lines-per-scroll", "1"])

    panes: list[str] = []
    for instance in instances:
        pane_id = create_agent_window(
            session=tmux_name,
            instance_name=instance,
            workspace=str(workspace_path),
            width=SESSION_WIDTH,
        )
        if not pane_id:
            raise SessionControlError(f"Failed to create agent window for {instance}")
        panes.append(pane_id)

    bin_dir = str(root / "bin")
    path_value = f"{bin_dir}:{os.environ.get('PATH', '')}"
    _set_env(tmux_name, "PATH", path_value)
    _unset_env(tmux_name, "CLAUDECODE")
    _write_meta(tmux_name, session_name)

    if panes:
        for instance, pane_id in zip(instances, panes):
            _start_agent(
                workspace=str(workspace_path),
                pane_id=pane_id,
                instance_name=instance,
            )
        _run(["select-pane", "-t", panes[0]])

    if revive:
        _append_log(session_name, f"Room revived: {workspace_path}")


def kill_session(
    *,
    session_name: str,
) -> None:
    tmux_name = _resolve_tmux_name(session_name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {session_name}")
    workspace = tmux_session_workspace(tmux_name)
    stop_ok, stop_detail = stop_room_server(workspace)
    if not stop_ok:
        raise SessionControlError(f"failed to stop room server for {session_name}: {stop_detail}")
    cleanup_target_process_groups(target=tmux_name)
    result = _run(["kill-session", "-t", tmux_name], timeout=4)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or "tmux kill-session failed"
        raise SessionControlError(detail)
    _append_log(session_name, f"Room archived: {workspace}")


def add_agent(
    *,
    session_name: str,
    agent: str,
) -> str:
    base = agent_base_name(agent)
    if not base or base not in AGENTS:
        raise SessionControlError(f"Unknown agent: {agent}")
    if not resolve_agent_executable(base):
        raise SessionControlError(f"Required command not found for {base}")
    tmux_name = _resolve_tmux_name(session_name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {session_name}")
    workspace = tmux_session_workspace(tmux_name)
    topology = agent_topology(tmux_name)
    current = [pane.name for pane in topology]
    instance = next_instance_name(current, base)
    if any(pane.name == instance for pane in topology):
        raise SessionControlError(f"Agent instance already exists: {instance}")
    pane_id = create_agent_window(
        session=tmux_name,
        instance_name=instance,
        workspace=workspace,
        width=SESSION_WIDTH,
    )
    if not pane_id:
        raise SessionControlError("Failed to create agent window")
    _write_meta(tmux_name, session_name)
    _start_agent(
        workspace=workspace,
        pane_id=pane_id,
        instance_name=instance,
    )
    _append_log(session_name, f"Add Agent: {instance}")
    return instance


def remove_agent(
    *,
    session_name: str,
    agent: str,
) -> str:
    tmux_name = _resolve_tmux_name(session_name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {session_name}")
    pane_id = next((pane.pane_id for pane in agent_topology(tmux_name) if pane.name == agent), None)
    if pane_id is None:
        raise SessionControlError(f"Agent instance not in this session: {agent}")
    window_target = window_target_for_pane(pane_id=pane_id)
    if not window_target:
        raise SessionControlError(f"No tmux window recorded for instance: {agent}")
    if not kill_window_target(window_target=window_target):
        raise SessionControlError(f"tmux kill-window failed for {window_target}")
    _write_meta(tmux_name, session_name)
    _append_log(session_name, f"Remove Agent: {agent}")
    return agent
