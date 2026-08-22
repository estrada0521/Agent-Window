from __future__ import annotations

from backend_core.agents.names import agent_base_name
from native_log_sync.agents.claude.read_updates import sync_claude_native_log
from native_log_sync.agents.codex.read_updates import sync_codex_native_log
from native_log_sync.agents.cursor.read_updates import sync_cursor_native_log
from native_log_sync.agents.gemini.read_updates import sync_gemini_native_log
from native_log_sync.agents.grok.read_updates import sync_grok_native_log

_SYNC_BY_BASE = {
    "claude": sync_claude_native_log,
    "codex": sync_codex_native_log,
    "cursor": sync_cursor_native_log,
    "gemini": sync_gemini_native_log,
    "grok": sync_grok_native_log,
}


def sync_agent(runtime, agent: str, path: str | None = None) -> None:
    # Serialize concurrent callers (the kqueue watcher thread and refresh()
    # triggers like first-message/reload can both target the same agent) so
    # two syncs never read the same progress offset and double-append.
    with runtime._native_log_sync_lock:
        base = agent_base_name(agent)
        sync_fn = _SYNC_BY_BASE.get(base)
        if sync_fn is None:
            raise ValueError(f"unknown agent type: {agent}")
        sync_fn(runtime, agent, path)
