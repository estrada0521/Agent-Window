from __future__ import annotations

from native_log_sync.agents.claude.read_updates import sync_claude_native_log
from native_log_sync.agents.codex.read_updates import sync_codex_native_log
from native_log_sync.agents.cursor.read_updates import sync_cursor_native_log
from native_log_sync.agents.gemini.read_updates import sync_gemini_native_log
from native_log_sync.agents.grok.read_updates import sync_grok_native_log


def sync_agent(runtime, agent: str, path: str | None = None) -> None:
    # Serialize concurrent callers (the kqueue watcher thread and refresh()
    # triggers like first-message/reload can both target the same agent) so
    # two syncs never read the same progress offset and double-append.
    with runtime._native_log_sync_lock:
        base = str(agent or "").split("-", 1)[0].lower()
        if base == "claude":
            sync_claude_native_log(runtime, agent, path)
        elif base == "codex":
            sync_codex_native_log(runtime, agent, path)
        elif base == "cursor":
            sync_cursor_native_log(runtime, agent, path)
        elif base == "gemini":
            sync_gemini_native_log(runtime, agent, path)
        elif base == "grok":
            sync_grok_native_log(runtime, agent, path)
