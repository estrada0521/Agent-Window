from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bin.multiagent_lib.state import write_session_meta_file
from message_delivery.cli import _parse_agent_send_args
from message_delivery.send import AgentSendError, AgentSendRuntime


class _NameRuntime(AgentSendRuntime):
    def __init__(self, root: Path, *, source_session: str = "test-session") -> None:
        super().__init__(
            repo_root=root,
            script_dir=root / "bin",
            env={"MULTIAGENT_SESSION": source_session, "MULTIAGENT_AGENT_NAME": "codex"},
            cwd=root,
        )
        self.root = root
        self.sent: list[tuple[str, str, str]] = []
        self.session_agents = {
            "test-session": ["claude", "codex"],
            "other-session": ["claude", "gemini"],
        }

    def resolve_session_name(self, explicit_session: str = "") -> str:
        return explicit_session or str(self.env.get("MULTIAGENT_SESSION") or "test-session")

    def tmux_env(self, session_name: str, key: str) -> str:
        if key == "MULTIAGENT_AGENTS":
            return ",".join(self.session_agents.get(session_name, []))
        if key.startswith("MULTIAGENT_PANE_"):
            requested = key.removeprefix("MULTIAGENT_PANE_").lower().replace("_", "-")
            for index, instance in enumerate(self.session_agents.get(session_name, []), start=1):
                if requested == instance:
                    return f"%{index}"
        return ""

    def current_pane_role(self, _session_name: str) -> str | None:
        return str(self.env.get("MULTIAGENT_AGENT_NAME") or "") or None

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
        del session_name, session_attached_count
        self.sent.append((pane_id, payload, agent_name))
        return True

    def _mark_agent_running(self, _session_name: str, _agent_name: str) -> None:
        pass

    def resolve_session_index_path(self, session_name: str) -> Path:
        path = self.root / session_name / ".log.jsonl"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.touch(exist_ok=True)
        return path


class AgentNameTests(unittest.TestCase):
    def _session_log_path(self, root: Path):
        return lambda session_name: root / session_name / ".log.jsonl"

    def test_cli_subcommands_do_not_change_send_syntax(self) -> None:
        send = _parse_agent_send_args(["claude"])
        self.assertEqual((send.operation, send.target), ("send", "claude"))

        name = _parse_agent_send_args(["--session", "demo", "name", "claude", "Fable"])
        self.assertEqual(
            (name.operation, name.session_name, name.target, name.name),
            ("name", "demo", "claude", "Fable"),
        )
        self.assertEqual(_parse_agent_send_args(["names"]).operation, "names")
        self.assertEqual(_parse_agent_send_args(["unname", "Fable"]).operation, "unname")

    def test_alias_is_only_used_for_address_and_from_prefix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = _NameRuntime(root)
            with patch("message_delivery.names.session_log_path", self._session_log_path(root)):
                self.assertEqual(runtime.assign_agent_name("test-session", "claude", "Fable"), ("claude", "Fable"))
                self.assertEqual(runtime.assign_agent_name("test-session", "codex", "Sage"), ("codex", "Sage"))
                self.assertTrue(
                    runtime.send_message(
                        target_spec="Fable",
                        payload="hello",
                        explicit_session="test-session",
                    )
                )

            self.assertEqual(runtime.sent, [("%1", "[From: Sage]\nhello\n", "claude")])
            entry = json.loads((root / "test-session" / ".log.jsonl").read_text(encoding="utf-8"))
            self.assertEqual(entry["sender"], "codex")
            self.assertEqual(entry["targets"], ["claude"])
            self.assertEqual(entry["message"], "[From: Sage]\nhello\n")

    def test_cross_session_uses_target_name_and_source_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = _NameRuntime(root)
            with patch("message_delivery.names.session_log_path", self._session_log_path(root)):
                runtime.assign_agent_name("test-session", "codex", "Sage")
                runtime.assign_agent_name("other-session", "claude", "Fable")
                runtime.send_message(
                    target_spec="Fable",
                    payload="hello",
                    explicit_session="other-session",
                )
            self.assertEqual(runtime.sent, [("%1", "[From: Sage]\nhello\n", "claude")])

    def test_duplicate_base_must_be_named_by_exact_instance(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = _NameRuntime(root)
            runtime.session_agents["test-session"] = ["claude-1", "claude-2", "codex"]
            with patch("message_delivery.names.session_log_path", self._session_log_path(root)):
                with self.assertRaisesRegex(AgentSendError, "ambiguous"):
                    runtime.assign_agent_name("test-session", "claude", "Fable")
                self.assertEqual(
                    runtime.assign_agent_name("test-session", "claude-2", "Fable"),
                    ("claude-2", "Fable"),
                )

    def test_existing_base_target_still_broadcasts_after_naming(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = _NameRuntime(root)
            runtime.session_agents["test-session"] = ["claude-1", "claude-2", "codex"]
            with patch("message_delivery.names.session_log_path", self._session_log_path(root)):
                runtime.assign_agent_name("test-session", "claude-1", "Fable")
                runtime.send_message(
                    target_spec="claude",
                    payload="hello",
                    explicit_session="test-session",
                )
            self.assertEqual(
                [(pane, agent) for pane, _payload, agent in runtime.sent],
                [("%1", "claude-1"), ("%2", "claude-2")],
            )

    def test_names_cannot_collide_with_targets_or_other_names(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            runtime = _NameRuntime(root)
            with patch("message_delivery.names.session_log_path", self._session_log_path(root)):
                with self.assertRaisesRegex(AgentSendError, "existing target"):
                    runtime.assign_agent_name("test-session", "claude", "codex")
                with self.assertRaisesRegex(AgentSendError, "cannot contain"):
                    runtime.assign_agent_name("test-session", "claude", "Bad]Name")
                with self.assertRaisesRegex(AgentSendError, "cannot start"):
                    runtime.assign_agent_name("test-session", "claude", "--Fable")
                runtime.assign_agent_name("test-session", "claude", "Fable")
                with self.assertRaisesRegex(AgentSendError, "already in use"):
                    runtime.assign_agent_name("test-session", "codex", "fable")
                self.assertEqual(runtime.clear_agent_name("test-session", "Fable"), ("claude", "Fable"))

    def test_topology_metadata_moves_then_removes_name(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            index_path = root / ".log.jsonl"
            meta_path = root / ".meta"
            meta_path.write_text(
                json.dumps(
                    {
                        "session": "demo",
                        "agents": ["claude", "codex"],
                        "agent_names": {"claude": "Fable"},
                    }
                ),
                encoding="utf-8",
            )
            env_output = f"MULTIAGENT_INDEX_PATH={index_path}\nMULTIAGENT_WORKSPACE={root}\n"
            write_session_meta_file("demo", "claude-1,claude-2,codex", env_output)
            renamed = json.loads(meta_path.read_text(encoding="utf-8"))
            self.assertEqual(renamed["agent_names"], {"claude-1": "Fable"})

            write_session_meta_file("demo", "claude-2,codex", env_output)
            removed = json.loads(meta_path.read_text(encoding="utf-8"))
            self.assertNotIn("agent_names", removed)


if __name__ == "__main__":
    unittest.main()
