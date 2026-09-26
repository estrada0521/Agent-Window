from __future__ import annotations

from agents import agent_base_name
from agents.claude.read_updates import sync_claude_native_log
from agents.codex.read_updates import sync_codex_native_log
from agents.cursor.read_updates import sync_cursor_native_log
from agents.gemini.read_updates import sync_gemini_native_log
from agents.grok.read_updates import sync_grok_native_log

_SYNC_BY_BASE = {
    "claude": sync_claude_native_log,
    "codex": sync_codex_native_log,
    "cursor": sync_cursor_native_log,
    "gemini": sync_gemini_native_log,
    "grok": sync_grok_native_log,
}


def sync_agent(
    state,
    agent: str,
    path: str | None = None,
    *,
    start_at_end: bool = False,
) -> None:
    with state._native_log_sync_lock:
        base = agent_base_name(agent)
        sync_fn = _SYNC_BY_BASE.get(base)
        if sync_fn is None:
            raise ValueError(f"unknown agent type: {agent}")
        sync_fn(state, agent, path, start_at_end=start_at_end)
