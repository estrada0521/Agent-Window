from __future__ import annotations

import argparse
import json
import os
import sys

from fs.session.meta import find_session_for_workspace
from tmux.control import SessionControlError, describe_session


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
        f"- Room jsonl lives at `~/.agent-window/session/{info['session']}/.log.jsonl`; "
        f"workspace mirror is `{workspace}/.agent-window/.log.jsonl`."
    )
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="agent-window context")
    sub = parser.add_subparsers(dest="cmd", required=True)

    context_cmd = sub.add_parser("context")
    context_cmd.add_argument("--session", default="")
    context_cmd.add_argument("--workspace", default="")
    context_cmd.add_argument("--json", action="store_true")

    args = parser.parse_args(argv)
    try:
        if args.cmd == "context":
            workspace_hint = (args.workspace or "").strip() or os.getcwd()
            session_name = (args.session or "").strip() or find_session_for_workspace(workspace_hint)
            if not session_name:
                print("No agent-window session found for this workspace; specify --session.", file=sys.stderr)
                return 1
            info = describe_session(session_name)
            print(json.dumps(info, ensure_ascii=False) if args.json else format_context_text(info))
    except SessionControlError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
