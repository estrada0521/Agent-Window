from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _between(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    finish = text.index(end, begin)
    return text[begin:finish]


class ChatRendererCoreTests(unittest.TestCase):
    def test_real_renderer_handles_real_log_entries_and_propagates_failures(self) -> None:
        base = (ROOT / "apps/shared/chat/base.js").read_text()
        messages = (ROOT / "apps/shared/chat/runtime/messages.js").read_text()
        render_markdown = _between(base, "    const applyWrittenOrderedListNumbers =", "    const wrapFileIcon")
        build_message = _between(messages, "    const buildMsgHTML =", "    const updateSessionUI")

        entries = [
            {
                "sender": "user",
                "targets": ["cursor"],
                "message": "<script>alert(1)</script> **bold**",
                "msg_id": "synthetic-user",
            },
            {
                "sender": "cursor-2",
                "targets": ["user", "claude-1"],
                "message": "```js\\nconst x = 1;\\n```\\n\\n$E=mc^2$",
                "msg_id": "synthetic-agent",
                "deferred_body": True,
            },
            {
                "sender": "system",
                "targets": [],
                "message": "Commit abc123 renderer test",
                "msg_id": "synthetic-system",
                "kind": "git-commit",
            },
        ]

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
const revealMarkdownLinkTargets = () => {{}};
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
{render_markdown}
{build_message}

const entries = {json.dumps(entries, ensure_ascii=False)};
for (const mobile of ["0", "1"]) {{
  document.documentElement.dataset.mobile = mobile;
  for (const entry of entries) {{
    const html = buildMsgHTML(entry);
    assert.equal(typeof html, "string");
    assert.ok(html.length > 0);
    assert.ok(html.includes(String(entry.msg_id || "")));
  }}
}}

marked.parse = () => {{ throw new Error("synthetic marked failure"); }};
assert.throws(() => buildMsgHTML(entries[0]), /synthetic marked failure/);
marked = undefined;
assert.throws(() => buildMsgHTML(entries[0]), /marked is unavailable/);
console.log(`rendered=${{entries.length * 2}}`);
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("rendered=", completed.stdout)


    def test_written_ordered_list_numbers_are_preserved(self) -> None:
        base = (ROOT / "apps/shared/chat/base.js").read_text()
        helper = _between(base, "    const applyWrittenOrderedListNumbers =", "    const renderMarkdown =")
        script = f"""
const assert = require("node:assert/strict");
const items = [
  {{ attrs: {{}}, setAttribute(name, value) {{ this.attrs[name] = value; }} }},
  {{ attrs: {{}}, setAttribute(name, value) {{ this.attrs[name] = value; }} }},
  {{ attrs: {{}}, setAttribute(name, value) {{ this.attrs[name] = value; }} }},
  {{ attrs: {{}}, setAttribute(name, value) {{ this.attrs[name] = value; }} }},
];
const root = {{ querySelectorAll: (sel) => sel === "ol > li" ? items : [] }};
const marked = {{
  lexer: () => ([
    {{
      type: "list",
      ordered: true,
      items: [
        {{ raw: "11. keep\\n", tokens: [] }},
        {{ raw: "12. keep\\n", tokens: [] }},
        {{ raw: "15. default\\n", tokens: [] }},
        {{ raw: "16. delete\\n", tokens: [] }},
      ],
    }},
  ]),
}};
{helper}
applyWrittenOrderedListNumbers(root, "unused");
assert.equal(items[0].attrs.value, "11");
assert.equal(items[1].attrs.value, "12");
assert.equal(items[2].attrs.value, "15");
assert.equal(items[3].attrs.value, "16");
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)


class ChatTemplateShareTests(unittest.TestCase):
    def test_composer_html_and_runtime_are_shared(self) -> None:
        from hub_backend.presentation.chat.template_loader import load_chat_template

        desktop = load_chat_template("desktop")
        mobile = load_chat_template("mobile")
        self.assertIn('id="attachBtn"', desktop)
        self.assertIn('id="attachBtn"', mobile)
        self.assertNotIn('id="cameraBtn"', desktop)
        self.assertNotIn('id="cameraBtn"', mobile)
        self.assertIn("const isMobileComposer", desktop)
        self.assertIn("const isMobileComposer", mobile)
        self.assertIn("const gitCommitFileRowHtml", desktop)
        self.assertIn("const gitCommitFileRowHtml", mobile)


if __name__ == "__main__":
    unittest.main()
