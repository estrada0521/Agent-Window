from __future__ import annotations

import os
import subprocess

from backend_core.agents.executables import agent_launch_cmd, agent_resume_cmd
from backend_core.tmux.process_cleanup import cleanup_target_process_groups


def _respawn_agent_pane(runtime, pane_id: str, command: str, *, subprocess_module=subprocess, os_module=os) -> tuple[bool, str]:
    shell = os_module.environ.get("SHELL") or "/bin/zsh"
    cleanup_target_process_groups(target=pane_id, tmux_prefix=runtime.tmux_prefix)
    respawn_res = subprocess_module.run(
        [
            *runtime.tmux_prefix,
            "respawn-pane",
            "-k",
            "-t",
            pane_id,
            "-c",
            runtime.workspace,
            shell,
            "-lc",
            command,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if respawn_res.returncode != 0:
        detail = (respawn_res.stderr or respawn_res.stdout or "").strip()
        return False, detail
    return True, pane_id


def _set_agent_runtime_env(runtime, agent_name: str, *, subprocess_module=subprocess) -> None:
    subprocess_module.run(
        [*runtime.tmux_prefix, "set-environment", "-t", runtime.tmux_session_name, "AGENT_WINDOW_AGENT_NAME", agent_name],
        capture_output=True,
        check=False,
    )


def _refresh_agent_bindings(runtime, pane_id: str, agent_name: str) -> None:
    runtime._native_log._pane_native_log_paths.pop(pane_id, None)
    runtime._native_log.on_pane_restart(agent_name)
    runtime.refresh_native_log_bindings([agent_name])


def restart_agent_pane(runtime, agent_name: str, *, subprocess_module=subprocess, os_module=os) -> tuple[bool, str]:
    pane_id = runtime.pane_id_for_agent(agent_name)
    if not pane_id:
        return False, f"pane not found for {agent_name}"
    _set_agent_runtime_env(runtime, agent_name, subprocess_module=subprocess_module)
    ok, detail = _respawn_agent_pane(
        runtime,
        pane_id,
        agent_launch_cmd(agent_name),
        subprocess_module=subprocess_module,
        os_module=os_module,
    )
    if not ok:
        return False, detail or f"failed to restart {agent_name}"
    _refresh_agent_bindings(runtime, pane_id, agent_name)
    subprocess_module.run(
        [*runtime.tmux_prefix, "select-pane", "-t", pane_id, "-T", agent_name],
        capture_output=True,
        check=False,
    )
    return True, pane_id


def resume_agent_pane(runtime, agent_name: str, *, subprocess_module=subprocess, os_module=os) -> tuple[bool, str]:
    pane_id = runtime.pane_id_for_agent(agent_name)
    if not pane_id:
        return False, f"pane not found for {agent_name}"
    _set_agent_runtime_env(runtime, agent_name, subprocess_module=subprocess_module)
    ok, detail = _respawn_agent_pane(
        runtime,
        pane_id,
        agent_resume_cmd(agent_name),
        subprocess_module=subprocess_module,
        os_module=os_module,
    )
    if not ok:
        return False, detail or f"failed to resume {agent_name}"
    _refresh_agent_bindings(runtime, pane_id, agent_name)
    subprocess_module.run(
        [*runtime.tmux_prefix, "select-pane", "-t", pane_id, "-T", agent_name],
        capture_output=True,
        check=False,
    )
    return True, pane_id
