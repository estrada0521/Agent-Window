from __future__ import annotations

import logging
import subprocess

from message_delivery.paste import deliver_text_to_pane


def send_message(
    self,
    target: str,
    message: str,
    append_entry: bool = True,
    client: str | None = None,
) -> tuple[int, dict]:
    raw_target = (target or "").strip()
    message = (message or "").strip()
    if not message:
        return 400, {"ok": False, "error": "message is required"}
    if not raw_target:
        if append_entry:
            entry = self.append_user_entry(message, targets=["user"], client=client)
            return 200, {"ok": True, "mode": "note", "entry": entry}
        return 200, {"ok": True, "mode": "note"}
    targets = self.resolve_target_agents(raw_target)
    if targets == ["user"]:
        if append_entry:
            entry = self.append_user_entry(message, targets=["user"], client=client)
            return 200, {"ok": True, "mode": "note", "entry": entry}
        return 200, {"ok": True, "mode": "note"}
    if "user" in targets:
        return 400, {"ok": False, "error": 'target "user" cannot be combined with other targets'}
    if not targets:
        return 400, {"ok": False, "error": "target is required"}
    payload = message
    successful_targets: list[str] = []
    failed_targets: list[str] = []
    panes_by_agent = self.agent_panes()
    def run_tmux(args):
        return subprocess.run(
            [*self.tmux_prefix, *args],
            capture_output=True,
            text=True,
            check=False,
        )
    try:
        for agent in targets:
            pane_id = panes_by_agent.get(agent, "")
            if not pane_id:
                failed_targets.append(agent)
                continue
            if not deliver_text_to_pane(run_tmux, pane_id, payload):
                failed_targets.append(agent)
                continue
            self._mark_agent_sent(agent)
            successful_targets.append(agent)
    except Exception as exc:
        logging.error(f"Unexpected error: {exc}", exc_info=True)
        return 500, {"ok": False, "error": str(exc)}
    if not successful_targets:
        if failed_targets:
            return 400, {"ok": False, "error": f"Failed to deliver to: {failed_targets[0]}"}
        return 400, {"ok": False, "error": "No target panes resolved."}
    if append_entry:
        entry = self.append_user_entry(payload, targets=successful_targets, client=client)
        if failed_targets:
            return 400, {"ok": False, "error": f"Failed to deliver to: {', '.join(failed_targets)}"}
        return 200, {"ok": True, "entry": entry}
    if failed_targets:
        return 400, {"ok": False, "error": f"Failed to deliver to: {', '.join(failed_targets)}"}
    return 200, {"ok": True}


def mark_agent_sent(self, agent_name: str) -> None:
    self._mark_running(agent_name)
    self._bind_native_log_after_send(agent_name)
