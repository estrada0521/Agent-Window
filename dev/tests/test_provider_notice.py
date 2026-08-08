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
    if not path.exists():
        return []
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
        # Codex reports a failed turn via `error` on the task_complete event_msg,
        # not as a separate `error` event_msg. usage_limit_exceeded carries an
        # already human-readable message.
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
                                "type": "task_complete",
                                "turn_id": "t1",
                                "last_agent_message": None,
                                "error": {
                                    "message": "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits.",
                                    "codex_error_info": "usage_limit_exceeded",
                                },
                            },
                        }
                    )
                    + "\n"
                )
            sync_codex_native_log(runtime, "codex", str(native_log))
            entries = _read_entries(runtime.index_path)
            self.assertEqual(entries[0]["kind"], "provider-notice")
            self.assertIn("usage limit", entries[0]["message"])

    def test_codex_task_complete_without_error_is_not_a_message(self) -> None:
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
                            "payload": {"type": "task_complete", "turn_id": "t1", "error": None},
                        }
                    )
                    + "\n"
                )
            sync_codex_native_log(runtime, "codex", str(native_log))
            self.assertEqual(_read_entries(runtime.index_path), [])

    def test_codex_unsupported_model_error_unwraps_inner_message(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            native_log = root / "codex.jsonl"
            native_log.write_text("", encoding="utf-8")
            runtime = _SyncRuntime(root)
            sync_codex_native_log(runtime, "codex", str(native_log))
            raw_api_error = json.dumps(
                {
                    "type": "error",
                    "status": 400,
                    "error": {
                        "type": "invalid_request_error",
                        "message": "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.",
                    },
                }
            )
            with native_log.open("a", encoding="utf-8") as handle:
                handle.write(
                    json.dumps(
                        {
                            "type": "event_msg",
                            "timestamp": "2026-08-07T14:47:04.407Z",
                            "payload": {
                                "type": "task_complete",
                                "turn_id": "t2",
                                "error": {"message": raw_api_error, "codex_error_info": "other"},
                            },
                        }
                    )
                    + "\n"
                )
            sync_codex_native_log(runtime, "codex", str(native_log))
            entries = _read_entries(runtime.index_path)
            self.assertEqual(entries[0]["kind"], "provider-notice")
            self.assertEqual(
                entries[0]["message"],
                "The 'gpt-5.6-sol' model is not supported when using Codex with a ChatGPT account.",
            )


if __name__ == "__main__":
    unittest.main()
