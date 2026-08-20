from __future__ import annotations

import queue
import unittest

import server.server as server_module


class _FakeQueueRuntime:
    """Deliberately has no pane_id_for_agent: if the queued-send path ever
    tried to validate a target before acking, this would raise instead of
    silently passing."""

    session_is_active = True

    def resolve_target_agents(self, target: str) -> list[str]:
        return [item.strip() for item in target.split(",") if item.strip()]

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
        # "nonexistent-agent" resolves (permissively) but corresponds to no
        # real pane. The queued-send path must ack immediately regardless -
        # deferring that failure to the async queue worker, which surfaces
        # it later as a "Send failed" system entry, is the intended design
        # (prioritizes the UI reflecting the send instantly). This must not
        # be "fixed" into a synchronous pre-check.
        status, body = server_module._send_or_enqueue_message("nonexistent-agent", "hello")

        self.assertEqual(status, 200)
        self.assertTrue(body["ok"])
        self.assertTrue(body["queued"])
        self.assertEqual(body["targets"], ["nonexistent-agent"])

        job = server_module.send_queue.get_nowait()
        self.assertEqual(job["targets"], ["nonexistent-agent"])
        self.assertEqual(job["target"], "nonexistent-agent")


if __name__ == "__main__":
    unittest.main()
