from __future__ import annotations

import os
import subprocess

from agents.executables import agent_launch_cmd
from tmux import TMUX
from tmux.process_cleanup import cleanup_target_process_groups


def _respawn_agent_pane(state, pane_id: str, command: str) -> tuple[bool, str]:
    shell = os.environ.get("SHELL") or "/bin/zsh"
    cleanup_target_process_groups(target=pane_id)
    respawn_res = subprocess.run(
        [
            *TMUX,
            "respawn-pane",
            "-k",
            "-t",
            pane_id,
            "-c",
            state.workspace,
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


def _remove_agent_binding(state, agent_name: str) -> None:
    state.remove_native_log_binding(agent_name)


def restart_agent_pane(state, agent_name: str) -> tuple[bool, str]:
    pane_id = state.pane_id_for_agent(agent_name)
    if not pane_id:
        return False, f"pane not found for {agent_name}"
    ok, detail = _respawn_agent_pane(
        state,
        pane_id,
        agent_launch_cmd(agent_name),
    )
    if not ok:
        return False, detail or f"failed to restart {agent_name}"
    _remove_agent_binding(state, agent_name)
    subprocess.run(
        [*TMUX, "select-pane", "-t", pane_id, "-T", agent_name],
        capture_output=True,
        check=False,
    )
    return True, pane_id
