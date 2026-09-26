from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AgentDef:
    name: str
    display_name: str
    executable: str = ""
    launch_extra: str = ""
    launch_flags: str = ""
    launch_env: str = ""
    fallback_paths: tuple[str, ...] = ()
    prefer_fallback_paths: bool = False
    fallback_nvm: bool = False

    @property
    def exe(self) -> str:
        return self.executable or self.name


AGENTS: dict[str, AgentDef] = {}

_AGENT_TMUX_COLOR_SUFFIX = "-u NO_COLOR -u CI FORCE_COLOR=1"


def _register(*defs: AgentDef) -> None:
    for d in defs:
        AGENTS[d.name] = d


_register(
    AgentDef(
        name="claude",
        display_name="Claude",
        executable="claude",
        launch_extra=f"env -u CLAUDECODE {_AGENT_TMUX_COLOR_SUFFIX}",
        fallback_paths=("~/.local/bin/claude",),
    ),
    AgentDef(
        name="codex",
        display_name="Codex",
        executable="codex",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        fallback_nvm=True,
    ),
    AgentDef(
        name="gemini",
        display_name="Antigravity",
        executable="agy",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        fallback_paths=("~/.local/bin/agy",),
        fallback_nvm=True,
    ),
    AgentDef(
        name="cursor",
        display_name="Cursor",
        executable="cursor-agent",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        fallback_paths=("~/.local/bin/cursor-agent",),
    ),
    AgentDef(
        name="grok",
        display_name="Grok",
        executable="grok",
        launch_extra=f"env {_AGENT_TMUX_COLOR_SUFFIX}",
        fallback_paths=("~/.local/bin/grok",),
        prefer_fallback_paths=True,
    ),
)


ALL_AGENT_NAMES: list[str] = list(AGENTS.keys())


def icon_file_map() -> dict[str, Path]:
    return {name: Path(__file__).resolve().parent / name / "icon.svg" for name in AGENTS}


def agent_names_js_set() -> str:
    items = ", ".join(f'"{n}"' for n in ALL_AGENT_NAMES)
    return f"new Set([{items}])"


def agent_names_js_array() -> str:
    items = ", ".join(f'"{n}"' for n in ALL_AGENT_NAMES)
    return f"[{items}]"
