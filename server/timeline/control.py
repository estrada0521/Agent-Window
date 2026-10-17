from __future__ import annotations

import os
import time
from collections import Counter
from pathlib import Path

from fs.log.jsonl import append_jsonl_entry, iter_log_entries_reversed
from fs.log.meta import (
    LogMetaError,
    create_log_dir,
    log_workspace,
    read_log_meta,
    write_json_atomically,
)
from fs.log.paths import (
    ensure_workspace_log_link,
    log_jsonl_path,
    log_meta_path,
)
from agents.executables import agent_executable_path, agent_launch_cmd
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
from tmux import run_tmux
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


def _resolve_tmux_name(timeline_name: str) -> str | None:
    try:
        workspace = log_workspace(timeline_name)
    except LogMetaError as exc:
        raise SessionControlError(str(exc)) from exc
    return find_live_session_for_workspace(workspace)


def _set_env(tmux_name: str, key: str, value: str) -> None:
    run_tmux(["set-environment", "-t", tmux_name, key, value])


def _unset_env(tmux_name: str, key: str) -> None:
    run_tmux(["set-environment", "-t", tmux_name, "-u", key])


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


def _update_agents(tmux_name: str, aw_name: str) -> None:
    meta = read_log_meta(aw_name)
    meta["agents"] = [pane.name for pane in agent_topology(tmux_name)]
    write_json_atomically(log_meta_path(aw_name), meta)


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


def _start_agent(
    *,
    workspace: str,
    pane_id: str,
    instance_name: str,
    command: str,
) -> None:
    run_tmux(["select-pane", "-t", pane_id, "-T", instance_name])
    shell = os.environ.get("SHELL") or "/bin/zsh"
    result = run_tmux(["respawn-pane", "-k", "-t", pane_id, "-c", workspace, shell, "-lc", command])
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"failed to start {instance_name}"
        raise SessionControlError(detail)


def _require_on_path(agent: str) -> None:
    try:
        agent_executable_path(agent)
    except FileNotFoundError as exc:
        raise SessionControlError(str(exc)) from exc


def _prepare_instances(requested: list[str], *, preserve_names: bool = False) -> list[str]:
    bases: list[str] = []
    for raw in requested:
        base = agent_base_name(raw)
        if base not in AGENTS:
            raise SessionControlError(f"Unknown agent: {raw}")
        _require_on_path(base)
        bases.append(base)
    if preserve_names:
        if len(set(requested)) != len(requested):
            raise SessionControlError("Duplicate saved agent instance names")
        return list(requested)
    return _instance_names(bases)


def _resume_native_logs(timeline_name: str, instances: list[str]) -> dict[str, str]:
    pending = set(instances)
    paths = {}
    for entry in iter_log_entries_reversed(log_jsonl_path(timeline_name)):
        if not pending:
            break
        sender = entry["sender"]
        if sender in pending and entry.get("native_log_path"):
            paths[sender] = entry["native_log_path"]
            pending.remove(sender)
        elif sender == "system":
            if entry["message"].startswith("Add Agent: "):
                pending.discard(entry["message"][len("Add Agent: "):])
    return paths


def _create_tmux_session(workspace: Path) -> str:
    created = run_tmux([
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
        ])
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
    instances = _prepare_instances(agents, preserve_names=revive)
    try:
        native_logs = _resume_native_logs(timeline_name, instances) if revive else {}
        if revive:
            missing = [instance for instance in instances if instance not in native_logs]
            if missing:
                raise SessionControlError("Conversation unavailable · Reset Agents")
        commands = {
            instance: agent_launch_cmd(instance, native_log_path=native_logs[instance] if revive else "")
            for instance in instances
        }
    except (OSError, ValueError, KeyError, TypeError, IndexError) as exc:
        raise SessionControlError(f"Cannot revive timeline: {exc}") from exc
    if not revive:
        create_log_dir(timeline_name, str(workspace_path), instances)
    ensure_workspace_log_link(timeline_name, str(workspace_path))

    tmux_name = _create_tmux_session(workspace_path)

    configure_window_size(target=f"{tmux_name}:0", width=SESSION_WIDTH)
    run_tmux(["rename-window", "-t", f"{tmux_name}:0", TERMINAL_WINDOW_NAME])
    for args in (
        ["set-option", "-t", tmux_name, "-g", "remain-on-exit", "on"],
        ["set-option", "-t", tmux_name, "-g", "mouse", "on"],
        ["set-option", "-t", tmux_name, "-g", "pane-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "pane-active-border-style", "fg=#38393D"],
        ["set-option", "-t", tmux_name, "-g", "status-style", "bg=#38393D,fg=#ACB4BE"],
        ["set-option", "-t", tmux_name, "-g", "history-limit", "50000"],
    ):
        run_tmux(args)
    run_tmux(["set-option", "-t", tmux_name, "-g", "@scroll-speed-num-lines-per-scroll", "1"])

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
    _update_agents(tmux_name, timeline_name)

    if panes:
        for instance, pane_id in zip(instances, panes):
            _start_agent(
                workspace=str(workspace_path),
                pane_id=pane_id,
                instance_name=instance,
                command=commands[instance],
            )
        run_tmux(["select-pane", "-t", panes[0]])

    if revive:
        _append_log(timeline_name, f"Session revived: {workspace_path}")


def kill_session(
    *,
    timeline_name: str,
) -> None:
    tmux_name = _resolve_tmux_name(timeline_name)
    if not tmux_name:
        raise SessionControlError(f"Timeline does not exist: {timeline_name}")
    workspace = tmux_session_workspace(tmux_name)
    cleanup_target_process_groups(target=tmux_name)
    result = run_tmux(["kill-session", "-t", tmux_name], timeout=4)
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
    _require_on_path(base)
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
    _update_agents(tmux_name, timeline_name)
    _start_agent(
        workspace=workspace,
        pane_id=pane_id,
        instance_name=instance,
        command=agent_launch_cmd(instance),
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
    _update_agents(tmux_name, timeline_name)
    _append_log(timeline_name, f"Remove Agent: {agent}")
    return agent
