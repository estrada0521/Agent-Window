from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from message_delivery.cli import _parse_agent_send_args, _usage_text
from message_delivery.send import AgentSendError, AgentSendRuntime


class _NameRuntime(AgentSendRuntime):
    def __init__(self, root: Path, *, source_session: str = "test-session") -> None:
        super().__init__(
            repo_root=root,
            env={"AGENT_WINDOW_SESSION": source_session, "AGENT_WINDOW_AGENT_NAME": "codex"},
            cwd=root,
        )
        self.session_agents = {
            "test-session": ["claude", "codex"],
        }

    def resolve_session_name(self) -> str:
        return str(self.env.get("AGENT_WINDOW_SESSION") or "test-session")

    def tmux_env(self, session_name: str, key: str) -> str:
        if key == "AGENT_WINDOW_AGENTS":
            return ",".join(self.session_agents.get(session_name, []))
        if key.startswith("AGENT_WINDOW_PANE_"):
            requested = key.removeprefix("AGENT_WINDOW_PANE_").lower().replace("_", "-")
            for index, instance in enumerate(self.session_agents.get(session_name, []), start=1):
                if requested == instance:
                    return f"%{index}"
        return ""

    def current_pane_role(self, _session_name: str) -> str | None:
        return str(self.env.get("AGENT_WINDOW_AGENT_NAME") or "") or None

    def _session_attached_count(self, _session_name: str) -> int | None:
        return 1

    def send_to_pane(
        self,
        pane_id: str,
        payload: str,
        agent_name: str = "",
        *,
        session_name: str = "",
        session_attached_count: int | None = None,
    ) -> bool:
        del pane_id, payload, agent_name, session_name, session_attached_count
        return True

    def _mark_agent_running(self, _session_name: str, _agent_name: str) -> None:
        pass

    def resolve_session_log_path(self, session_name: str) -> Path:
        path = self.repo_root / session_name / ".log.jsonl"
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
            with self.assertRaisesRegex(AgentSendError, "Unknown target: 1"):
                runtime.send_message(
                    target_spec="1",
                    payload="hello",
                )
        self.assertNotIn("1=claude", _usage_text())


if __name__ == "__main__":
    unittest.main()
