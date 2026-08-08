from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from native_log_sync.agents.claude.read_updates import sync_claude_native_log
from native_log_sync.agents.codex.read_updates import sync_codex_native_log


class _SyncRuntime:
    def __init__(self, root: Path) -> None:
        self._native_log_progress = {}
        self._native_log_current_paths = {}
        self.index_path = root / "agent-index.jsonl"
        self.session_name = "test-session"
        self.workspace = str(root)

    def save_sync_state(self) -> None:
        pass

    def _first_seen_for_agent(self, _agent: str) -> float:
        return 0

    def _mark_idle(self, _agent: str) -> None:
        pass

    def _mark_running_from_native_activity(self, _agent: str) -> None:
        pass

    def running_agents(self) -> set[str]:
        return set()

    def pane_id_for_agent(self, _agent: str) -> str:
        return ""

    def pane_field(self, _pane_id: str, _field: str) -> str:
        return ""


def _read_entries(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


class ProviderNoticeTests(unittest.TestCase):
    def test_claude_api_error_is_provider_notice(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            native_log = root / "claude.jsonl"
            native_log.write_text("", encoding="utf-8")
            runtime = _SyncRuntime(root)
            sync_claude_native_log(runtime, "claude", str(native_log))
            with native_log.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "assistant",
                            "uuid": "claude-notice",
                            "isApiErrorMessage": True,
                            "message": {"content": [{"type": "text", "text": "You've hit your session limit"}]},
                        }
                    )
                    + "\n"
                )
            sync_claude_native_log(runtime, "claude", str(native_log))
            entries = _read_entries(runtime.index_path)
            self.assertEqual(entries[0]["kind"], "provider-notice")
            self.assertEqual(entries[0]["message"], "You've hit your session limit")

    def test_codex_rate_limit_is_provider_notice(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            native_log = root / "codex.jsonl"
            native_log.write_text("", encoding="utf-8")
            runtime = _SyncRuntime(root)
            sync_codex_native_log(runtime, "codex", str(native_log))
            with native_log.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "event_msg",
                            "timestamp": "2026-08-02T00:00:00Z",
                            "payload": {
                                "type": "token_count",
                                "rate_limits": {"rate_limit_reached_type": "primary"},
                            },
                        }
                    )
                    + "\n"
                )
            sync_codex_native_log(runtime, "codex", str(native_log))
            self.assertEqual(_read_entries(runtime.index_path)[0]["kind"], "provider-notice")


if __name__ == "__main__":
    unittest.main()
