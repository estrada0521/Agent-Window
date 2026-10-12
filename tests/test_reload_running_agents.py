from __future__ import annotations

import json
import unittest
from types import SimpleNamespace
from unittest import mock

import server.timeline.state as state_module
from server.hub import server as hub_server


class ReloadRunningAgentsHandoffTests(unittest.TestCase):

    def test_restart_env_stamps_the_running_agents_env_var(self) -> None:
        fake_runtime = SimpleNamespace(running_agents_for_reload=lambda: {"/work/project": ["claude", "codex"]})
        with mock.patch.object(hub_server, "hub", fake_runtime):
            env = hub_server._restart_env()
        self.assertEqual(
            json.loads(env[hub_server.RELOAD_RUNNING_AGENTS_ENV]),
            {"/work/project": ["claude", "codex"]},
        )

    def test_timeline_runtime_seeds_agent_running_from_the_handoff(self) -> None:
        fake_binding = SimpleNamespace(workspace="/work/project")
        with (
            mock.patch.object(state_module, "WorkspaceTimelineBinding", return_value=fake_binding),
            mock.patch.object(state_module, "find_session_for_workspace", return_value=None),
        ):
            state = state_module.TimelineState(
                workspace="/work/project",
                server_instance="test",
                publish_hub_messages=lambda: None,
                initial_running_agents=["claude", "codex"],
            )
        self.assertEqual(state._agent_running, {"claude", "codex"})
        self.assertEqual(state.running_agents_for_reload(), ["claude", "codex"])

    def test_timeline_runtime_defaults_to_no_running_agents(self) -> None:
        fake_binding = SimpleNamespace(workspace="/work/project")
        with (
            mock.patch.object(state_module, "WorkspaceTimelineBinding", return_value=fake_binding),
            mock.patch.object(state_module, "find_session_for_workspace", return_value=None),
        ):
            state = state_module.TimelineState(
                workspace="/work/project",
                server_instance="test",
                publish_hub_messages=lambda: None,
            )
        self.assertEqual(state._agent_running, set())


if __name__ == "__main__":
    unittest.main()
