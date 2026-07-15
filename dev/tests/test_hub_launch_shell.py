from __future__ import annotations

import unittest
from pathlib import Path

from hub_backend.hub_server import HUB_LAUNCH_SHELL_HTML


SERVICE_WORKER_SOURCE = (
    Path(__file__).resolve().parents[2] / "apps" / "shared" / "pwa" / "service-worker.js"
).read_text(encoding="utf-8")


class HubLaunchShellTests(unittest.TestCase):
    def test_target_url_is_adopted_before_fetched_html_executes(self) -> None:
        replace_index = HUB_LAUNCH_SHELL_HTML.index("window.history.replaceState")
        write_index = HUB_LAUNCH_SHELL_HTML.index("document.write(html)")

        self.assertLess(replace_index, write_index)
        self.assertIn("if (!adoptTargetUrl()) return;", HUB_LAUNCH_SHELL_HTML)

    def test_failed_history_replacement_navigates_to_canonical_target(self) -> None:
        self.assertIn("window.location.replace(target)", HUB_LAUNCH_SHELL_HTML)
        self.assertIn("window.location.href = target", HUB_LAUNCH_SHELL_HTML)

    def test_installed_pwa_fetches_launch_shell_network_first(self) -> None:
        self.assertIn("function isNetworkFirstAsset", SERVICE_WORKER_SOURCE)
        self.assertIn(
            'return url.pathname === `${prefix}/hub-launch-shell.html`;',
            SERVICE_WORKER_SOURCE,
        )


if __name__ == "__main__":
    unittest.main()
