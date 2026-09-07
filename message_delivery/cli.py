from __future__ import annotations

import os
import sys
from dataclasses import dataclass

from backend_core.agents.registry import ALL_AGENT_NAMES
from message_delivery.send import AgentSendError, AgentSendRuntime


def _usage_text() -> str:
    return "\n".join(
        [
            "Usage: agent-send <target>",
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
            "  claude         (sends to ALL claude instances if duplicated)",
        ]
    )


@dataclass(frozen=True)
class ParsedAgentSendArgs:
    show_help: bool
    operation: str
    target: str = ""


def _parse_agent_send_args(argv: list[str]) -> ParsedAgentSendArgs:
    show_help = False
    idx = 0

    while idx < len(argv):
        token = argv[idx]
        if token in {"-h", "--help"}:
            show_help = True
            idx += 1
            continue
        if token == "--":
            idx += 1
            break
        break

    remaining = argv[idx:]
    if show_help and not remaining:
        return ParsedAgentSendArgs(True, "help")
    if not remaining:
        return ParsedAgentSendArgs(False, "send")

    target = remaining[0]
    extras = remaining[1:]
    if extras:
        raise AgentSendError(
            "agent-send: inline text arguments are no longer supported.\n\n"
            "Pass the message body on stdin instead.\n\n"
            "Examples:\n"
            "  printf '%s' 'hello' | agent-send claude"
        )
    return ParsedAgentSendArgs(show_help, "send", target)


def run(argv: list[str] | None = None) -> int:
    try:
        parsed = _parse_agent_send_args(list(sys.argv[1:] if argv is None else argv))
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if parsed.show_help:
        print(_usage_text())
        return 0

    if parsed.operation == "send" and not parsed.target:
        print(_usage_text(), file=sys.stderr)
        return 1

    try:
        runtime = AgentSendRuntime(env=dict(os.environ))
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

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
        success = runtime.send_message(
            target_spec=parsed.target,
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
