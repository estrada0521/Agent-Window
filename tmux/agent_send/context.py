from __future__ import annotations

import os
import subprocess

from fs.log.meta import read_log_meta
from tmux import TMUX
from tmux.session import agent_topology, find_session_for_workspace


def _run(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run([*TMUX, *args], capture_output=True, text=True, check=False)


def _pane_status(pane_id: str) -> dict:
    title = _run(["display-message", "-p", "-t", pane_id, "#{pane_title}"]).stdout.strip()
    command = _run(["display-message", "-p", "-t", pane_id, "#{pane_current_command}"]).stdout.strip()
    dead = _run(["display-message", "-p", "-t", pane_id, "#{pane_dead}"]).stdout.strip() == "1"
    return {"pane_id": pane_id, "title": title, "command": command, "dead": dead}


def describe_timeline(timeline_name: str) -> dict:
    meta = read_log_meta(timeline_name)
    workspace = meta["workspace"]
    info: dict = {
        "timeline": timeline_name,
        "workspace": workspace,
        "agents": meta["agents"],
        "active": False,
    }
    tmux_name = find_session_for_workspace(workspace)
    if not tmux_name:
        return info

    attached = _run(["display-message", "-p", "-t", tmux_name, "#{session_attached}"]).stdout.strip()
    created_epoch = _run(["display-message", "-p", "-t", tmux_name, "#{session_created}"]).stdout.strip()
    window_count = len(_run(["list-windows", "-t", tmux_name, "-F", "#{window_id}"]).stdout.splitlines())
    dead_panes = sum(
        1
        for line in _run(["list-panes", "-s", "-t", tmux_name, "-F", "#{pane_dead}"]).stdout.splitlines()
        if line.strip() == "1"
    )
    topology = agent_topology(tmux_name)
    agents = [pane.name for pane in topology]
    current_pane = os.environ.get("TMUX_PANE") or ""
    this_pane_role = None
    panes: dict[str, dict | None] = {}
    for pane in topology:
        panes[pane.name] = _pane_status(pane.pane_id)
        if current_pane and pane.pane_id == current_pane:
            this_pane_role = pane.name

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


def _format_panes(panes: dict) -> list[str]:
    lines = []
    for instance, pane in panes.items():
        if not pane:
            lines.append(f"  - {instance}: not configured")
        elif pane["dead"]:
            lines.append(f"  - {instance}: pane={pane['pane_id']} dead title={pane['title'] or 'unknown'}")
        else:
            lines.append(
                f"  - {instance}: pane={pane['pane_id']} running "
                f"cmd={pane['command'] or 'unknown'} title={pane['title'] or 'unknown'}"
            )
    return lines


def format_context_text(info: dict) -> str:
    lines = ["## agent-send --context", ""]
    lines.append(f"- **timeline**: {info['timeline']}")
    lines.append(f"- **status**: {'active' if info['active'] else 'archived'}")
    if info.get("workspace"):
        lines.append(f"- **workspace**: {info['workspace']}")
    if info.get("tmux_name"):
        lines.append(f"- **tmux session**: {info['tmux_name']}")
    agents = info["agents"]
    lines.append(f"- **agents**: {', '.join(agents) if agents else '<none>'}")
    if info.get("this_pane_role"):
        lines.append(f"- **this pane's agent instance**: {info['this_pane_role']}")
    lines.append("")
    lines.append("### Agent panes")
    panes = info.get("panes") or {}
    if panes:
        lines.extend(_format_panes(panes))
    else:
        note = "not currently active" if not info["active"] else "active with no agents"
        lines.append(f"  ({note})")
    lines.append("")
    lines.append("### Hints")
    lines.append(
        "- `agent-send` uses this pane's tmux session directly; targets are the "
        "session's agent windows."
    )
    workspace = info["workspace"]
    lines.append(
        f"- The timeline's log lives at `~/.agent-window/log/{info['timeline']}/.log.jsonl`; "
        f"workspace mirror is `{workspace}/.agent-window/.log.jsonl`."
    )
    return "\n".join(lines)
