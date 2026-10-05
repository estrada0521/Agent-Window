from __future__ import annotations


from tmux import run_tmux
from tmux.process_cleanup import cleanup_target_process_groups


def window_target_for_pane(*, pane_id: str) -> str:
    pane = (pane_id or "").strip()
    if not pane:
        return ""
    res = run_tmux(["display-message", "-p", "-t", pane, "#{window_id}"])
    if res.returncode != 0:
        return ""
    return (res.stdout or "").strip()


def configure_window_size(*, target: str, width: int) -> None:
    target_name = (target or "").strip()
    if not target_name:
        return
    run_tmux(["resize-window", "-t", target_name, "-x", str(width)])


def create_agent_window(
    *,
    session: str,
    instance_name: str,
    workspace: str,
    width: int,
) -> str:
    res = run_tmux(["new-window", "-d", "-P", "-F", "#{pane_id}", "-t", f"{session}:", "-n", instance_name, "-c", workspace])
    if res.returncode != 0:
        return ""
    pane_id = (res.stdout or "").strip()
    if not pane_id:
        return ""
    window_target = window_target_for_pane(pane_id=pane_id)
    configure_window_size(
        target=window_target or pane_id,
        width=width,
    )
    return pane_id


def kill_window_target(*, window_target: str) -> bool:
    target = (window_target or "").strip()
    if not target:
        return False
    cleanup_target_process_groups(target=target)
    res = run_tmux(["kill-window", "-t", target])
    return res.returncode == 0
