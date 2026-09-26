from __future__ import annotations

import os
import signal
import socket
import subprocess
import time
from collections import Counter
from pathlib import Path

from fs.log.jsonl import append_jsonl_entry
from server.timeline.probe import read_timeline_server_state
from fs.log.meta import (
    LogMetaError,
    create_log_dir,
    log_workspace,
    write_log_meta_file,
)
from fs.log.paths import (
    ensure_workspace_log_link,
    log_jsonl_path,
    workspace_timeline_port,
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


def _run(args: list[str], *, timeout: float | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [*TMUX, *args],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def _resolve_tmux_name(timeline_name: str) -> str | None:
    try:
        workspace = log_workspace(timeline_name)
    except LogMetaError as exc:
        raise SessionControlError(str(exc)) from exc
    return find_live_session_for_workspace(workspace)


def _set_env(tmux_name: str, key: str, value: str) -> None:
    _run(["set-environment", "-t", tmux_name, key, value])


def _unset_env(tmux_name: str, key: str) -> None:
    _run(["set-environment", "-t", tmux_name, "-u", key])


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
    write_log_meta_file(aw_name, workspace, agents)


def _append_log(timeline_name: str, message: str) -> None:
    append_jsonl_entry(
        log_jsonl_path(timeline_name),
        {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "sender": "system",
            "targets": [],
            "message": message,
        },
    )


def _timeline_listener_pids(timeline_port: int) -> list[int]:
    try:
        result = subprocess.run(
            ["lsof", "-nP", f"-tiTCP:{int(timeline_port)}", "-sTCP:LISTEN"],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SessionControlError(f"lsof timed out for port {timeline_port}") from exc
    except OSError as exc:
        raise SessionControlError(f"lsof failed for port {timeline_port}: {exc}") from exc
    if result.returncode not in (0, 1):
        detail = (result.stderr or result.stdout or "").strip() or f"lsof exited {result.returncode}"
        raise SessionControlError(f"lsof failed for port {timeline_port}: {detail}")
    return sorted({int(line.strip()) for line in (result.stdout or "").splitlines() if line.strip().isdigit()})


def _own_timeline_listener_pids(timeline_port: int, workspace: str) -> list[int]:
    listeners = _timeline_listener_pids(timeline_port)
    if not listeners:
        return []
    state = read_timeline_server_state(timeline_port)
    expected_workspace = str(Path(workspace).expanduser().resolve())
    reported_workspace = str((state or {}).get("workspace") or "").strip()
    if not reported_workspace or str(Path(reported_workspace).expanduser().resolve()) != expected_workspace:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(
            f"timeline port {timeline_port} is occupied by pid {shown}, not this workspace's timeline server"
        )
    try:
        reported_pid = int(state.get("pid") or 0)
    except (TypeError, ValueError):
        reported_pid = 0
    if reported_pid <= 0 or listeners != [reported_pid]:
        shown = ", ".join(str(pid) for pid in listeners)
        raise SessionControlError(f"timeline server pid mismatch on port {timeline_port}: {shown}")
    return listeners


def _timeline_port_open(timeline_port: int) -> bool:
    try:
        with socket.create_connection(("127.0.0.1", int(timeline_port)), timeout=0.35):
            return True
    except OSError:
        return False


_TIMELINE_STOP_WAIT_SEC = 2.0


def _signal_timeline_pids(pids: list[int], sig: int) -> str:
    for pid in pids:
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            continue
        except OSError as exc:
            return f"failed to signal timeline server pid {pid}: {exc}"
    return ""


def stop_timeline_server(workspace: str) -> tuple[bool, str]:
    resolved_workspace = str(Path(workspace).expanduser().resolve())
    timeline_port = workspace_timeline_port(resolved_workspace)
    try:
        pids = _own_timeline_listener_pids(timeline_port, resolved_workspace)
    except SessionControlError as exc:
        return False, str(exc)
    if not pids:
        return True, ""
    detail = _signal_timeline_pids(pids, signal.SIGTERM)
    if detail:
        return False, detail
    deadline = time.monotonic() + _TIMELINE_STOP_WAIT_SEC
    while time.monotonic() < deadline:
        if not _timeline_port_open(timeline_port):
            return True, ""
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        time.sleep(min(0.1, remaining))
    detail = _signal_timeline_pids(pids, signal.SIGKILL)
    if detail:
        return False, detail
    if _timeline_port_open(timeline_port):
        return False, f"timeline server on port {timeline_port} still running after SIGKILL"
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


def create_session(
    *,
    timeline_name: str,
    workspace: str,
    agents: list[str],
    revive: bool = False,
) -> None:
    workspace_path = Path(workspace).expanduser().resolve()
    if not workspace_path.is_dir():
        raise SessionControlError(f"Invalid workspace: {workspace_path}")
    instances = _prepare_instances(agents)
    if not revive:
        create_log_dir(timeline_name, str(workspace_path), instances)
    ensure_workspace_log_link(timeline_name, str(workspace_path))

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

    _set_env(tmux_name, "PATH", os.environ["PATH"])
    _unset_env(tmux_name, "CLAUDECODE")
    _write_meta(tmux_name, timeline_name)

    if panes:
        for instance, pane_id in zip(instances, panes):
            _start_agent(
                workspace=str(workspace_path),
                pane_id=pane_id,
                instance_name=instance,
            )
        _run(["select-pane", "-t", panes[0]])

    if revive:
        _append_log(timeline_name, f"Session created: {workspace_path}")


def kill_session(
    *,
    timeline_name: str,
) -> None:
    tmux_name = _resolve_tmux_name(timeline_name)
    if not tmux_name:
        raise SessionControlError(f"Timeline does not exist: {timeline_name}")
    workspace = tmux_session_workspace(tmux_name)
    stop_ok, stop_detail = stop_timeline_server(workspace)
    if not stop_ok:
        raise SessionControlError(f"failed to stop timeline server for {timeline_name}: {stop_detail}")
    cleanup_target_process_groups(target=tmux_name)
    result = _run(["kill-session", "-t", tmux_name], timeout=4)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or "tmux kill-session failed"
        raise SessionControlError(detail)
    _append_log(timeline_name, f"Session killed: {workspace}")


def add_agent(
    *,
    timeline_name: str,
    agent: str,
) -> str:
    base = agent_base_name(agent)
    if not base or base not in AGENTS:
        raise SessionControlError(f"Unknown agent: {agent}")
    if not resolve_agent_executable(base):
        raise SessionControlError(f"Required command not found for {base}")
    tmux_name = _resolve_tmux_name(timeline_name)
    if not tmux_name:
        raise SessionControlError(f"Timeline does not exist: {timeline_name}")
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
    _write_meta(tmux_name, timeline_name)
    _start_agent(
        workspace=workspace,
        pane_id=pane_id,
        instance_name=instance,
    )
    _append_log(timeline_name, f"Add Agent: {instance}")
    return instance


def remove_agent(
    *,
    timeline_name: str,
    agent: str,
) -> str:
    tmux_name = _resolve_tmux_name(timeline_name)
    if not tmux_name:
        raise SessionControlError(f"Timeline does not exist: {timeline_name}")
    pane_id = next((pane.pane_id for pane in agent_topology(tmux_name) if pane.name == agent), None)
    if pane_id is None:
        raise SessionControlError(f"Agent instance not in this session: {agent}")
    window_target = window_target_for_pane(pane_id=pane_id)
    if not window_target:
        raise SessionControlError(f"No tmux window recorded for instance: {agent}")
    if not kill_window_target(window_target=window_target):
        raise SessionControlError(f"tmux kill-window failed for {window_target}")
    _write_meta(tmux_name, timeline_name)
    _append_log(timeline_name, f"Remove Agent: {agent}")
    return agent
