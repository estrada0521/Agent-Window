from __future__ import annotations

import logging
import subprocess


def active_agents(runtime, *, subprocess_module=subprocess) -> list[str]:
    if not runtime.session_is_active:
        return []
    r = subprocess_module.run(
        [*runtime.tmux_prefix, "show-environment", "-t", runtime.session_name, "AGENT_WINDOW_AGENTS"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    line = r.stdout.strip()
    if r.returncode == 0 and "=" in line:
        raw = line.split("=", 1)[1].strip()
        if not raw or raw == "-":
            return []
        return [a for a in raw.split(",") if a and a != "-"]
    if r.returncode != 0:
        detail = (r.stderr or r.stdout or "").strip()
        if "unknown variable" in detail.lower():
            return []
        raise RuntimeError(
            f"tmux show-environment AGENT_WINDOW_AGENTS failed (exit {r.returncode}): {detail or line!r}"
        )
    raise RuntimeError(f"tmux show-environment AGENT_WINDOW_AGENTS returned unreadable output: {line!r}")


def running_agents_from_env(runtime, agents: list[str], *, subprocess_module=subprocess, logging_module=logging) -> set[str]:
    running: set[str] = set()
    for agent in agents or []:
        name = str(agent or "").strip()
        if not name:
            continue
        upper = name.upper().replace("-", "_")
        var = f"AGENT_WINDOW_RUNNING_{upper}"
        try:
            result = subprocess_module.run(
                [*runtime.tmux_prefix, "show-environment", "-t", runtime.session_name, var],
                capture_output=True,
                text=True,
                timeout=1,
                check=False,
            )
        except Exception as exc:
            logging_module.error(f"Unexpected error: {exc}", exc_info=True)
            continue
        line = result.stdout.strip()
        if result.returncode == 0 and "=" in line and line.split("=", 1)[1].strip() == "1":
            running.add(name)
    return running


def pane_id_for_agent(runtime, agent_name: str, *, subprocess_module=subprocess) -> str:
    pane_var = f"AGENT_WINDOW_PANE_{agent_name.upper().replace('-', '_')}"
    res = subprocess_module.run(
        [*runtime.tmux_prefix, "show-environment", "-t", runtime.session_name, pane_var],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    line = res.stdout.strip()
    if res.returncode == 0 and "=" in line:
        return line.split("=", 1)[1].strip()
    if res.returncode != 0:
        detail = (res.stderr or res.stdout or "").strip()
        if "unknown variable" in detail.lower():
            return ""
        raise RuntimeError(
            f"tmux show-environment {pane_var} failed (exit {res.returncode}): {detail or line!r}"
        )
    raise RuntimeError(f"tmux show-environment {pane_var} returned unreadable output: {line!r}")


def pane_field(runtime, pane_id: str, field: str, *, subprocess_module=subprocess) -> str:
    if not pane_id:
        return ""
    result = subprocess_module.run(
        [*runtime.tmux_prefix, "display-message", "-p", "-t", pane_id, field],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    return result.stdout.strip()
