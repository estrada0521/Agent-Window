from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _between(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    finish = text.index(end, begin)
    return text[begin:finish]


class TimelineRendererCoreTests(unittest.TestCase):
    def test_renderer_falls_back_to_plain_text_on_marked_failure(self) -> None:
        render_src = (ROOT / "web/timeline/markdown-render.js").read_text()
        messages = (ROOT / "web/timeline/messages.js").read_text()
        render_markdown = _between(
            render_src,
            "    const renderMarkdownFallback =",
            "    const renderMarkdownUnsafe =",
        )
        build_message = _between(messages, "    const buildMsgHTML =", "    const updateMessageProjectionUI")

        script = f"""
const assert = require("node:assert/strict");
const document = {{
  documentElement: {{ dataset: {{ mobile: "0" }} }},
  createElement: () => ({{
    innerHTML: "",
    querySelectorAll: () => [],
    prepend: () => {{}},
  }}),
  createTextNode: (content) => ({{ content }}),
}};
let marked = {{ parse: (text) => `<p>${{text}}</p>`, lexer: () => [] }};
const injectFileCards = (html) => html;
const normalizeEscapedLineBreaks = (text) => String(text ?? "").replace(/\\\\n/g, "\\n");
const escapeHtml = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const markdownEscapeHtml = escapeHtml;
const stripSenderPrefix = (value) => value.replace(/^\\[From:\\s*[^\\]]+\\]\\s*/i, "");
const copyIcon = "<svg></svg>";
const checkIcon = "<svg></svg>";
const agentBaseName = (name) => (name || "").toLowerCase().replace(/-\\d+$/, "");
const roleClass = (sender) => {{
  const base = agentBaseName(sender);
  return base === "user" ? "user" : "agent";
}};
const metaAgentLabel = (name, textClass, _side, {{ iconOnly = false }} = {{}}) => {{
  const raw = (name || "").trim() || "unknown";
  return `<span class="${{textClass}}" data-icon-only="${{iconOnly}}">${{escapeHtml(raw)}}</span>`;
}};
const isCollapsibleMessageSender = (sender) => {{
  const normalized = String(sender || "").trim().toLowerCase();
  return !!normalized && normalized !== "system";
}};
const formatSystemMessageHtml = (message) => {{
  const text = String(message || "");
  const idx = text.indexOf(":");
  if (idx < 0) return escapeHtml(text);
  return `<b>${{escapeHtml(text.slice(0, idx))}}</b>${{escapeHtml(text.slice(idx))}}`;
}};
const stripUnsafeMarkup = () => {{}};
const extractFrontmatter = () => null;
const formatMessageTime = () => "";
const renderMarkdownUnsafe = (text) => {{
  if (typeof marked === "undefined") throw new Error("marked is unavailable");
  return marked.parse(String(text ?? ""), {{ breaks: true, gfm: true }});
}};
{render_markdown}
{build_message}

const entry = {{ sender: "user", targets: ["cursor"], message: "hi <b>there</b>\\nline2", context_hash: "m1" }};
marked.parse = () => {{ throw new Error("synthetic marked failure"); }};
let html = buildMsgHTML(entry);
assert.match(html, /hi &lt;b&gt;there&lt;\\/b&gt;<br>line2/);
assert.doesNotMatch(html, /<b>there<\\/b>/);
marked = undefined;
html = buildMsgHTML(entry);
assert.match(html, /hi &lt;b&gt;there&lt;\\/b&gt;<br>line2/);
console.log("marked-failure-falls-back-to-plain-text");
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("marked-failure-falls-back-to-plain-text", completed.stdout)


if __name__ == "__main__":
    unittest.main()
