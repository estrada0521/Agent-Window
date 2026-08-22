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
    """These tests slice JS source by literal markers instead of executing
    it, which normally makes a test weak (a rename alone breaks it). That is
    a deliberate tradeoff here, not an oversight -- do not "clean this up"
    into a behavioral test, and do not delete it as decorative.

    What this locks is a hand-tuned workaround for real iOS Safari bugs
    around native <select> menus and touch events: showPicker() silently
    failing on first call, a stray "leftover" pointer/click event from
    closing the first menu leaking into opening the second one, and a blur
    handler firing at the wrong time. These aren't behaviors you can trigger
    from a node/jsdom harness -- there is no real Safari touch/pointer
    event bug to simulate, only the specific sequence of calls (which
    listener does what, in what order, with which event flags) that was
    hand-verified against actual Safari to work around it. Pinning that
    exact shape is the only honest thing a test can do here: the "ugly,
    over-specific" string-slicing IS the contract, because the underlying
    bug it's dodging is itself an arbitrary platform quirk, not a stable
    API. If you change this code and these tests need updating, you are
    almost certainly changing real behavior on real Safari -- verify on an
    actual iOS device before touching either the code or the test.

    Deleted once already (2026-08-19, "Delete decorative tests that lock
    source text, not behavior") on the fair-sounding but wrong theory that
    not executing the code makes the test worthless. The code this
    protected was untouched and still live four days later with zero
    coverage. Restored 2026-08-23. Do not repeat that deletion.
    """

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
        remove_agent = _between(SHEETS, 'if (action === "removeAgent")', "unknown menu action")
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
