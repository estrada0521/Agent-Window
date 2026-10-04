from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID
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


def agent_launch_cmd(agent_name: str, *, native_log_path: str = "") -> str:
    base = agent_base_name(agent_name)
    agent = AGENTS[base]
    args = shlex.split(agent.launch_args)
    if native_log_path:
        path = Path(native_log_path)
        if not path.is_file():
            raise FileNotFoundError(f"Native log not found for {agent_name}: {path}")
        if base == "claude":
            args.extend(["--resume", str(path)])
        else:
            if base == "codex":
                with path.open(encoding="utf-8") as handle:
                    entry = json.loads(handle.readline())
                if entry["type"] != "session_meta":
                    raise ValueError(f"Codex native log has no session metadata: {path}")
                session_id = entry["payload"]["id"]
                resume_flag = "resume"
            elif base == "antigravity":
                if path.name != "transcript_full.jsonl" or path.parent.name != "logs" or path.parents[1].name != ".system_generated":
                    raise ValueError(f"Invalid Antigravity native log path: {path}")
                session_id = path.parents[2].name
                resume_flag = "--conversation"
            elif base == "cursor":
                session_id = path.stem
                resume_flag = "--resume"
            elif base == "grok":
                session_id = path.parent.name
                resume_flag = "--resume"
            else:
                raise ValueError(f"No resume command for {agent_name}")
            args.extend([resume_flag, str(UUID(session_id))])
    return f"exec {agent.launch_extra} {shlex.quote(agent_executable_path(agent_name))} {shlex.join(args)}".rstrip()
