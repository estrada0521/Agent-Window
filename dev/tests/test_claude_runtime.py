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

    def test_existing_tool_families_remain_visible(self) -> None:
        cases = {
            "Bash": ({"command": "git status --short"}, "Bash git status --short"),
            "Read": ({"file_path": "/workspace/app.py"}, "Read app.py"),
            "Write": ({"file_path": "/workspace/new.py"}, "Write new.py"),
            "Edit": ({"file_path": "/workspace/app.py"}, "Edit app.py"),
            "ToolSearch": ({"query": "browser"}, "ToolSearch browser"),
            "Agent": ({"description": "Review parser"}, "Agent Review parser"),
        }
        for name, (args, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(runtime_tool_events(name, args, workspace="/workspace")[0]["text"], expected)

    def test_web_and_coordination_tools_use_semantic_labels(self) -> None:
        cases = {
            "WebSearch": ({"query": "Claude native logs"}, "Search Claude native logs"),
            "WebFetch": ({"url": "https://example.com/docs"}, "Fetch https://example.com/docs"),
            "AskUserQuestion": (
                {"questions": [{"question": "Continue?"}, {"question": "Which mode?"}]},
                "Input Continue? (+1)",
            ),
            "ScheduleWakeup": (
                {"delaySeconds": 90, "reason": "Check build"},
                "Schedule Wakeup in 90s · Check build",
            ),
            "CronCreate": (
                {"cron": "0 9 * * *", "prompt": "Daily check", "recurring": True},
                "Schedule Create 0 9 * * * · Daily check",
            ),
            "CronDelete": ({"id": "cron-1"}, "Schedule Delete cron-1"),
            "Skill": ({"skill": "pdf", "args": "inspect"}, "Skill pdf"),
            "SendMessage": (
                {"recipient": "root", "summary": "Review result"},
                "Agent Message root · Review result",
            ),
        }
        for name, (args, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(runtime_tool_events(name, args)[0]["text"], expected)

    def test_all_observed_playwright_tools_share_browser_label(self) -> None:
        cases = {
            "mcp__playwright__browser_navigate": ({"url": "https://example.com"}, "Browser Navigate https://example.com"),
            "mcp__playwright__browser_click": ({"element": "Save"}, "Browser Click Save"),
            "mcp__playwright__browser_evaluate": ({"function": "() => document.title"}, "Browser Evaluate"),
            "mcp__playwright__browser_select_option": (
                {"element": "Theme", "values": ["dark"]},
                "Browser Select Theme · dark",
            ),
            "mcp__playwright__browser_file_upload": ({"paths": ["/workspace/image.png"]}, "Browser Upload image.png"),
            "mcp__playwright__browser_take_screenshot": (
                {"filename": "/workspace/shot.png", "type": "png"},
                "Browser Screenshot shot.png",
            ),
            "mcp__playwright__browser_snapshot": ({}, "Browser Snapshot"),
            "mcp__playwright__browser_wait_for": ({"time": 2}, "Browser Wait 2s"),
            "mcp__playwright__browser_resize": ({"width": 1280, "height": 720}, "Browser Resize 1280×720"),
            "mcp__playwright__browser_console_messages": ({"level": "error"}, "Browser Console error"),
        }
        for name, (args, expected) in cases.items():
            with self.subTest(name=name):
                self.assertEqual(runtime_tool_events(name, args, workspace="/workspace")[0]["text"], expected)

    def test_unknown_tools_have_visible_fallback(self) -> None:
        self.assertEqual(runtime_tool_events("FutureTool", {"value": 1})[0]["text"], "Tool FutureTool")
        self.assertEqual(runtime_tool_events("FutureTool", "unknown payload")[0]["text"], "Tool FutureTool")
        self.assertEqual(
            runtime_tool_events("mcp__playwright__browser_hover", {"element": "Menu"})[0]["text"],
            "Browser Hover",
        )

    def test_polling_tools_remain_quiet(self) -> None:
        self.assertEqual(runtime_tool_events("write_stdin", {"session_id": 1}), [])
        self.assertEqual(runtime_tool_events("TodoRead", {}), [])


if __name__ == "__main__":
    unittest.main()
