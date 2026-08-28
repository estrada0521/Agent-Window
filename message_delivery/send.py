from __future__ import annotations

import http.client
import json
import os
import re
import ssl
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

from message_delivery.interaction import normalize_sender_payload
from message_delivery.names import (
    load_agent_names,
    remove_agent_name,
    set_agent_name,
    validate_agent_display_name,
)
from backend_core.agents.names import agent_base_name
from backend_core.agents.registry import ALL_AGENT_NAMES
from backend_core.access.files import append_jsonl_entry
from backend_core.access.session_meta import SessionMetaError, find_session_for_workspace
from backend_core.tmux.topology import default_tmux_socket_name
from message_delivery.paste import deliver_text_to_pane


from backend_core.access.settings import pwa_https_enabled, session_log_path, workspace_chat_port


class AgentSendError(RuntimeError):
    pass


@dataclass(frozen=True)
class DeliveryTarget:
    agent_name: str
    pane_id: str


def tmux_socket_from_env(env: dict[str, str]) -> str:
    explicit = (env.get("AGENT_WINDOW_TMUX_SOCKET") or "").strip()
    if explicit:
        return explicit
    tmux_env = (env.get("TMUX") or "").strip()
    if tmux_env:
        socket_path = tmux_env.split(",", 1)[0]
        if re.match(r"^/(private/)?tmp/tmux-[^/]+/.+$", socket_path):
            return Path(socket_path).name
        return socket_path
    return default_tmux_socket_name()

class TmuxClient:
    def __init__(self, tmux_socket_name: str, env: dict[str, str]):
        self.tmux_socket_name = tmux_socket_name
        self.env = env

    def _prefix(self) -> list[str]:
        if "/" in self.tmux_socket_name:
            return ["tmux", "-S", self.tmux_socket_name]
        return ["tmux", "-L", self.tmux_socket_name]

    def run(self, args: list[str]) -> subprocess.CompletedProcess[str]:
        cmd = [*self._prefix(), *args]
        try:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=False,
                env=self.env,
            )
        except OSError as exc:
            return subprocess.CompletedProcess(cmd, 127, "", str(exc))


