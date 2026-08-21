from __future__ import annotations

import json
import os
import shutil
import signal
import socket
import subprocess
import sys
import time
from collections import Counter
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from backend_core.access.files import append_jsonl_entry
from backend_core.access.session_meta import find_session_for_workspace, session_workspace, write_session_meta_file
from backend_core.access.settings import (
    agent_window_session_root,
    default_chat_port,
    ensure_session_workspace_mirrors,
    port_is_bindable,
    sanitize_session_name,
    session_log_path,
)
from backend_core.agents.executables import agent_launch_cmd, resolve_agent_executable
from backend_core.agents.instances import (
    agents_to_csv,
    append_instance,
    next_instance_name,
    parse_agents_csv,
    remove_instance,
    renumber_exact_instance,
    resolve_canonical_instance,
)
from backend_core.agents.registry import AGENTS, base_agent_name
from backend_core.tmux.process_cleanup import cleanup_target_process_groups
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
SESSION_HEIGHT = 80


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


def _has_session(prefix: list[str], session_name: str) -> bool:
    return _run(prefix, ["has-session", "-t", f"={session_name}"]).returncode == 0


def _tmux_name_for_workspace(workspace: str) -> str:
    return sanitize_session_name(str(workspace)) or "workspace"


def _live_tmux_session_for_workspace(prefix: list[str], workspace: str) -> str | None:
    """Find the tmux session (if any) currently running at a workspace path.

    tmux never knows an AW session's name -- only the workspace it was
    started in (AGENT_WINDOW_WORKSPACE, set once at creation and never
    rewritten). This is the only bridge from an AW session (identified by
    its log folder / .meta) to whichever live tmux session backs it.
    """
    target = str(Path(workspace).expanduser().resolve())
    result = _run(prefix, ["list-sessions", "-F", "#{session_name}"])
    if result.returncode != 0:
        return None
    for candidate in result.stdout.splitlines():
        candidate = candidate.strip()
        if candidate and _env_value(prefix, candidate, "AGENT_WINDOW_WORKSPACE") == target:
            return candidate
    return None


def _resolve_tmux_name(prefix: list[str], session_name: str) -> str | None:
    workspace = session_workspace(session_name)
    if not workspace:
        return None
    return _live_tmux_session_for_workspace(prefix, workspace)


def _env_value(prefix: list[str], session_name: str, key: str) -> str:
    result = _run(prefix, ["show-environment", "-t", session_name, key])
    line = (result.stdout or "").strip()
    if result.returncode != 0 or "=" not in line:
        return ""
    value = line.split("=", 1)[1].strip()
    return "" if value == "-" else value


def _set_env(prefix: list[str], session_name: str, key: str, value: str) -> None:
    _run(prefix, ["set-environment", "-t", session_name, key, value])


def _unset_env(prefix: list[str], session_name: str, key: str) -> None:
    _run(prefix, ["set-environment", "-t", session_name, "-u", key])


def _pane_env_key(instance_name: str) -> str:
    return f"AGENT_WINDOW_PANE_{instance_name.upper().replace('-', '_')}"


def _running_env_key(instance_name: str) -> str:
    return f"AGENT_WINDOW_RUNNING_{instance_name.upper().replace('-', '_')}"


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


def _show_environment(prefix: list[str], session_name: str) -> str:
    return _run(prefix, ["show-environment", "-t", session_name]).stdout or ""


def _write_meta(prefix: list[str], tmux_name: str, aw_name: str, *, rename: tuple[str, str] | None = None) -> None:
    agents = _env_value(prefix, tmux_name, "AGENT_WINDOW_AGENTS")
    write_session_meta_file(aw_name, agents or "-", _show_environment(prefix, tmux_name), rename=rename)


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
    message = {
        "archived": "Session archived.",
        "revived": "Session revived.",
    }.get(action)
    if not message:
        return
    _append_log(
        session_name,
        message,
        kind="session-lifecycle",
        extra={"lifecycle_action": action},
    )


