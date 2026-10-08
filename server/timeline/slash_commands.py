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
    insert: str = ""


SLASH_COMMANDS = (
    SlashCommandSpec(id="search", slash="/search", desc="Search timeline", has_arg=False, path="", mobile_only=True),
    SlashCommandSpec(id="jump", slash="/jump", desc="Jump to date: YYYY-MM[-DD [HH:MM]]", has_arg=True, path=""),
    SlashCommandSpec(id="restart", slash="/restart", desc="Restart agent pane", has_arg=False, path="/restart-agent"),
    SlashCommandSpec(id="idle", slash="/idle", desc="Show as idle (display only)", has_arg=False, path="/mark-idle"),
    SlashCommandSpec(
        id="nativelog", slash="/nativelog", desc="Reveal native log in Finder",
        has_arg=False, path="/native-log", desktop_only=True,
    ),
    SlashCommandSpec(
        id="openpane", slash="/openpane", desc="Open agent pane",
        has_arg=False, path="/open-pane", desktop_only=True,
    ),
    SlashCommandSpec(
        id="log", slash="/log", desc="Insert timeline log path",
        has_arg=False, path="", insert="`.agent-window/.log.jsonl`",
    ),
    SlashCommandSpec(
        id="skill", slash="/skill", desc="Insert agent-send skill reference",
        has_arg=False, path="", insert="`agent-send` SKILL",
    ),
    SlashCommandSpec(
        id="terminal", slash="/terminal", desc="Enter terminal mode",
        has_arg=True, path="/key-macro", mobile_only=True,
    ),
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