class AgentSendRuntime:
    def __init__(
        self,
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        self.env = dict(os.environ if env is None else env)
        tmux_context = (self.env.get("TMUX") or "").strip()
        if not tmux_context:
            raise AgentSendError("agent-send must run inside an active tmux pane.")
        self.tmux_socket_name = tmux_context.split(",", 1)[0]
        self.tmux = TmuxClient(self.tmux_socket_name, self.env)
        self.all_agents = list(ALL_AGENT_NAMES)
        self._tmux_session_name: str | None = None

    def resolve_tmux_session_name(self) -> str:
        """Return the tmux session containing this process's own pane."""
        if self._tmux_session_name is not None:
            return self._tmux_session_name
        result = self.tmux.run(["display-message", "-p", "#{session_name}"])
        resolved = (result.stdout or "").strip()
        if not resolved:
            detail = (result.stderr or result.stdout or "").strip()
            raise AgentSendError(detail or "Cannot resolve the current tmux session.")
        self._tmux_session_name = resolved
        return resolved

    def tmux_env(self, key: str) -> str:
        target_name = self.resolve_tmux_session_name()
        result = self.tmux.run(["show-environment", "-t", target_name, key])
        line = (result.stdout or "").strip()
        if result.returncode == 0 and "=" in line:
            return line.split("=", 1)[1]
        detail = (result.stderr or result.stdout or "").strip()
        if "unknown variable" in detail.lower():
            return ""
        raise AgentSendError(detail or f"Cannot read {key} from the current tmux session.")

    def resolve_session_name(self) -> str:
        """Return the current AW session name -- looked up by workspace.

        tmux never carries this (an AW session's name can be renamed
        independently of the tmux session underneath it), so the only
        reliable source is the same one the rest of AW uses: which log
        folder's .meta currently claims this workspace. AGENT_WINDOW_WORKSPACE
        is set once at session creation and never rewritten, so it's a
        stable key even if this process's own environment is otherwise
        stale.
        """
        workspace = (self.env.get("AGENT_WINDOW_WORKSPACE") or "").strip()
        if not workspace:
            raise AgentSendError("AGENT_WINDOW_WORKSPACE is not set in this pane.")
        try:
            resolved = find_session_for_workspace(workspace)
        except SessionMetaError as exc:
            raise AgentSendError(str(exc)) from exc
        if resolved:
            return resolved
        raise AgentSendError("No active agent-window session found for this workspace.")

    def resolve_pane(self, key: str) -> str:
        return self.tmux_env(key)

    def resolve_agent_name(self, token: str) -> str | None:
        lower = (token or "").strip().lower()
        if not lower:
            return None
        base = agent_base_name(lower)
        if base in self.all_agents:
            return lower
        return None

    def resolve_self_agent(self) -> str | None:
        current_pane = (self.env.get("TMUX_PANE") or "").strip()
        if not current_pane:
            raise AgentSendError("TMUX_PANE is not set in this pane.")
        for agent in self.active_agent_instances():
            pane = self.resolve_pane(f"AGENT_WINDOW_PANE_{agent.upper().replace('-', '_')}")
            if pane == current_pane:
                return agent
        return None

    def agent_names(self, session_name: str) -> dict[str, str]:
        return load_agent_names(session_name)

    def active_agent_instances(self) -> list[str]:
        agents_str = self.tmux_env("AGENT_WINDOW_AGENTS")
        if agents_str == "-":
            return []
        if not agents_str:
            raise AgentSendError("AGENT_WINDOW_AGENTS is not set in the current tmux session.")
        return [item.strip() for item in agents_str.split(",") if item.strip()]

    def resolve_agent_name_target(self, session_name: str, requested: str) -> str:
        raw = str(requested or "").strip()
        lowered = raw.lower()
        if not lowered:
            raise AgentSendError("Agent target is required.")

        available = self.active_agent_instances()
        for instance in available:
            if instance.lower() == lowered:
                return instance

        alias_matches = [
            canonical
            for canonical, display in self.agent_names(session_name).items()
            if display.casefold() == raw.casefold() and canonical in available
        ]
        if len(alias_matches) == 1:
            return alias_matches[0]
        if len(alias_matches) > 1:
            raise AgentSendError(f'Agent name is ambiguous: "{raw}"')

        resolved = self.resolve_agent_name(raw)
        if resolved:
            base = agent_base_name(resolved)
            candidates = [
                instance
                for instance in available
                if instance == base or instance.startswith(f"{base}-")
            ]
            if len(candidates) == 1:
                return candidates[0]
            if len(candidates) > 1:
                options = ", ".join(candidates)
                raise AgentSendError(f'Agent target "{raw}" is ambiguous; use one of: {options}')

        raise AgentSendError(f"Agent instance not found: {raw}")

    def _validate_name_available(self, session_name: str, canonical: str, display_name: str) -> str:
        try:
            name = validate_agent_display_name(display_name)
        except ValueError as exc:
            raise AgentSendError(str(exc)) from exc
        folded = name.casefold()
        reserved = {"user", "others", "name", "names", "unname"}
        reserved.update(agent.casefold() for agent in self.active_agent_instances())
        if folded in reserved or self.resolve_agent_name(name) is not None:
            raise AgentSendError(f'Agent name conflicts with an existing target: "{name}"')
        for other_canonical, other_name in self.agent_names(session_name).items():
            if other_canonical != canonical and other_name.casefold() == folded:
                raise AgentSendError(f'Agent name is already in use: "{name}"')
        return name

    def assign_agent_name(self, session_name: str, requested: str, display_name: str) -> tuple[str, str]:
        canonical = self.resolve_agent_name_target(session_name, requested)
        name = self._validate_name_available(session_name, canonical, display_name)
        set_agent_name(session_name, canonical, name)
        return canonical, name

    def clear_agent_name(self, session_name: str, requested: str) -> tuple[str, str]:
        canonical = self.resolve_agent_name_target(session_name, requested)
        removed, _names = remove_agent_name(session_name, canonical)
        if not removed:
            raise AgentSendError(f"Agent has no name: {canonical}")
        return canonical, removed

    @staticmethod
    def normalize_payload(sender: str, payload: str) -> str:
        return normalize_sender_payload(sender, payload)

    def resolve_session_log_path(self, session_name: str) -> Path:
        target_session = session_name or "default"
        default_path = session_log_path(target_session)
        default_path.parent.mkdir(parents=True, exist_ok=True)
        if not default_path.exists():
            default_path.touch()
        return default_path

    def _build_delivery_targets(self, session_name: str, target_spec: str, sender_role: str | None) -> list[DeliveryTarget]:
        targets: list[DeliveryTarget] = []
        panes_by_target: dict[str, str] = {}
        active = self.active_agent_instances()

        def queue(agent_name: str, pane_id: str) -> None:
            if not agent_name or not pane_id:
                return
            panes_by_target[agent_name] = pane_id

        for raw_target in [item.strip() for item in (target_spec or "").split(",") if item.strip()]:
            lower_target = raw_target.lower()
            if lower_target == "user":
                raise AgentSendError(
                    'agent-send: target "user" has been removed.\n\n'
                    "Respond to humans in your normal assistant output (native event logs are indexed automatically).\n"
                    "Use agent-send only for agent-to-agent communication targets."
                )
            if lower_target == "others":
                if not sender_role:
                    raise AgentSendError("Cannot resolve current sender for target: others")
                for instance in active:
                    if sender_role != "user" and instance == sender_role:
                        continue
                    pane = self.resolve_pane(f"AGENT_WINDOW_PANE_{instance.upper().replace('-', '_')}")
                    if pane:
                        queue(instance, pane)
                continue

            canonical = self.resolve_agent_name_target(session_name, raw_target)
            pane = self.resolve_pane(f"AGENT_WINDOW_PANE_{canonical.upper().replace('-', '_')}")
            if not pane:
                raise AgentSendError(f"Target pane not found: {raw_target}")
            queue(canonical, pane)

        for name, pane in panes_by_target.items():
            targets.append(DeliveryTarget(agent_name=name, pane_id=pane))
        return targets

    def _notify_running_agents(self, agents: list[str]) -> None:
        workspace = str(self.env.get("AGENT_WINDOW_WORKSPACE") or "").strip()
        if not workspace:
            raise AgentSendError("AGENT_WINDOW_WORKSPACE is not set in this pane.")
        port = workspace_chat_port(workspace)
        body = json.dumps({"targets": agents}).encode("utf-8")
        connection: http.client.HTTPConnection | http.client.HTTPSConnection
        if pwa_https_enabled():
            connection = http.client.HTTPSConnection(
                "127.0.0.1",
                port,
                timeout=1,
                context=ssl._create_unverified_context(),
            )
        else:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=1)
        try:
            connection.request(
                "POST",
                "/agent-running",
                body=body,
                headers={
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                    "Host": f"127.0.0.1:{port}",
                },
            )
            response = connection.getresponse()
            detail = response.read().decode("utf-8", errors="replace").strip()
            if not 200 <= response.status < 300:
                raise AgentSendError(detail or f"chat server returned {response.status}")
        except (OSError, http.client.HTTPException, TimeoutError) as exc:
            raise AgentSendError(f"could not notify chat server: {exc}") from exc
        finally:
            connection.close()

    def send_to_pane(
        self,
        pane_id: str,
        payload: str,
    ) -> bool:
        return deliver_text_to_pane(self.tmux.run, pane_id, payload, env=self.env)

    def append_log_entry(
        self,
        *,
        session_name: str,
        sender: str,
        targets: list[str],
        payload: str,
    ) -> None:
        log_path = self.resolve_session_log_path(session_name)
        entry = {
            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            "session": session_name,
            "sender": sender,
            "targets": targets,
            "message": payload,
        }
        append_jsonl_entry(log_path, entry)

    def send_message(
        self,
        *,
        target_spec: str,
        payload: str,
    ) -> bool:
        session_name = self.resolve_session_name()
        sender_role = self.resolve_self_agent() or "user"
        sender_label = self.agent_names(session_name).get(sender_role, sender_role)
        delivery_payload = self.normalize_payload(sender_label, payload)
        delivery_targets = self._build_delivery_targets(session_name, target_spec, sender_role)
        if not delivery_targets:
            raise AgentSendError("No target panes resolved.")

        if any(t.agent_name == sender_role for t in delivery_targets):
            raise AgentSendError("cannot send to yourself")

        successful_targets: list[str] = []
        failed_any = False
        for target in delivery_targets:
            if self.send_to_pane(target.pane_id, delivery_payload):
                if target.agent_name not in successful_targets:
                    successful_targets.append(target.agent_name)
            else:
                failed_any = True
                print(f"Failed to deliver to: {target.agent_name}", file=sys.stderr)

        if not successful_targets:
            raise AgentSendError("Message delivery failed for all targets.")

        self.append_log_entry(
            session_name=session_name,
            sender=sender_role,
            targets=successful_targets,
            payload=delivery_payload,
        )
        try:
            self._notify_running_agents(successful_targets)
        except AgentSendError as exc:
            print(f"Delivered, but Agent Window was not notified: {exc}", file=sys.stderr)

        target_names = ", ".join(successful_targets)
        display = delivery_payload if len(delivery_payload) <= 200 else delivery_payload[:200] + "..."
        print(f"The following was sent to {target_names}:\n{display}")

        return not failed_any
