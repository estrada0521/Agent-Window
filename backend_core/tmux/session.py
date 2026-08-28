from __future__ import annotations

import subprocess

from backend_core.tmux.resolve import find_tmux_session_for_workspace


def resolve_tmux_session_name(runtime, *, subprocess_module=subprocess) -> str | None:
    """Find the live tmux session actually backing this AW session, if any.

    tmux only ever genuinely knows the workspace it was started in
    (AGENT_WINDOW_WORKSPACE, set once at creation and never rewritten) --
    never the AW session's own name, which can be renamed independently of
    the tmux session underneath it. Whether the AW session is active is the
    result of this lookup, not an input to it.
    """
    workspace = str(runtime.workspace or "").strip()
    if not workspace:
        return None
    result = subprocess_module.run(
        [*runtime.tmux_prefix, "list-sessions", "-F", "#{session_name}"],
        capture_output=True,
        text=True,
        timeout=2,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        if "no server running" in detail.lower() or "no such file or directory" in detail.lower():
            return None
        raise RuntimeError(
            f"tmux list-sessions failed while resolving workspace (exit {result.returncode}): {detail}"
        )

    def workspace_of(name: str) -> str | None:
        env_result = subprocess_module.run(
            [*runtime.tmux_prefix, "show-environment", "-t", name, "AGENT_WINDOW_WORKSPACE"],
            capture_output=True,
            text=True,
            timeout=2,
            check=False,
        )
        line = env_result.stdout.strip()
        if env_result.returncode != 0:
            detail = (env_result.stderr or env_result.stdout or "").strip()
            lowered = detail.lower()
            if "unknown variable" in lowered or "can't find session" in lowered:
                return None
            raise RuntimeError(
                f"tmux show-environment AGENT_WINDOW_WORKSPACE failed for {name} "
                f"(exit {env_result.returncode}): {detail}"
            )
        if "=" not in line:
            return None
        return line.split("=", 1)[1].strip() or None

    return find_tmux_session_for_workspace(workspace, result.stdout.splitlines(), workspace_of)


def active_agents(runtime, *, subprocess_module=subprocess) -> list[str]:
    if not runtime.session_is_active:
        return []
    r = subprocess_module.run(
        [*runtime.tmux_prefix, "show-environment", "-t", runtime.tmux_session_name, "AGENT_WINDOW_AGENTS"],
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


def pane_id_for_agent(runtime, agent_name: str, *, subprocess_module=subprocess) -> str:
    pane_var = f"AGENT_WINDOW_PANE_{agent_name.upper().replace('-', '_')}"
    res = subprocess_module.run(
        [*runtime.tmux_prefix, "show-environment", "-t", runtime.tmux_session_name, pane_var],
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
