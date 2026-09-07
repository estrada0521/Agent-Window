from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SlashCommandSpec:
    id: str
    slash: str
    desc: str
    has_arg: bool
    path: str
    desktop_only: bool = False
    # When set, selecting the command inserts this text into the composer
    # (like an @-mention) instead of POSTing to a backend route -- for
    # referencing files @-search can't reach, such as dotfiles.
    insert: str = ""


PANE_CONTROL_COMMANDS = (
    SlashCommandSpec(
        id="up", slash="/up", desc="Send Up to the selected pane", has_arg=True, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="down", slash="/down", desc="Send Down to the selected pane", has_arg=True, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="left", slash="/left", desc="Send Left to the selected pane", has_arg=True, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="right", slash="/right", desc="Send Right to the selected pane", has_arg=True, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="restart", slash="/restart", desc="Restart the agent", has_arg=False, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="resume", slash="/resume", desc="Resume the agent", has_arg=False, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="ctrlc", slash="/ctrlc", desc="Send Ctrl+C to the agent", has_arg=False, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="esc", slash="/esc", desc="Send Esc to the agent", has_arg=False, path="/shortcut-command",
    ),
    SlashCommandSpec(
        id="enter", slash="/enter", desc="Send Enter to the agent", has_arg=False, path="/shortcut-command",
    ),
)

APPLICATION_COMMANDS = (
    SlashCommandSpec(
        id="nativelog", slash="/nativelog", desc="Reveal the agent's native log in Finder",
        has_arg=False, path="/native-log", desktop_only=True,
    ),
    SlashCommandSpec(
        id="openpane", slash="/open-pane", desc="Open the agent's tmux pane",
        has_arg=False, path="/open-pane", desktop_only=True,
    ),
    SlashCommandSpec(
        id="log", slash="/log", desc="Insert `.agent-window/.log.jsonl`",
        has_arg=False, path="", insert="`.agent-window/.log.jsonl`",
    ),
)

SLASH_COMMANDS = PANE_CONTROL_COMMANDS + APPLICATION_COMMANDS
PANE_CONTROL_BY_ID = {command.id: command for command in PANE_CONTROL_COMMANDS}


def pane_control_by_id(command_id: str) -> SlashCommandSpec | None:
    return PANE_CONTROL_BY_ID.get((command_id or "").strip().lower())


def public_slash_command_dicts() -> list[dict[str, str | bool]]:
    return [
        {
            "id": c.id,
            "slash": c.slash,
            "desc": c.desc,
            "has_arg": c.has_arg,
            "path": c.path,
            "desktop_only": c.desktop_only,
            "insert": c.insert,
        }
        for c in SLASH_COMMANDS
    ]


PANE_SINGLE_CONTROL_MESSAGES = frozenset(
    {"esc", "ctrlc", "enter", "restart", "resume"},
)
