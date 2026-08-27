from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from message_delivery.cli import _parse_agent_send_args, _usage_text
from message_delivery.send import AgentSendError, AgentSendRuntime


class _NameRuntime(AgentSendRuntime):
    def __init__(self, root: Path, *, source_session: str = "test-session") -> None:
        self.root = root
        super().__init__(
            env={
                "TMUX": "/tmp/test-tmux,1,0",
                "TMUX_PANE": "%2",
                "AGENT_WINDOW_SESSION": source_session,
            },
        )
        self.session_agents = {
            "test-session": ["claude", "codex"],
        }

    def resolve_session_name(self) -> str:
        return str(self.env.get("AGENT_WINDOW_SESSION") or "test-session")

    def tmux_env(self, key: str) -> str:
        if key == "AGENT_WINDOW_AGENTS":
            return ",".join(self.session_agents.get("test-session", []))
        if key.startswith("AGENT_WINDOW_PANE_"):
            requested = key.removeprefix("AGENT_WINDOW_PANE_").lower().replace("_", "-")
            for index, instance in enumerate(self.session_agents.get("test-session", []), start=1):
                if requested == instance:
                    return f"%{index}"
        return ""

    def send_to_pane(self, pane_id: str, payload: str) -> bool:
        del pane_id, payload
        return True

    def _mark_agent_running(self, _agent_name: str) -> bool:
        return True

    def resolve_session_log_path(self, session_name: str) -> Path:
        path = self.root / session_name / ".log.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)
        return path


class AgentNameTests(unittest.TestCase):
    def test_cli_subcommands_do_not_change_send_syntax(self) -> None:
        send = _parse_agent_send_args(["claude"])
        self.assertEqual((send.operation, send.target), ("send", "claude"))

        name = _parse_agent_send_args(["name", "claude", "Fable"])
        self.assertEqual(
            (name.operation, name.target, name.name),
            ("name", "claude", "Fable"),
        )
        self.assertEqual(_parse_agent_send_args(["names"]).operation, "names")
        self.assertEqual(_parse_agent_send_args(["unname", "Fable"]).operation, "unname")

    def test_numeric_provider_aliases_are_not_supported(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            runtime = _NameRuntime(Path(tmp))
            self.assertIsNone(runtime.resolve_agent_name("1"))
            with self.assertRaisesRegex(AgentSendError, "Agent instance not found: 1"):
                runtime.send_message(
                    target_spec="1",
                    payload="hello",
                )
        self.assertNotIn("1=claude", _usage_text())


if __name__ == "__main__":
    unittest.main()
