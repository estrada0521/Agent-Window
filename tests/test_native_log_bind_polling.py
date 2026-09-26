from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace
from unittest import mock

import server.room.state as state_module


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _state(has_log_binding):
    fake_binding = SimpleNamespace(workspace="/work/project")
    with (
        mock.patch.object(state_module, "WorkspaceTimelineBinding", return_value=fake_binding),
        mock.patch.object(state_module, "find_session_for_workspace", return_value=None),
    ):
        state = state_module.RoomState(
            port=1,
            workspace="/work/project",
            hub_port=1,
            repo_root="/tmp",
        )
    state.active_agents = lambda: ["codex"]
    appears = iter(has_log_binding)

    def refresh(_agents, *, start_at_end):
        if next(appears, False):
            state._native_log_bindings_by_agent["codex"] = object()

    state.refresh_native_log_bindings = mock.Mock(side_effect=refresh)
    return state


def _bind_and_wait(state, clock: _FakeClock) -> None:
    with mock.patch.object(state_module, "time", clock):
        state._bind_native_log_after_send("codex")
        for thread in threading.enumerate():
            if thread.name == "native-bind-codex":
                thread.join(timeout=5)


class NativeLogBindPollingTests(unittest.TestCase):
    def test_send_keeps_polling_until_the_native_log_appears(self) -> None:
        clock = _FakeClock()
        state = _state([False, False, True])

        _bind_and_wait(state, clock)

        self.assertEqual(state.refresh_native_log_bindings.call_count, 3)
        state.refresh_native_log_bindings.assert_called_with(["codex"], start_at_end=True)
        self.assertEqual(clock.sleeps, [0.5, 0.5])

    def test_send_polls_for_three_seconds_before_giving_up(self) -> None:
        clock = _FakeClock()
        state = _state([])

        _bind_and_wait(state, clock)

        self.assertEqual(clock.sleeps, [0.5] * 6)
        self.assertEqual(state.refresh_native_log_bindings.call_count, 7)


if __name__ == "__main__":
    unittest.main()
