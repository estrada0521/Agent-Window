from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest import mock

import server.runtime as runtime_module
from server import server as chat_server


class ReloadRunningAgentsHandoffTests(unittest.TestCase):
    """reload-chat replaces the whole server process; the tmux panes underneath
    don't notice. Without this handoff every agent reads back "idle" right
    after a reload even if it's still mid-turn. This isn't a second source of
    truth for anything durable -- "running" is a transient display, and it's
    fine for it to go briefly stale. Don't delete this as an SoT cleanup."""

    def test_clean_env_stamps_the_running_agents_env_var(self) -> None:
        fake_runtime = SimpleNamespace(running_agents_for_reload=lambda: ["claude", "codex"])
        with mock.patch.object(chat_server, "runtime", fake_runtime):
            env = chat_server._clean_env()
        self.assertEqual(
            json.loads(env[chat_server.RELOAD_RUNNING_AGENTS_ENV]),
            ["claude", "codex"],
        )

    def test_clean_env_requires_a_runtime(self) -> None:
        with mock.patch.object(chat_server, "runtime", None):
            with self.assertRaises(RuntimeError):
                chat_server._clean_env()

    def test_validated_reload_running_agents_round_trips(self) -> None:
        raw = json.dumps(["claude", "codex"])
        self.assertEqual(
            chat_server._validated_reload_running_agents(raw),
            ["claude", "codex"],
        )
        self.assertEqual(chat_server._validated_reload_running_agents(""), [])

    def test_validated_reload_running_agents_rejects_garbage(self) -> None:
        for bad in ('"claude"', "[1]", '[""]', "not json"):
            with self.assertRaises(Exception):
                chat_server._validated_reload_running_agents(bad)

    def test_chat_runtime_seeds_agent_running_from_the_handoff(self) -> None:
        fake_binding = SimpleNamespace(workspace="/work/project")
        with (
            mock.patch.object(runtime_module, "WorkspaceSessionBinding", return_value=fake_binding),
            mock.patch.object(runtime_module, "_resolve_tmux_session_name_impl", return_value=""),
            mock.patch.object(runtime_module, "NativeLogSyncer"),
        ):
            rt = runtime_module.ChatRuntime(
                port=1,
                workspace="/work/project",
                tmux_socket="",
                hub_port=1,
                repo_root="/tmp",
                initial_running_agents=["claude", "codex"],
            )
        self.assertEqual(rt._agent_running, {"claude", "codex"})
        self.assertEqual(rt.running_agents_for_reload(), ["claude", "codex"])

    def test_chat_runtime_defaults_to_no_running_agents(self) -> None:
        fake_binding = SimpleNamespace(workspace="/work/project")
        with (
            mock.patch.object(runtime_module, "WorkspaceSessionBinding", return_value=fake_binding),
            mock.patch.object(runtime_module, "_resolve_tmux_session_name_impl", return_value=""),
            mock.patch.object(runtime_module, "NativeLogSyncer"),
        ):
            rt = runtime_module.ChatRuntime(
                port=1,
                workspace="/work/project",
                tmux_socket="",
                hub_port=1,
                repo_root="/tmp",
            )
        self.assertEqual(rt._agent_running, set())


if __name__ == "__main__":
    unittest.main()
