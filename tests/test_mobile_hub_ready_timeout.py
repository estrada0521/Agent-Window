from __future__ import annotations

import json
import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class MobileHubReadyTimeoutTests(unittest.TestCase):
    def test_cross_origin_iframe_detection_does_not_use_frame_element(self) -> None:
        app = (ROOT / "apps/mobile/chat/app.js").read_text()
        self.assertIn("const isEmbeddedHubChat = window.parent !== window;", app)
        self.assertNotIn("window.frameElement", app)

    def test_one_deadline_controls_success_timeout_and_explicit_error(self) -> None:
        home = (ROOT / "apps/mobile/hub/home.js").read_text()
        start = home.index("    function showLaunchShell()")
        end = home.index("    const _launchShellParams", start)
        functions = home[start:end]

        script = f"""
const assert = require("node:assert/strict");
const HUB_READY_TIMEOUT_MS = 5000;
const HUB_LAUNCH_SHELL_PARAM = "launch_shell";
let _hubLaunchShellPending = false;
let _awaitingChatRenderReady = false;
let _hubReadyTimeoutTimer = 0;
const timerCalls = [];
const cleared = [];
const setTimeout = (fn, ms) => {{
  timerCalls.push({{ fn, ms }});
  return timerCalls.length;
}};
const clearTimeout = (id) => cleared.push(id);
const requestAnimationFrame = (fn) => fn();
const card = {{
  classList: {{
    add: (name) => {{ card.errorClass = name; }},
    remove: (name) => {{ if (card.errorClass === name) card.errorClass = ""; }},
  }},
  removeAttribute: (name) => {{ card.removedAttribute = name; }},
  setAttribute: (name, value) => {{ card.attrs = card.attrs || {{}}; card.attrs[name] = value; }},
  textContent: "",
  innerHTML: "",
}};
const _launchShell = {{
  hidden: true,
  classList: {{
    add: () => {{ _launchShell.visible = true; }},
    remove: () => {{ _launchShell.visible = false; }},
  }},
  querySelector: () => card,
}};
const window = {{
  location: {{ search: "?launch_shell=1", pathname: "/", hash: "" }},
  history: {{ replaceState: () => {{ window.replaced = true; }} }},
}};
{functions}

startChatRenderWait();
startChatRenderWait();
assert.equal(timerCalls.length, 1);
assert.equal(timerCalls[0].ms, 5000);
_hubLaunchShellPending = true;
releaseHubLaunchShellAfterRender();
assert.equal(_hubReadyTimeoutTimer, 1);
finishChatRenderWait();
assert.equal(_hubReadyTimeoutTimer, 0);
assert.equal(_launchShell.hidden, true);

startChatRenderWait();
assert.equal(timerCalls.length, 2);
timerCalls[1].fn();
assert.equal(card.textContent, "timeout");
assert.equal(card.errorClass, "is-error");
assert.equal(_launchShell.hidden, false);
assert.equal(_awaitingChatRenderReady, false);

startChatRenderWait();
failHubReadyWait("messages unavailable");
assert.equal(card.textContent, "messages unavailable");
assert.equal(_hubReadyTimeoutTimer, 0);
console.log("mobile hub ready timeout state machine ok");
"""
        completed = subprocess.run(
            ["node"],
            input=script,
            text=True,
            capture_output=True,
            check=False,
        )
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertIn("state machine ok", completed.stdout)


if __name__ == "__main__":
    unittest.main()
