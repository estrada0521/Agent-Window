from __future__ import annotations

import unittest

from native_log_sync.agents.claude.read_runtime import iter_tool_calls, runtime_tool_events


class ClaudeRuntimeTests(unittest.TestCase):
    def test_tool_use_blocks_are_extracted(self) -> None:
        entry = {
            "type": "assistant",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "..."},
                    {"type": "tool_use", "name": "WebSearch", "input": {"query": "Claude CLI"}},
                ]
            },
        }
        self.assertEqual(iter_tool_calls(entry), [("WebSearch", {"query": "Claude CLI"})])

    def test_unknown_tools_have_visible_fallback(self) -> None:
        self.assertTrue(runtime_tool_events("FutureTool", {"value": 1})[0]["text"])
        self.assertTrue(runtime_tool_events("FutureTool", "unknown payload")[0]["text"])
        self.assertTrue(runtime_tool_events("mcp__playwright__browser_hover", {"element": "Menu"})[0]["text"])

    def test_polling_tools_remain_quiet(self) -> None:
        self.assertEqual(runtime_tool_events("write_stdin", {"session_id": 1}), [])
        self.assertEqual(runtime_tool_events("TodoRead", {}), [])


if __name__ == "__main__":
    unittest.main()