def _process_command(pid: int) -> str | None:
    try:
        result = subprocess.run(
            ["ps", "-p", str(pid), "-ww", "-o", "command="],
            capture_output=True,
            text=True,
            timeout=1,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise SessionControlError(f"ps timed out for pid {pid}") from exc
    except OSError as exc:
        raise SessionControlError(f"ps failed for pid {pid}: {exc}") from exc
    if result.returncode == 1:
        return None
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"ps exited {result.returncode}"
        raise SessionControlError(f"ps failed for pid {pid}: {detail}")
    command = (result.stdout or "").strip()
    return command or None


def _is_own_chat_server(command: str, session_name: str) -> bool:
    tokens = command.split()
    for i, token in enumerate(tokens):
        if token != "-m":
            continue
        if i + 2 >= len(tokens):
            return False
        if tokens[i + 1] != "server.server":
            continue
        return tokens[i + 2] == session_name
    return False


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
    return [int(line.strip()) for line in (result.stdout or "").splitlines() if line.strip().isdigit()]


def _own_chat_listener_pids(chat_port: int, session_name: str) -> list[int]:
    ours: list[int] = []
    foreign: list[int] = []
    for pid in _chat_listener_pids(chat_port):
        command = _process_command(pid)
        if command is None:
            continue
        if _is_own_chat_server(command, session_name):
            ours.append(pid)
        else:
            foreign.append(pid)
    if foreign:
        shown = ", ".join(str(pid) for pid in foreign)
        raise SessionControlError(
            f"chat port {chat_port} is occupied by pid {shown}, not this session's chat server"
        )
    return ours


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


def stop_chat_server(session_name: str) -> tuple[bool, str]:
    name = (session_name or "").strip()
    if not name:
        return False, "session_name is required"
    chat_port = default_chat_port(name)
    try:
        pids = _own_chat_listener_pids(chat_port, name)
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
    repo_root: Path,
    session_name: str,
    workspace: str,
    pane_id: str,
    instance_name: str,
) -> None:
    runtime = SimpleNamespace(repo_root=repo_root, workspace=workspace, session_name=session_name, tmux_prefix=prefix)
    command = agent_launch_cmd(runtime, instance_name)
    _run(prefix, ["select-pane", "-t", pane_id, "-T", instance_name])
    _set_env(prefix, session_name, "AGENT_WINDOW_AGENT_NAME", instance_name)
    shell = os.environ.get("SHELL") or "/bin/zsh"
    if not os.path.isfile(shell) or not os.access(shell, os.X_OK):
        raise SessionControlError(f"shell is not executable: {shell}")
    result = _run(
        prefix,
        ["respawn-pane", "-k", "-t", pane_id, "-c", workspace, shell, "-lc", command],
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or f"failed to start {instance_name}"
        raise SessionControlError(detail)


def _prepare_instances(repo_root: Path, requested: list[str]) -> list[str]:
    bases: list[str] = []
    for raw in requested:
        base = base_agent_name(raw)
        if not base or base not in AGENTS:
            raise SessionControlError(f"Unknown agent: {raw}")
        bases.append(base)
    if not bases:
        return []
    kept: list[str] = []
    for base in bases:
        if not resolve_agent_executable(repo_root, base):
            raise SessionControlError(f"Required command not found for {base}")
        kept.append(base)
    return _instance_names(kept)


def _parse_meta_timestamp(value: str) -> float:
    value = (value or "").strip()
    if not value:
        return 0.0
    try:
        return datetime.strptime(value, "%Y-%m-%d %H:%M").timestamp()
    except ValueError:
        return 0.0


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
        "created_at": str(meta.get("created_at") or ""),
        "updated_at": str(meta.get("updated_at") or ""),
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
    agents = _session_agents(prefix, tmux_name)
    current_pane = os.environ.get("TMUX_PANE") or ""
    this_pane_role = None
    panes: dict[str, dict | None] = {}
    for instance in agents:
        pane_id = _env_value(prefix, tmux_name, _pane_env_key(instance))
        if not pane_id:
            panes[instance] = None
            continue
        panes[instance] = _pane_status(prefix, pane_id)
        if current_pane and pane_id == current_pane:
            this_pane_role = instance

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


def list_sessions(*, tmux_socket: str = "") -> list[dict]:
    """All AW sessions, active and archived alike, in one folder-first pass."""
    root = agent_window_session_root()
    if not root.is_dir():
        return []
    sessions: list[dict] = []
    for entry in sorted(root.iterdir()):
        if not entry.is_dir():
            continue
        try:
            sessions.append(describe_session(entry.name, tmux_socket=tmux_socket))
        except SessionControlError:
            continue
    sessions.sort(key=lambda item: (not item["active"], -_parse_meta_timestamp(item["updated_at"])))
    return sessions


def latest_session_name() -> str | None:
    root = agent_window_session_root()
    if not root.is_dir():
        return None
    best_name: str | None = None
    best_epoch = -1.0
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        meta_path = entry / ".meta"
        if not meta_path.is_file():
            continue
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if not isinstance(meta, dict):
            continue
        epoch = _parse_meta_timestamp(str(meta.get("created_at") or ""))
        if epoch > best_epoch:
            best_epoch = epoch
            best_name = entry.name
    return best_name


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
    existing = find_session_for_workspace(workspace_path, exclude_session=name)
    if existing:
        raise SessionControlError(f"A session already exists for this workspace: {existing}")
    root = Path(repo_root).resolve() if repo_root is not None else _repo_root()
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    # tmux's own session name is derived from the workspace, not the AW
    # session name: tmux only ever genuinely knows where it was started,
    # never what an AW session happens to be called right now. Deriving it
    # from the AW name would leave a stale tmux name behind the moment the
    # AW session is renamed.
    tmux_name = _tmux_name_for_workspace(str(workspace_path))
    if _has_session(prefix, tmux_name):
        raise SessionControlError(f"Session already exists: {tmux_name}")

    instances = _prepare_instances(
        root,
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

    created = _run(
        prefix,
        [
            "new-session",
            "-d",
            "-x",
            str(SESSION_WIDTH),
            "-y",
            str(SESSION_HEIGHT),
            "-s",
            tmux_name,
            "-c",
            str(workspace_path),
        ],
    )
    if created.returncode != 0:
        detail = (created.stderr or created.stdout or "").strip() or "tmux new-session failed"
        raise SessionControlError(detail)

    configure_window_size(target=f"{tmux_name}:0", width=SESSION_WIDTH, tmux_socket=socket_name)
    _run(prefix, ["rename-window", "-t", f"{tmux_name}:0", "terminal"])
    for args in (
        ["set-option", "-t", tmux_name, "-g", "remain-on-exit", "on"],
        ["set-option", "-t", tmux_name, "-g", "mouse", "on"],
        ["set-option", "-t", tmux_name, "-g", "pane-border-style", "fg='#38393D'"],
        ["set-option", "-t", tmux_name, "-g", "pane-active-border-style", "fg='#38393D'"],
        ["set-option", "-t", tmux_name, "-g", "status-style", "bg='#38393D',fg='#ACB4BE'"],
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
    _set_env(prefix, tmux_name, "AGENT_WINDOW_WORKSPACE", str(workspace_path))
    _set_env(prefix, tmux_name, "PATH", path_value)
    _unset_env(prefix, tmux_name, "CLAUDECODE")
    _unset_env(prefix, tmux_name, "AGENT_WINDOW_PANE_USER")
    _unset_env(prefix, tmux_name, "AGENT_WINDOW_PANES_USER")
    for instance, pane_id in zip(instances, panes):
        _set_env(prefix, tmux_name, _pane_env_key(instance), pane_id)
    _set_env(prefix, tmux_name, "AGENT_WINDOW_AGENTS", agents_to_csv(instances) if instances else "-")
    _write_meta(prefix, tmux_name, name)

    if panes:
        for instance, pane_id in zip(instances, panes):
            _start_agent(
                prefix=prefix,
                repo_root=root,
                session_name=tmux_name,
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
    stop_ok, stop_detail = stop_chat_server(name)
    if not stop_ok:
        raise SessionControlError(f"failed to stop chat server for {name}: {stop_detail}")
    cleanup_target_process_groups(target=tmux_name, tmux_prefix=prefix)
    result = _run(prefix, ["kill-session", "-t", tmux_name], timeout=4)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip() or "tmux kill-session failed"
        raise SessionControlError(detail)
    append_session_lifecycle_entry(name, "archived")


def rename_session(*, old_name: str, new_name: str) -> None:
    """Rename an AW session's log folder -- its only real identity.

    tmux (if a live session is currently bound to this AW session) is left
    completely untouched: it never carries the AW session's name at all,
    only the workspace it runs in (which a rename doesn't change), so
    there's nothing on the tmux side to reconcile.

    Any chat server currently serving the old name is stopped, not
    relaunched: the old log folder no longer exists at that path once the
    rename lands, and a chat server that's still running with the old path
    cached in memory would silently recreate an empty one on its next
    write. The next time anyone opens the (renamed) session, the normal
    on-demand launch picks it up correctly under the new name.
    """
    old = (old_name or "").strip()
    new = sanitize_session_name(str(new_name or ""))
    if not old:
        raise SessionControlError("old_name is required")
    if not new:
        raise SessionControlError("new_name is required")
    if old == new:
        return
    old_dir = agent_window_session_root() / old
    if not old_dir.is_dir():
        raise SessionControlError(f"Session does not exist: {old}")
    new_dir = agent_window_session_root() / new
    if new_dir.exists():
        raise SessionControlError(f"A session named '{new}' already exists")
    new_port = default_chat_port(new)
    if not port_is_bindable(new_port):
        raise SessionControlError(f"chat port {new_port} is occupied")

    old_dir.rename(new_dir)
    _append_log(
        new,
        f"Session renamed: {old} -> {new}",
        kind="session-lifecycle",
        extra={"lifecycle_action": "renamed", "previous_name": old},
    )

    stop_ok, stop_detail = stop_chat_server(old)
    if not stop_ok:
        raise SessionControlError(f"renamed, but failed to stop the old chat server: {stop_detail}")


def _with_topology_lock(tmux_socket: str, session_name: str):
    lock_dir = session_topology_lock_path(tmux_socket, session_name)
    if not acquire_topology_lock(lock_dir, os.getpid()):
        raise SessionControlError(f"Timed out waiting for topology lock: {session_name}")
    return lock_dir


def _session_agents(prefix: list[str], session_name: str) -> list[str]:
    return parse_agents_csv(_env_value(prefix, session_name, "AGENT_WINDOW_AGENTS"))


def add_agent(
    *,
    session_name: str,
    agent: str,
    tmux_socket: str = "",
    repo_root: Path | str | None = None,
    initiator: str = "",
) -> tuple[str, tuple[str, str] | None]:
    name = (session_name or "").strip()
    base = base_agent_name(agent)
    if not name:
        raise SessionControlError("session_name is required")
    if not base or base not in AGENTS:
        raise SessionControlError(f"Unknown agent: {agent}")
    root = Path(repo_root).resolve() if repo_root is not None else _repo_root()
    if not resolve_agent_executable(root, base):
        raise SessionControlError(f"Required command not found for {base}")
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    tmux_name = _resolve_tmux_name(prefix, name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {name}")
    workspace = _env_value(prefix, tmux_name, "AGENT_WINDOW_WORKSPACE")
    if not workspace:
        raise SessionControlError("workspace unavailable")
    ensure_session_workspace_mirrors(name, workspace)

    lock_dir = _with_topology_lock(socket_name, name)
    try:
        current = _session_agents(prefix, tmux_name)
        current, rename = renumber_exact_instance(current, base)
        if rename:
            old_name, new_name = rename
            old_pane = _env_value(prefix, tmux_name, _pane_env_key(old_name))
            if old_pane:
                _unset_env(prefix, tmux_name, _pane_env_key(old_name))
                _set_env(prefix, tmux_name, _pane_env_key(new_name), old_pane)
            if _env_value(prefix, tmux_name, _running_env_key(old_name)) == "1":
                _unset_env(prefix, tmux_name, _running_env_key(old_name))
                _set_env(prefix, tmux_name, _running_env_key(new_name), "1")
            _set_env(prefix, tmux_name, "AGENT_WINDOW_AGENTS", agents_to_csv(current))
        instance = next_instance_name(current, base)
        if _env_value(prefix, tmux_name, _pane_env_key(instance)):
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
        updated = append_instance(current, instance)
        _set_env(prefix, tmux_name, _pane_env_key(instance), pane_id)
        _set_env(prefix, tmux_name, "AGENT_WINDOW_AGENTS", agents_to_csv(updated))
        _write_meta(prefix, tmux_name, name, rename=rename)
        _start_agent(
            prefix=prefix,
            repo_root=root,
            session_name=tmux_name,
            workspace=workspace,
            pane_id=pane_id,
            instance_name=instance,
        )
        actor = (initiator or os.environ.get("AGENT_WINDOW_AGENT_NAME") or "user").strip() or "user"
        _append_log(
            name,
            f"Add Agent: {actor} -> {instance}",
            kind="session-topology",
            extra={"topology_action": "add-agent", "agent_instance": instance, "initiator": actor},
        )
        return instance, rename
    finally:
        release_topology_lock(lock_dir)


def remove_agent(
    *,
    session_name: str,
    agent: str,
    tmux_socket: str = "",
    repo_root: Path | str | None = None,
    initiator: str = "",
) -> tuple[str, bool]:
    name = (session_name or "").strip()
    requested = (agent or "").strip().lower()
    if not name:
        raise SessionControlError("session_name is required")
    if not requested:
        raise SessionControlError("agent is required")
    prefix = _prefix(tmux_socket)
    socket_name = (tmux_socket or "").strip() or default_tmux_socket_name()
    tmux_name = _resolve_tmux_name(prefix, name)
    if not tmux_name:
        raise SessionControlError(f"Session does not exist: {name}")
    workspace = _env_value(prefix, tmux_name, "AGENT_WINDOW_WORKSPACE")
    if workspace:
        ensure_session_workspace_mirrors(name, workspace)

    lock_dir = _with_topology_lock(socket_name, name)
    try:
        current = _session_agents(prefix, tmux_name)
        canonical = resolve_canonical_instance(current, requested)
        if not canonical:
            raise SessionControlError(f"Agent instance not in this session: {agent}")
        remaining = remove_instance(current, canonical)
        if len(remaining) < 1:
            raise SessionControlError("Cannot remove the last agent pane")
        pane_id = _env_value(prefix, tmux_name, _pane_env_key(canonical))
        if not pane_id:
            raise SessionControlError(f"No tmux pane recorded for instance: {canonical}")
        if os.environ.get("TMUX_PANE") == pane_id and os.environ.get("AGENT_WINDOW_REMOVE_HELPER") != "1":
            env = os.environ.copy()
            env["AGENT_WINDOW_REMOVE_HELPER"] = "1"
            pythonpath = [str(_repo_root())]
            existing = (env.get("PYTHONPATH") or "").strip()
            if existing:
                pythonpath.append(existing)
            env["PYTHONPATH"] = os.pathsep.join(pythonpath)
            subprocess.Popen(
                [
                    sys.executable,
                    "-m",
                    "backend_core.cli.session_control",
                    "remove-agent",
                    "--session",
                    name,
                    "--agent",
                    canonical,
                    "--tmux-socket",
                    socket_name,
                ],
                cwd=str(_repo_root()),
                env=env,
                start_new_session=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return canonical, True
        window_target = window_target_for_pane(pane_id=pane_id, tmux_socket=socket_name)
        if not window_target:
            raise SessionControlError(f"No tmux window recorded for instance: {canonical}")
        if not kill_window_target(window_target=window_target, tmux_socket=socket_name):
            raise SessionControlError(f"tmux kill-window failed for {window_target}")
        _unset_env(prefix, tmux_name, _pane_env_key(canonical))
        _set_env(prefix, tmux_name, "AGENT_WINDOW_AGENTS", agents_to_csv(remaining))
        _write_meta(prefix, tmux_name, name)
        actor = (initiator or os.environ.get("AGENT_WINDOW_AGENT_NAME") or "user").strip() or "user"
        _append_log(
            name,
            f"Remove Agent: {actor} -> {canonical}",
            kind="session-topology",
            extra={"topology_action": "remove-agent", "agent_instance": canonical, "initiator": actor},
        )
        return canonical, False
    finally:
        release_topology_lock(lock_dir)
