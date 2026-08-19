from __future__ import annotations

import argparse
import os
import sys

from backend_core.tmux.control import (
    SessionControlError,
    add_agent,
    create_session,
    kill_session,
    remove_agent,
)
from backend_core.tmux.topology import default_tmux_socket_name


def _socket(value: str) -> str:
    return (value or "").strip() or os.environ.get("AGENT_WINDOW_TMUX_SOCKET", "") or default_tmux_socket_name()


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

    args = parser.parse_args(argv)
    socket_name = _socket(args.tmux_socket)
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
    except SessionControlError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
