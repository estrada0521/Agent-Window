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
    mobile_only: bool = False
    # When set, selecting the command inserts this text into the composer
    # (like an @-mention) instead of POSTing to a backend route -- for
    # referencing files @-search can't reach, such as dotfiles.
    insert: str = ""


PANE_KEY_COMMAND_IDS = frozenset({"up", "down", "left", "right", "enter", "esc", "ctrlc"})
PANE_TEXT_MACROS = ("/model", "/usage", "/permission")

PANE_CONTROL_COMMANDS = (
    SlashCommandSpec(
        id="restart", slash="/restart", desc="Restart the agent", has_arg=False, path="/shortcut-command",
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

# The terminal window sits outside the agent topology (see
# backend_core/tmux/session.py), so it gets its own spec rather than
# joining PANE_CONTROL_COMMANDS -- that tuple also feeds
# PANE_SINGLE_CONTROL_MESSAGES below, and "terminal" is not a single
# fixed control message the way restart/esc/ctrlc/enter are.
TERMINAL_INPUT_COMMAND = SlashCommandSpec(
    id="terminal", slash="/terminal", desc="Type into the terminal pane",
    has_arg=True, path="/shortcut-command", mobile_only=True,
)

SLASH_COMMANDS = PANE_CONTROL_COMMANDS + APPLICATION_COMMANDS + (TERMINAL_INPUT_COMMAND,)
PANE_CONTROL_COMMAND_IDS = (
    PANE_KEY_COMMAND_IDS
    | frozenset(PANE_TEXT_MACROS)
    | frozenset(command.id for command in PANE_CONTROL_COMMANDS)
    | {TERMINAL_INPUT_COMMAND.id}
)


def public_slash_command_dicts() -> list[dict[str, str | bool]]:
    return [
        {
            "id": c.id,
            "slash": c.slash,
            "desc": c.desc,
            "has_arg": c.has_arg,
            "path": c.path,
            "desktop_only": c.desktop_only,
            "mobile_only": c.mobile_only,
            "insert": c.insert,
        }
        for c in SLASH_COMMANDS
    ]


PANE_SINGLE_CONTROL_MESSAGES = frozenset({"esc", "ctrlc", "enter"}) | frozenset(
    command.id for command in PANE_CONTROL_COMMANDS
)
