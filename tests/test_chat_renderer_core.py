from __future__ import annotations

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _between(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    finish = text.index(end, begin)
    return text[begin:finish]


class ChatRendererCoreTests(unittest.TestCase):
    def test_local_file_links_do_not_reveal_their_targets(self) -> None:
        base = (ROOT / "apps/shared/chat/base.js").read_text()
        reveal_targets = _between(
            base,
            "    const revealExternalMarkdownLinkTargets =",
            "    const applyWrittenOrderedListNumbers =",
        )
        script = f"""
const assert = require("node:assert/strict");
const document = {{
  createElement: () => ({{ className: "", textContent: "" }}),
}};
const anchor = (href, label, classes = []) => {{
  const inserted = [];
  return {{
    classList: {{ contains: (name) => classes.includes(name) }},
    getAttribute: () => href,
    textContent: label,
    after: (target) => inserted.push(target),
    inserted,
  }};
}};
{reveal_targets}
const local = anchor("/Users/example/repo/app.py:12", "app.py", ["local-file-link"]);
const inline = anchor("/file-view?path=README.md", "README.md", ["inline-file-link"]);
const external = anchor("https://example.com/reference", "reference");
revealExternalMarkdownLinkTargets({{ querySelectorAll: () => [local, inline, external] }});
assert.equal(local.inserted.length, 0);
assert.equal(inline.inserted.length, 0);
assert.equal(external.inserted.length, 1);
assert.equal(external.inserted[0].textContent, " (https://example.com/reference)");
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_local_file_link_location_is_not_part_of_the_path(self) -> None:
        parser = (ROOT / "apps/shared/chat/file-link-parse.js").read_text()
        script = f"""
const assert = require("node:assert/strict");
const window = {{ location: {{ href: "https://127.0.0.1:47616/", origin: "https://127.0.0.1:47616" }} }};
const CHAT_BASE_PATH = "";
{parser}
assert.equal(
  pathFromLocalHref("/Users/okadaharuto/workspace/Agent-Window/README.md:54"),
  "/Users/okadaharuto/workspace/Agent-Window/README.md",
);
assert.equal(pathFromLocalHref("src/app.py:12:7"), "src/app.py");
assert.equal(pathFromLocalHref("/tmp/report.md"), "/tmp/report.md");
assert.equal(
  pathFromLocalHref("/file-view?path=%2Ftmp%2Freport%3A54"),
  "/tmp/report:54",
);
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def test_renderer_falls_back_to_plain_text_on_marked_failure(self) -> None:
        base = (ROOT / "apps/shared/chat/base.js").read_text()
        messages = (ROOT / "apps/shared/chat/runtime/messages.js").read_text()
        render_markdown = _between(base, "    const applyWrittenOrderedListNumbers =", "    const wrapFileIcon")
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
const emphasizeSystemMessageKeyword = (message, kind = "") =>
  kind === "git-commit" ? message.replace(/^Commit\\b/i, "<b>Commit</b>") : message;
const stripUnsafeMarkup = () => {{}};
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
