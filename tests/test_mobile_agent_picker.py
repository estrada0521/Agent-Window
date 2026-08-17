from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SHEETS = (ROOT / "apps/mobile/chat/panes/sheets.js").read_text()
RENDER = (ROOT / "apps/shared/chat/transcript/render.js").read_text()
SHELL = (ROOT / "apps/mobile/chat/shell.html").read_text()


def _between(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    finish = text.index(end, begin)
    return text[begin:finish]


class MobileAgentPickerTests(unittest.TestCase):
    def test_add_remove_stay_on_the_first_native_menu(self) -> None:
        self.assertIn('id="pageNativeMenuSelect"', SHELL)
        self.assertIn('value="addAgent"', SHELL)
        self.assertIn('value="removeAgent"', SHELL)
        self.assertNotIn("nativeHeaderMenuSelect.innerHTML", SHEETS)
        self.assertIn('id = "agentActionNativeMenuSelect"', RENDER)

    def test_leftover_hamburger_tap_opens_the_second_picker(self) -> None:
        pointerdown = _between(
            SHEETS,
            'nativeHeaderMenuSelect?.addEventListener("pointerdown"',
            'nativeHeaderMenuSelect?.addEventListener("change"',
        )
        self.assertIn("agentActionSelectIsArmed()", pointerdown)
        self.assertIn("event.preventDefault()", pointerdown)
        self.assertIn("event.stopPropagation()", pointerdown)
        self.assertIn("showArmedAgentActionPicker()", pointerdown)
        self.assertNotIn("passive: true", pointerdown)

        button = _between(
            SHEETS,
            'rightMenuBtn?.addEventListener("click"',
            'repoPanel?.addEventListener("click"',
        )
        self.assertLess(
            button.index("agentActionSelectIsArmed()"),
            button.index("resetAgentActionNativeMenu"),
        )
        self.assertIn("showArmedAgentActionPicker()", button)

    def test_failed_first_showpicker_leaves_the_select_armed(self) -> None:
        opener = _between(RENDER, "const openAgentActionMenu =", "const showAddAgentModal =")
        retry = _between(opener, "if (!opened)", "return true;")
        self.assertIn("setTimeout(() => { void show(); }, 0);", retry)
        self.assertNotIn("resetAgentActionNativeMenu", retry)
        self.assertNotIn("agent menu unavailable", opener)

    def test_add_remove_do_not_reset_before_the_leftover_tap(self) -> None:
        add_agent = _between(SHEETS, 'if (action === "addAgent")', 'if (action === "removeAgent")')
        remove_agent = _between(SHEETS, 'if (action === "removeAgent")', "document.getElementById(action)")
        self.assertIn("showAddAgentModal()", add_agent)
        self.assertNotIn("closeQuickMore", add_agent)
        self.assertIn("showRemoveAgentModal()", remove_agent)
        self.assertNotIn("closeQuickMore", remove_agent)

    def test_blur_after_leftover_returns_the_first_menu(self) -> None:
        opener = _between(RENDER, "const openAgentActionMenu =", "const showAddAgentModal =")
        self.assertIn('skipAgentMenuBlur = document.documentElement.dataset.mobile === "1"', opener)
        blur = _between(RENDER, 'select.addEventListener("blur"', "document.body.appendChild(select)")
        self.assertIn("if (skipAgentMenuBlur) return;", blur)
        leftover_click = _between(
            SHEETS,
            'document.addEventListener("click"',
            "async function runForwardAction",
        )
        self.assertIn("skipAgentMenuBlur = false", leftover_click)


if __name__ == "__main__":
    unittest.main()
