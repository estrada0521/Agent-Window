from __future__ import annotations

import shlex
import shutil

from agents import agent_base_name
from agents.registry import AGENTS


def agent_executable_path(agent_name: str) -> str:
    executable = AGENTS[agent_base_name(agent_name)].executable
    path = shutil.which(executable)
    if not path:
        raise FileNotFoundError(f"{executable} not found on PATH")
    return path


def agent_launch_cmd(agent_name: str) -> str:
    agent = AGENTS[agent_base_name(agent_name)]
    return f"exec {agent.launch_extra} {shlex.quote(agent_executable_path(agent_name))} {agent.launch_args}".rstrip()
