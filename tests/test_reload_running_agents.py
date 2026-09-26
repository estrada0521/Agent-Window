from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest import mock

import server.chat.runtime as runtime_module
from server.chat import server as chat_server


class ReloadRunningAgentsHandoffTests(unittest.TestCase):

    def test_restart_env_stamps_the_running_agents_env_var(self) -> None:
        fake_runtime = SimpleNamespace(running_agents_for_reload=lambda: ["claude", "codex"])
        with mock.patch.object(chat_server, "runtime", fake_runtime):
            env = chat_server._restart_env()
        self.assertEqual(
            json.loads(env[chat_server.RELOAD_RUNNING_AGENTS_ENV]),
            ["claude", "codex"],
        )

    def test_chat_runtime_seeds_agent_running_from_the_handoff(self) -> None:
        fake_binding = SimpleNamespace(workspace="/work/project")
        with (
            mock.patch.object(runtime_module, "WorkspaceSessionBinding", return_value=fake_binding),
            mock.patch.object(runtime_module, "find_session_for_workspace", return_value=None),
        ):
            rt = runtime_module.ChatRuntime(
                port=1,
                workspace="/work/project",
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
            mock.patch.object(runtime_module, "find_session_for_workspace", return_value=None),
        ):
            rt = runtime_module.ChatRuntime(
                port=1,
                workspace="/work/project",
                    hub_port=1,
                repo_root="/tmp",
            )
        self.assertEqual(rt._agent_running, set())


if __name__ == "__main__":
    unittest.main()
