from __future__ import annotations

import logging
import os
import subprocess

from native_log_sync.agents._shared.path_state import _agent_base_name
from message_delivery.paste import deliver_text_to_pane


def send_message(
    self,
    target: str,
    message: str,
    append_entry: bool = True,
    client: str | None = None,
) -> tuple[int, dict]:
    target = (target or "").strip()
    message = (message or "").strip()
    if not message:
        return 400, {"ok": False, "error": "message is required"}
    if target:
        target = ",".join(self.resolve_target_agents(target))
    if not target:
        target = "user"
    targets = [item.strip() for item in target.split(",") if item.strip()]
    if not targets:
        return 400, {"ok": False, "error": "target is required"}
    if targets == ["user"]:
        if append_entry:
            entry = self.append_user_entry(message, targets=["user"], client=client)
            return 200, {"ok": True, "mode": "note", "entry": entry}
        return 200, {"ok": True, "mode": "note"}
    if "user" in targets:
        return 400, {"ok": False, "error": 'target "user" cannot be combined with other targets'}
    delivery_targets: list[str] = []
    seen_targets: set[str] = set()
    for agent in targets:
        if agent == "others":
            for expanded in self.active_agents():
                if expanded not in seen_targets:
                    seen_targets.add(expanded)
                    delivery_targets.append(expanded)
            continue
        if agent not in seen_targets:
            seen_targets.add(agent)
            delivery_targets.append(agent)
    if not delivery_targets:
        return 400, {"ok": False, "error": "target is required"}
    payload = message
    successful_targets: list[str] = []
    failed_targets: list[str] = []
    def run_tmux(args):
        return subprocess.run(
            [*self.tmux_prefix, *args],
            capture_output=True,
            text=True,
            check=False,
        )
    try:
        for agent in delivery_targets:
            pane_id = self.pane_id_for_agent(agent)
            if not pane_id:
                failed_targets.append(agent)
                continue
            if not deliver_text_to_pane(run_tmux, pane_id, payload, env=os.environ):
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
    base = _agent_base_name(agent_name)
    if base in {"claude", "cursor", "codex", "gemini", "grok"}:
        self._mark_running(agent_name)
