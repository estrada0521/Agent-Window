from __future__ import annotations

import queue
import unittest

import server.server as server_module


class _FakeQueueRuntime:

    def append_user_entry(self, message: str, *, targets: list[str], client: str | None = None) -> dict:
        return {"context_hash": "test-context-hash", "targets": targets, "message": message}


class QueuedSendImmediateAckTest(unittest.TestCase):
    def setUp(self) -> None:
        self._orig_runtime = server_module.runtime
        self._orig_queue = server_module.send_queue
        server_module.runtime = _FakeQueueRuntime()
        server_module.send_queue = queue.Queue()

    def tearDown(self) -> None:
        server_module.runtime = self._orig_runtime
        server_module.send_queue = self._orig_queue

    def test_queued_send_acks_before_any_target_validation(self) -> None:
        status, body = server_module._send_or_enqueue_message("nonexistent-agent", "hello")

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertEqual(body["entry"]["targets"], ["nonexistent-agent"])

        job = server_module.send_queue.get_nowait()
        self.assertEqual(job["targets"], ["nonexistent-agent"])
        self.assertEqual(job["target"], "nonexistent-agent")


if __name__ == "__main__":
    unittest.main()
