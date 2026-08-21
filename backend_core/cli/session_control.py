from __future__ import annotations

import argparse
import json
import os
import sys

from backend_core.access.session_meta import find_session_for_workspace
from backend_core.tmux.control import (
    SessionControlError,
    add_agent,
    create_session,
    describe_session,
    kill_session,
    latest_session_name,
    list_sessions,
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


def format_session_line(info: dict) -> str:
    status = "active" if info["active"] else "archived"
    agents = ",".join(info.get("agents") or []) or "-"
    parts = [info["session"], f"status={status}", f"agents={agents}"]
    if info["active"]:
        parts.append(f"attached={info.get('attached', 0)}")
        parts.append(f"dead_panes={info.get('dead_panes', 0)}")
    if info.get("created_at"):
        parts.append(f"created={info['created_at']}")
    if info.get("updated_at"):
        parts.append(f"updated={info['updated_at']}")
    return "\t".join(parts)


def format_session_text(info: dict) -> str:
    lines = [f"Session: {info['session']}", f"Status: {'active' if info['active'] else 'archived'}"]
    if info.get("workspace"):
        lines.append(f"Workspace: {info['workspace']}")
    if info.get("created_at"):
        lines.append(f"Created: {info['created_at']}")
    if info.get("updated_at"):
        lines.append(f"Updated: {info['updated_at']}")
    agents = info.get("agents") or []
    lines.append(f"Agents: {', '.join(agents) if agents else '-'}")
    if info["active"]:
        lines.append(f"Windows: {info.get('window_count', 0)}")
        lines.append(f"Attached clients: {info.get('attached', 0)}")
        lines.append(f"Dead panes: {info.get('dead_panes', 0)}")
        panes = info.get("panes") or {}
        if panes:
            lines.append("Panes:")
            lines.extend(_format_panes(panes))
    return "\n".join(lines)


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
        lines.append(f"  ({note}; use `agent-window status --session '{info['session']}'`.)")
    lines.append("")
    lines.append("### Hints")
    lines.append(
        "- `agent-send` resolves its own session by workspace; targets come from "
        "AGENT_WINDOW_AGENTS and AGENT_WINDOW_PANE_* on the live tmux session."
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

    create = sub.add_parser("create")
    create.add_argument("--session", required=True)
    create.add_argument("--workspace", required=True)
    create.add_argument("--tmux-socket", default="")
    create.add_argument("--agents", default="")
    create.add_argument("--fresh", action="store_true")
    create.add_argument("--lifecycle", default="")

    kill_cmd = sub.add_parser("kill")
    kill_cmd.add_argument("--session", required=True)
    kill_cmd.add_argument("--tmux-socket", default="")

    add_cmd = sub.add_parser("add-agent")
    add_cmd.add_argument("--session", required=True)
    add_cmd.add_argument("--agent", required=True)
    add_cmd.add_argument("--tmux-socket", default="")

    remove_cmd = sub.add_parser("remove-agent")
    remove_cmd.add_argument("--session", required=True)
    remove_cmd.add_argument("--agent", required=True)
    remove_cmd.add_argument("--tmux-socket", default="")

    describe_cmd = sub.add_parser("describe")
    describe_cmd.add_argument("--session", required=True)
    describe_cmd.add_argument("--tmux-socket", default="")
    describe_cmd.add_argument("--json", action="store_true")

    list_cmd = sub.add_parser("list")
    list_cmd.add_argument("--tmux-socket", default="")
    list_cmd.add_argument("--all", action="store_true")
    list_cmd.add_argument("--verbose", action="store_true")
    list_cmd.add_argument("--json", action="store_true")

    latest_cmd = sub.add_parser("latest")

    current_cmd = sub.add_parser("current")
    current_cmd.add_argument("--workspace", default="")

    context_cmd = sub.add_parser("context")
    context_cmd.add_argument("--session", default="")
    context_cmd.add_argument("--workspace", default="")
    context_cmd.add_argument("--tmux-socket", default="")
    context_cmd.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    socket_name = _socket(getattr(args, "tmux_socket", ""))
    try:
        if args.cmd == "create":
            agents = [item.strip() for item in (args.agents or "").split(",") if item.strip() and item.strip() != "-"]
            create_session(
                session_name=args.session,
                workspace=args.workspace,
                agents=agents,
                tmux_socket=socket_name,
                fresh=bool(args.fresh),
                lifecycle_action=(args.lifecycle or "").strip() or None,
            )
            print(f"Started tmux session: {args.session}")
        elif args.cmd == "kill":
            kill_session(session_name=args.session, tmux_socket=socket_name)
            print(f"Killed tmux session: {args.session}")
        elif args.cmd == "add-agent":
            instance, rename = add_agent(session_name=args.session, agent=args.agent, tmux_socket=socket_name)
            if rename:
                print(f"Renamed {rename[0]} -> {rename[1]}")
            print(f"Added agent {instance} to session: {args.session}")
        elif args.cmd == "remove-agent":
            instance, scheduled = remove_agent(session_name=args.session, agent=args.agent, tmux_socket=socket_name)
            if scheduled:
                print(f"Scheduled removal of agent {instance} from session: {args.session}")
            else:
                print(f"Removed agent {instance} from session: {args.session}")
        elif args.cmd == "describe":
            info = describe_session(args.session, tmux_socket=socket_name)
            print(json.dumps(info, ensure_ascii=False) if args.json else format_session_text(info))
        elif args.cmd == "list":
            infos = list_sessions(tmux_socket=socket_name)
            if not args.all:
                infos = [item for item in infos if item["active"]]
            if args.json:
                print(json.dumps(infos, ensure_ascii=False))
            elif not infos:
                print("No sessions found for this agent-window install")
            elif args.verbose:
                print("\n\n".join(format_session_text(info) for info in infos))
            else:
                for info in infos:
                    print(format_session_line(info))
        elif args.cmd == "latest":
            name = latest_session_name()
            if not name:
                print("No agent-window sessions found", file=sys.stderr)
                return 1
            print(name)
        elif args.cmd == "current":
            workspace = (args.workspace or "").strip() or os.getcwd()
            resolved = find_session_for_workspace(workspace)
            if not resolved:
                print("No agent-window session found for this workspace.", file=sys.stderr)
                return 1
            print(resolved)
        elif args.cmd == "context":
            workspace_hint = (args.workspace or "").strip() or os.getcwd()
            session_name = (args.session or "").strip() or find_session_for_workspace(workspace_hint)
            if not session_name:
                print("No agent-window session found for this workspace; specify --session.", file=sys.stderr)
                return 1
            info = describe_session(session_name, tmux_socket=socket_name)
            print(json.dumps(info, ensure_ascii=False) if args.json else format_context_text(info))
    except SessionControlError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
