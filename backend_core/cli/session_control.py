from __future__ import annotations

import argparse
import json
import os
import sys

from backend_core.access.session_meta import SessionMetaError, find_session_for_workspace
from backend_core.tmux.control import (
    SessionControlError,
    describe_session,
    remove_agent,
)
from backend_core.tmux.topology import default_tmux_socket_name


def _socket(value: str) -> str:
    return (value or "").strip() or os.environ.get("AGENT_WINDOW_TMUX_SOCKET", "") or default_tmux_socket_name()


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
    lines = ["## agent-window context", ""]
    lines.append(f"- **session**: {info['session']}")
    lines.append(f"- **status**: {'active' if info['active'] else 'archived'}")
    if info.get("workspace"):
        lines.append(f"- **workspace**: {info['workspace']}")
    if info.get("tmux_name"):
        lines.append(f"- **tmux session**: {info['tmux_name']}")
    agents = info.get("agents") or []
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
        "- `agent-send` uses this pane's tmux session directly; targets come from "
        "its AGENT_WINDOW_AGENTS and AGENT_WINDOW_PANE_* values."
    )
    workspace = info.get("workspace") or "<workspace>"
    lines.append(
        f"- Chat jsonl lives at `~/.agent-window/session/{info['session']}/.log.jsonl`; "
        f"workspace mirror is `{workspace}/.agent-window/.log.jsonl`."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="session_control")
    sub = parser.add_subparsers(dest="cmd", required=True)

    remove_cmd = sub.add_parser("remove-agent")
    remove_cmd.add_argument("--session", required=True)
    remove_cmd.add_argument("--agent", required=True)
    remove_cmd.add_argument("--tmux-socket", default="")

    context_cmd = sub.add_parser("context")
    context_cmd.add_argument("--session", default="")
    context_cmd.add_argument("--workspace", default="")
    context_cmd.add_argument("--tmux-socket", default="")
    context_cmd.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    socket_name = _socket(getattr(args, "tmux_socket", ""))
    try:
        if args.cmd == "remove-agent":
            instance, scheduled = remove_agent(session_name=args.session, agent=args.agent, tmux_socket=socket_name)
            if scheduled:
                print(f"Scheduled removal of agent {instance} from session: {args.session}")
            else:
                print(f"Removed agent {instance} from session: {args.session}")
        elif args.cmd == "context":
            workspace_hint = (args.workspace or "").strip() or os.getcwd()
            session_name = (args.session or "").strip() or find_session_for_workspace(workspace_hint)
            if not session_name:
                print("No agent-window session found for this workspace; specify --session.", file=sys.stderr)
                return 1
            info = describe_session(session_name, tmux_socket=socket_name)
            print(json.dumps(info, ensure_ascii=False) if args.json else format_context_text(info))
    except (SessionControlError, SessionMetaError) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
