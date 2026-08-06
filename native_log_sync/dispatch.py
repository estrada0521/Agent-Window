from __future__ import annotations

from native_log_sync.agents.claude.read_updates import sync_claude_native_log
from native_log_sync.agents.codex.read_updates import sync_codex_native_log
from native_log_sync.agents.cursor.read_updates import sync_cursor_native_log
from native_log_sync.agents.gemini.read_updates import sync_gemini_native_log
from native_log_sync.agents.grok.read_updates import sync_grok_native_log


def sync_agent(runtime, agent: str, path: str | None = None) -> None:
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
