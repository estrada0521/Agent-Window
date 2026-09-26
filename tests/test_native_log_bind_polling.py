from __future__ import annotations

import threading
import unittest
from pathlib import Path
from unittest import mock

import agents.native_log_sync as sync_module


class _FakeClock:
    def __init__(self) -> None:
        self.now = 0.0
        self.sleeps: list[float] = []

    def monotonic(self) -> float:
        return self.now

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds


def _sync(has_log_binding):
    sync = sync_module.NativeLogSync(
        workspace="/work/project",
        log_path=lambda: Path("/tmp/.log.jsonl"),
        agent_panes=lambda: {"codex": "%1"},
        publish_state=lambda: None,
        report_failure=lambda _text: None,
        mark_idle=lambda _agent: None,
        mark_running=lambda _agent: None,
    )
    appears = iter(has_log_binding)

    def refresh(_agents, *, start_at_end):
        if next(appears, False):
            sync._bindings["codex"] = object()

    sync.refresh_bindings = mock.Mock(side_effect=refresh)
    return sync


def _bind_and_wait(sync, clock: _FakeClock) -> None:
    with mock.patch.object(sync_module, "time", clock):
        sync.bind_after_send("codex")
        for thread in threading.enumerate():
            if thread.name == "native-bind-codex":
                thread.join(timeout=5)


class NativeLogBindPollingTests(unittest.TestCase):
    def test_send_keeps_polling_until_the_native_log_appears(self) -> None:
        clock = _FakeClock()
        sync = _sync([False, False, True])

        _bind_and_wait(sync, clock)

        self.assertEqual(sync.refresh_bindings.call_count, 3)
        sync.refresh_bindings.assert_called_with(["codex"], start_at_end=True)
        self.assertEqual(clock.sleeps, [0.5, 0.5])

    def test_send_polls_for_three_seconds_before_giving_up(self) -> None:
        clock = _FakeClock()
        sync = _sync([])

        _bind_and_wait(sync, clock)

        self.assertEqual(clock.sleeps, [0.5] * 6)
        self.assertEqual(sync.refresh_bindings.call_count, 7)


if __name__ == "__main__":
    unittest.main()
