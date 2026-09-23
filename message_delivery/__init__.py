from __future__ import annotations

import subprocess

from backend_core.tmux import TMUX
from message_delivery.paste import deliver_text_to_pane


def deliver_message(self, targets: list[str], message: str) -> list[str]:
    panes_by_agent = self.agent_panes()

    def run_tmux(args):
        return subprocess.run(
            [*TMUX, *args],
            capture_output=True,
            text=True,
            check=False,
        )

    failed: list[str] = []
    for agent in targets:
        pane_id = panes_by_agent.get(agent, "")
        if not pane_id or not deliver_text_to_pane(run_tmux, pane_id, message):
            failed.append(agent)
            continue
        self._mark_agent_sent(agent)
    return failed


def mark_agent_sent(self, agent_name: str) -> None:
    self._mark_running(agent_name)
    self._bind_native_log_after_send(agent_name)
