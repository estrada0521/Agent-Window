from __future__ import annotations

import os
import sys

from agents.registry import ALL_AGENT_NAMES
from tmux.agent_send.context import describe_timeline, format_context_text
from tmux.agent_send.send import AgentSendError, AgentSender


def _usage_text() -> str:
    return "\n".join(
        [
            "Usage: agent-send <target>",
            "       agent-send --context",
            "",
            "Message body is read from stdin.",
            "",
            "Examples:",
            "  printf '%s' 'hello' | agent-send claude",
            "",
            "Targets:",
            f"  {', '.join(ALL_AGENT_NAMES)} | others",
            "  claude-1       (specific instance when duplicates exist)",
            "  claude,codex   (comma-separated targets)",
            "  claude         (ambiguous when duplicates exist; use claude-1)",
            "",
            "--context prints the current timeline, its workspace and agent panes.",
        ]
    )


def run(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if args in (["-h"], ["--help"]):
        print(_usage_text())
        return 0
    if len(args) != 1:
        print(_usage_text(), file=sys.stderr)
        return 1

    try:
        sender = AgentSender(env=dict(os.environ))
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if args[0] == "--context":
        try:
            timeline_name = sender.resolve_timeline_name()
        except AgentSendError as exc:
            print(str(exc), file=sys.stderr)
            return 1
        print(format_context_text(describe_timeline(timeline_name)))
        return 0

    if sys.stdin.isatty():
        print(
            "agent-send requires a message body on stdin.\n\n"
            "Examples:\n"
            "  printf '%s' 'hello' | agent-send claude",
            file=sys.stderr,
        )
        return 1

    payload = sys.stdin.read()
    if not payload:
        print("agent-send: empty message body", file=sys.stderr)
        return 1

    try:
        success = sender.send_message(
            target_spec=args[0],
            payload=payload,
        )
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    return 0 if success else 1


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
