import unittest
from unittest.mock import patch

from server.runtime import ChatRuntime


class _NativeLog:
    @staticmethod
    def clear_agent_runtime_display(_agent: str) -> bool:
        return False

    @staticmethod
    def agent_statuses(running_agents: set[str]) -> dict[str, str]:
        return {"codex": "running" if "codex" in running_agents else "idle"}


class AgentRunningStateTests(unittest.TestCase):
    def test_idle_cannot_restore_stale_tmux_marker(self) -> None:
        runtime = ChatRuntime.__new__(ChatRuntime)
        runtime._agent_running = {"codex"}
        runtime._native_log = _NativeLog()
        runtime.notify_session_state_changed = lambda *_args, **_kwargs: None
        tmux_marker = {"running": True}
        runtime._restore_running_agents_from_tmux_env = (
            lambda: {"codex"} if tmux_marker["running"] else set()
        )

        def remove_tmux_marker(_runtime, _agent: str, running: bool) -> None:
            self.assertFalse(running)
            runtime.agent_statuses()
            tmux_marker["running"] = False

        with patch("server.runtime._update_running_env_impl", side_effect=remove_tmux_marker):
            runtime._mark_idle("codex")

        self.assertEqual(runtime.agent_statuses(), {"codex": "idle"})


if __name__ == "__main__":
    unittest.main()
