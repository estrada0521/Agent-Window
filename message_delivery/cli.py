from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from pathlib import Path

from backend_core.agents.registry import ALL_AGENT_NAMES, number_alias_map
from message_delivery.send import AgentSendError, AgentSendRuntime


def _usage_text() -> str:
    aliases = number_alias_map()
    alias_line = "  " + "  ".join(f"{n}={aliases[n]}" for n in sorted(aliases))
    return "\n".join(
        [
            "Usage: agent-send [--session NAME] <target>",
            "",
            "Message body is read from stdin.",
            "",
            "Examples:",
            "  printf '%s' 'hello' | agent-send claude",
            "  agent-send name claude Fable",
            "  printf '%s' 'hello' | agent-send Fable",
            "",
            "Naming:",
            "  agent-send name <target> <name>",
            "  agent-send names",
            "  agent-send unname <target-or-name>",
            "",
            "Targets:",
            f"  {', '.join(ALL_AGENT_NAMES)} | others",
            alias_line,
            "  claude-1       (specific instance when duplicates exist)",
            "  claude,codex   (comma-separated targets)",
            "  claude         (sends to ALL claude instances if duplicated)",
        ]
    )


@dataclass(frozen=True)
class ParsedAgentSendArgs:
    show_help: bool
    session_name: str
    operation: str
    target: str = ""
    name: str = ""


def _parse_agent_send_args(argv: list[str]) -> ParsedAgentSendArgs:
    show_help = False
    session_name = (os.environ.get("MULTIAGENT_SESSION") or "").strip()
    idx = 0

    while idx < len(argv):
        token = argv[idx]
        if token in {"-h", "--help"}:
            show_help = True
            idx += 1
            continue
        if token == "--session":
            if idx + 1 >= len(argv):
                raise AgentSendError("agent-send: --session requires a value")
            session_name = argv[idx + 1]
            idx += 2
            continue
        if token == "--stdin":
            raise AgentSendError("agent-send: --stdin has been removed; stdin is now the default")
        if token == "--":
            idx += 1
            break
        break

    remaining = argv[idx:]
    if show_help and not remaining:
        return ParsedAgentSendArgs(True, session_name, "help")
    if not remaining:
        return ParsedAgentSendArgs(False, session_name, "send")

    operation = remaining[0].lower()
    if operation == "names":
        if len(remaining) != 1:
            raise AgentSendError("Usage: agent-send [--session NAME] names")
        return ParsedAgentSendArgs(show_help, session_name, "names")
    if operation == "name":
        if len(remaining) != 3:
            raise AgentSendError("Usage: agent-send [--session NAME] name <target> <name>")
        return ParsedAgentSendArgs(show_help, session_name, "name", remaining[1], remaining[2])
    if operation == "unname":
        if len(remaining) != 2:
            raise AgentSendError("Usage: agent-send [--session NAME] unname <target-or-name>")
        return ParsedAgentSendArgs(show_help, session_name, "unname", remaining[1])

    target = remaining[0]
    extras = remaining[1:]
    if extras:
        raise AgentSendError(
            "agent-send: inline text arguments are no longer supported.\n\n"
            "Pass the message body on stdin instead.\n\n"
            "Examples:\n"
            "  printf '%s' 'hello' | agent-send claude"
        )
    return ParsedAgentSendArgs(show_help, session_name, "send", target)


def run(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)

    bootstrap = argparse.ArgumentParser(add_help=False)
    bootstrap.add_argument("--repo-root", default="")
    bootstrap.add_argument("--script-dir", default="")
    known, remaining = bootstrap.parse_known_args(args)

    repo_root = Path(known.repo_root).resolve() if known.repo_root else Path(__file__).resolve().parents[2]
    script_dir = Path(known.script_dir).resolve() if known.script_dir else (repo_root / "bin")

    try:
        parsed = _parse_agent_send_args(remaining)
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    if parsed.show_help:
        print(_usage_text())
        return 0

    if parsed.operation == "send" and not parsed.target:
        print(_usage_text(), file=sys.stderr)
        return 1

    runtime = AgentSendRuntime(
        repo_root=repo_root,
        script_dir=script_dir,
        env=dict(os.environ),
        cwd=Path.cwd(),
    )

    try:
        session_name = runtime.resolve_session_name(parsed.session_name)
        if parsed.operation == "names":
            names = runtime.agent_names(session_name)
            if names:
                for canonical, display in names.items():
                    print(f"{canonical}: {display}")
            else:
                print(f"No agent names set for session: {session_name}")
            return 0
        if parsed.operation == "name":
            canonical, display = runtime.assign_agent_name(session_name, parsed.target, parsed.name)
            print(f"Named {canonical} {display}.")
            return 0
        if parsed.operation == "unname":
            canonical, display = runtime.clear_agent_name(session_name, parsed.target)
            print(f"Removed name {display} from {canonical}.")
            return 0
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
    if payload == "":
        print("agent-send: empty message body", file=sys.stderr)
        return 1
    if not payload:
        print("agent-send: empty message body", file=sys.stderr)
        return 1

    try:
        success = runtime.send_message(
            target_spec=parsed.target,
            payload=payload,
            explicit_session=parsed.session_name,
        )
    except AgentSendError as exc:
        print(str(exc), file=sys.stderr)
        return 1

    return 0 if success else 1


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
