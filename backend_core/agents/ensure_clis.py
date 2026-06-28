from __future__ import annotations

import os
import shutil
from pathlib import Path

from backend_core.agents.registry import AGENTS, canonical_agent_name


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def resolve_agent_executable(repo_root: Path, agent_name: str) -> str | None:
    base = canonical_agent_name(agent_name.split("-", 1)[0])
    adef = AGENTS.get(base)
    exe_name = adef.exe if adef else agent_name
    found = shutil.which(exe_name)
    if found:
        return found
    if base == "cursor":
        found = shutil.which("cursor-agent")
        if found:
            return found
    if adef:
        for p in adef.fallback_paths:
            candidate = Path(p).expanduser()
            if candidate.is_file():
                return str(candidate)
    if adef and adef.fallback_nvm:
        home = Path.home()
        nvm_bin = Path(os.environ.get("NVM_BIN", "")).expanduser()
        candidates: list[Path] = []
        if nvm_bin.is_dir():
            candidates.append(nvm_bin / exe_name)
        candidates.extend(
            sorted(
                (home / ".nvm" / "versions" / "node").glob(f"*/bin/{exe_name}"),
                reverse=True,
            )
        )
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return None


def agent_launch_readiness(repo_root: Path, agent_name: str) -> dict[str, str]:
    base = canonical_agent_name(agent_name.split("-", 1)[0])
    executable = resolve_agent_executable(repo_root, base)
    if not executable:
        disp = AGENTS[base].display_name if base in AGENTS else base
        return {
            "agent": base,
            "status": "missing_cli",
            "error": f"{disp} CLI is not installed on this Mac.",
        }
    return {"agent": base, "status": "ok", "executable": executable}


def resolve_agent_executable_for_runtime(agent_name: str, repo_root: Path | str | None = None) -> str:
    import shlex as _shlex
    resolved_root = Path(repo_root).resolve() if repo_root is not None else _repo_root()
    found = resolve_agent_executable(resolved_root, agent_name)
    if found:
        return found
    base = canonical_agent_name(agent_name.split("-", 1)[0] if "-" in agent_name else agent_name)
    adef = AGENTS.get(base)
    return adef.exe if adef else agent_name


def _build_agent_exec(runtime, agent_name: str) -> tuple[str, object]:
    import shlex as _shlex
    agent_exec_path = Path(resolve_agent_executable_for_runtime(agent_name, repo_root=runtime.repo_root))
    agent_exec = _shlex.quote(str(agent_exec_path))
    base = canonical_agent_name(agent_name.split("-", 1)[0] if "-" in agent_name else agent_name)
    adef = AGENTS.get(base)
    return agent_exec, adef


def agent_launch_cmd(runtime, agent_name: str) -> str:
    agent_exec, adef = _build_agent_exec(runtime, agent_name)
    launch_extra = adef.launch_extra if adef else ""
    launch_flags = adef.launch_flags if adef else ""
    extra = f" {launch_extra}" if launch_extra else ""
    flags = f" {launch_flags}" if launch_flags else ""
    env_prefix = f"{adef.launch_env} " if adef and adef.launch_env else ""
    return f"{env_prefix}exec{extra} {agent_exec}{flags}"


def agent_resume_cmd(runtime, agent_name: str) -> str:
    base = canonical_agent_name(agent_name.split("-", 1)[0] if "-" in agent_name else agent_name)
    adef = AGENTS.get(base)
    if not adef or not adef.resume_flag:
        return agent_launch_cmd(runtime, agent_name)
    agent_exec, adef = _build_agent_exec(runtime, agent_name)
    launch_extra = adef.launch_extra or ""
    resume_extra = adef.resume_extra_flags or ""
    extra = f" {launch_extra}" if launch_extra else ""
    flags = f" {adef.resume_flag}"
    if resume_extra:
        flags += f" {resume_extra}"
    env_prefix = f"{adef.launch_env} " if adef.launch_env else ""
    return f"{env_prefix}exec{extra} {agent_exec}{flags}"
