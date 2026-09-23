from __future__ import annotations

import threading
import unittest
from types import SimpleNamespace
from unittest import mock

import server.runtime as runtime_module


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _runtime(has_log_binding):
    fake_binding = SimpleNamespace(workspace="/work/project")
    with (
        mock.patch.object(runtime_module, "WorkspaceSessionBinding", return_value=fake_binding),
        mock.patch.object(runtime_module, "_resolve_tmux_session_name_impl", return_value=""),
        mock.patch.object(runtime_module, "NativeLogSyncer"),
    ):
        rt = runtime_module.ChatRuntime(
            port=1,
            workspace="/work/project",
            hub_port=1,
            repo_root="/tmp",
        )
    rt.active_agents = lambda: ["codex"]
    rt.refresh_native_log_bindings = mock.Mock()
    rt._native_log = mock.Mock()
    rt._native_log.has_log_binding.side_effect = has_log_binding
    return rt


def _bind_and_wait(rt, clock: _FakeClock) -> None:
    with mock.patch.object(runtime_module, "time", clock):
        rt._bind_native_log_after_send("codex")
        for thread in threading.enumerate():
            if thread.name == "native-bind-codex":
                thread.join(timeout=5)


class NativeLogBindPollingTests(unittest.TestCase):
    def test_send_keeps_polling_until_the_native_log_appears(self) -> None:
        clock = _FakeClock()
        rt = _runtime([False, False, True])

        _bind_and_wait(rt, clock)

        self.assertEqual(rt.refresh_native_log_bindings.call_count, 3)
        rt.refresh_native_log_bindings.assert_called_with(["codex"], start_at_end=True)
        self.assertEqual(clock.sleeps, [0.5, 0.5])

    def test_send_polls_for_three_seconds_before_giving_up(self) -> None:
        clock = _FakeClock()
        rt = _runtime(lambda _agent: False)

        _bind_and_wait(rt, clock)

        self.assertEqual(clock.sleeps, [0.5] * 6)
        self.assertEqual(rt.refresh_native_log_bindings.call_count, 7)


if __name__ == "__main__":
    unittest.main()
