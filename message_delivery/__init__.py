from __future__ import annotations

import logging
import os
import subprocess
import time

from native_log_sync.agents._shared.path_state import _agent_base_name
from message_delivery.paste_timing import delivery_paste_delay_seconds


def _send_keys_literal(runtime, pane_id: str, text: str, *, subprocess_module=subprocess) -> bool:
    pane = str(pane_id or "").strip()
    if not pane:
        return False
    result = subprocess_module.run(
        [*runtime.tmux_prefix, "send-keys", "-t", pane, "-l", "--", str(text)],
        capture_output=True, text=True, check=False,
    )
    return result.returncode == 0


def _send_enter(runtime, pane_id: str, *, subprocess_module=subprocess) -> bool:
    pane = str(pane_id or "").strip()
    if not pane:
        return False
    result = subprocess_module.run(
        [*runtime.tmux_prefix, "send-keys", "-t", pane, "", "Enter"],
        capture_output=True, check=False,
    )
    return result.returncode == 0


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
    try:
        for agent in delivery_targets:
            pane_id = self.pane_id_for_agent(agent)
            if not pane_id:
                failed_targets.append(agent)
                continue
            if not _send_keys_literal(self, pane_id, payload, subprocess_module=subprocess):
                failed_targets.append(agent)
                continue
            time.sleep(delivery_paste_delay_seconds(env=os.environ))
            if not _send_enter(self, pane_id, subprocess_module=subprocess):
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


def _update_running_env(runtime, agent: str, running: bool) -> None:
    upper = agent.upper().replace("-", "_")
    var = f"AGENT_WINDOW_RUNNING_{upper}"
    if running:
        args = [*runtime.tmux_prefix, "set-environment", "-t", runtime.tmux_session_name, var, "1"]
    else:
        args = [*runtime.tmux_prefix, "set-environment", "-u", "-t", runtime.tmux_session_name, var]
    result = subprocess.run(args, capture_output=True, check=False, timeout=1)
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or b"").decode("utf-8", "replace").strip()
        raise RuntimeError(detail or f"tmux set-environment failed for {agent}")


def mark_agent_sent(self, agent_name: str) -> None:
    base = _agent_base_name(agent_name)
    if base in {"claude", "cursor", "codex", "gemini", "grok"}:
        self._mark_running(agent_name)
