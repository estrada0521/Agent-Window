from __future__ import annotations

import queue
import threading
import unittest

from server.timeline.state import TimelineState


class _FakeQueueRuntime:

    def append_user_entry(self, message: str, *, targets: list[str], client: str | None = None) -> dict:
        return {"context_hash": "test-context-hash", "targets": targets, "message": message}


class QueuedSendImmediateAckTest(unittest.TestCase):
    def setUp(self) -> None:
        self.state = _FakeQueueRuntime()
        self.state.closed = False
        self.state.session_is_active = True
        self.state._events = threading.Condition()
        self.state.send_queue = queue.Queue()

    def test_queued_send_acks_before_any_target_validation(self) -> None:
        status, body = TimelineState.send_message(self.state, "nonexistent-agent", "hello")

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["entry"]["targets"], ["nonexistent-agent"])

        job = self.state.send_queue.get_nowait()
        self.assertEqual(job["targets"], ["nonexistent-agent"])


if __name__ == "__main__":
    unittest.main()
