from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentDef:
    name: str
    display_name: str
    icon_file: str
    executable: str = ""
    launch_extra: str = ""
    launch_flags: str = ""
    launch_env: str = ""
    resume_flag: str = ""
    resume_extra_flags: str = ""
    ready_pattern: str = ""
    fallback_paths: tuple[str, ...] = ()
    prefer_fallback_paths: bool = False
    fallback_nvm: bool = False
    selectable: bool = True

    @property
    def exe(self) -> str:
        return self.executable or self.name


AGENTS: dict[str, AgentDef] = {}
AGENT_ICONS_DIR = "assets/icons/agents"

_AGENT_TMUX_COLOR_SUFFIX = "-u NO_COLOR -u CI FORCE_COLOR=1"


def _register(*defs: AgentDef) -> None:
    for d in defs:
        AGENTS[d.name] = d


_register(
    AgentDef(
        name="claude",
        display_name="Claude",
        icon_file="claude.svg",
        executable="claude",
        launch_extra=f"env -u CLAUDECODE {_AGENT_TMUX_COLOR_SUFFIX}",
        resume_flag="--continue",
        ready_pattern=r"Claude Code|Tips for getting started|Recent activity",
        fallback_paths=("~/.local/bin/claude",),
    ),
    AgentDef(
        name="codex",
        display_name="Codex",
        icon_file="codex.svg",
        executable="codex",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        resume_flag="resume --last",
        ready_pattern=r"OpenAI Codex|model:|Tip: New",
        fallback_nvm=True,
    ),
    AgentDef(
        name="gemini",
        display_name="Antigravity",
        icon_file="antigravity.svg",
        executable="agy",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        resume_flag="--continue",
        ready_pattern=r"Ready \(multiagent\)|Antigravity|Type your message",
        fallback_paths=("~/.local/bin/agy",),
        fallback_nvm=True,
    ),
    AgentDef(
        name="cursor",
        display_name="Cursor",
        icon_file="cursor.svg",
        executable="cursor-agent",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        resume_flag="--continue",
        ready_pattern=r"Cursor Agent|resume previous session|Output the version number|Bypassing Permissions",
        fallback_paths=("~/.local/bin/cursor-agent",),
    ),
    AgentDef(
        name="grok",
        display_name="Grok",
        icon_file="grok.svg",
        executable="grok",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        resume_flag="--continue",
        ready_pattern=r"Grok Build|What can I help|Type your message",
        fallback_paths=("~/.local/bin/grok",),
        prefer_fallback_paths=True,
    ),
)


ALL_AGENT_NAMES: list[str] = list(AGENTS.keys())
SELECTABLE_AGENT_NAMES: list[str] = [
    name for name, d in AGENTS.items() if d.selectable
]


def icon_file_map(repo_root: Path) -> dict[str, Path]:
    base = Path(repo_root).resolve() / AGENT_ICONS_DIR
    return {name: base / Path(a.icon_file).name for name, a in AGENTS.items()}


def generate_agent_message_selectors(suffix: str = "", prefix: str = "") -> str:
    return f"    {prefix}.message:not(.user):not(.system){suffix}"


def agent_names_js_set() -> str:
    items = ", ".join(f'"{n}"' for n in ALL_AGENT_NAMES)
    return f"new Set([{items}])"


def agent_names_js_array() -> str:
    items = ", ".join(f'"{n}"' for n in SELECTABLE_AGENT_NAMES)
    return f"[{items}]"
