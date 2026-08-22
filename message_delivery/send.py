from __future__ import annotations

import os
import re
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
from backend_core.tmux.resolve import find_tmux_session_for_workspace
from backend_core.tmux.topology import default_tmux_socket_name
from message_delivery.paste_timing import delivery_paste_delay_seconds


from backend_core.access.settings import session_log_path


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
        repo_root: Path | str,
        env: dict[str, str] | None = None,
        cwd: Path | str | None = None,
    ) -> None:
        self.repo_root = Path(repo_root).resolve()
        self.env = dict(os.environ if env is None else env)
        self.cwd = Path(cwd or os.getcwd()).resolve()
        self.tmux_socket_name = tmux_socket_from_env(self.env)
        self.tmux = TmuxClient(self.tmux_socket_name, self.env)
        self.all_agents = list(ALL_AGENT_NAMES)
        self._tmux_session_name: str | None = None

    def list_sessions(self) -> list[str]:
        result = self.tmux.run(["list-sessions", "-F", "#S"])
        if result.returncode != 0:
            return []
        return [line.strip() for line in (result.stdout or "").splitlines() if line.strip()]

    def resolve_tmux_session_name(self) -> str:
        """Find the live tmux session this process's own pane belongs to.

        tmux never knows this AW session's own name (which can be renamed
        independently of the tmux session underneath it) -- only where it's
        running. `display-message` with no `-t` asks tmux directly, using
        this process's own TMUX/TMUX_PANE context, so it needs no name or
        workspace matching at all and can't be fooled by a rename.
        """
        if self._tmux_session_name is not None:
            return self._tmux_session_name
        resolved = ""
        if self.env.get("TMUX"):
            result = self.tmux.run(["display-message", "-p", "#{session_name}"])
            resolved = (result.stdout or "").strip()
        if not resolved:
            workspace = (self.env.get("AGENT_WINDOW_WORKSPACE") or "").strip()
            if workspace:
                resolved = (
                    find_tmux_session_for_workspace(workspace, self.list_sessions(), self._tmux_env_workspace) or ""
                )
        self._tmux_session_name = resolved
        return resolved

    def _tmux_env_workspace(self, session_name: str) -> str | None:
        result = self.tmux.run(["show-environment", "-t", session_name, "AGENT_WINDOW_WORKSPACE"])
        line = (result.stdout or "").strip()
        if result.returncode != 0 or "=" not in line:
            return None
        return line.split("=", 1)[1].strip() or None

    def tmux_env(self, session_name: str, key: str) -> str:
        # Every caller in this file is asking about its own session (there
        # is no "query a different session" path here), so the real tmux
        # target is always this process's own live session.
        target_name = self.resolve_tmux_session_name()
        result = self.tmux.run(["show-environment", "-t", target_name, key])
        line = (result.stdout or "").strip()
        if result.returncode == 0 and "=" in line:
            return line.split("=", 1)[1]
        return (self.env.get(key) or "").strip()

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
        workspace = (self.env.get("AGENT_WINDOW_WORKSPACE") or "").strip() or str(self.cwd)
        try:
            resolved = find_session_for_workspace(workspace)
        except SessionMetaError as exc:
            raise AgentSendError(str(exc)) from exc
        if resolved:
            return resolved
        raise AgentSendError("No active agent-window session found for this workspace.")

    def resolve_pane(self, session_name: str, key: str) -> str:
        value = self.tmux_env(session_name, key)
        if value:
            return value
        return ""

    def resolve_agent_name(self, token: str) -> str | None:
        lower = (token or "").strip().lower()
        if not lower:
            return None
        base = agent_base_name(lower)
        if base in self.all_agents:
            return lower
        return None

    def resolve_self_agent(self, session_name: str) -> str | None:
        current_pane = (self.env.get("TMUX_PANE") or "").strip()
        if not current_pane:
            return None

        agents_str = self.tmux_env(session_name, "AGENT_WINDOW_AGENTS")
        if agents_str:
            for instance in [x.strip() for x in agents_str.split(",") if x.strip()]:
                upper = instance.upper().replace("-", "_")
                pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{upper}")
                if pane == current_pane:
                    return instance

        for agent in self.all_agents:
            pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{agent.upper()}")
            if pane == current_pane:
                return agent
        return None

    def current_pane_role(self, session_name: str) -> str | None:
        return self.resolve_self_agent(session_name)

    def agent_names(self, session_name: str) -> dict[str, str]:
        return load_agent_names(session_name)

    def active_agent_instances(self, session_name: str) -> list[str]:
        agents_str = self.tmux_env(session_name, "AGENT_WINDOW_AGENTS")
        if agents_str and agents_str != "-":
            return [item.strip() for item in agents_str.split(",") if item.strip()]
        active: list[str] = []
        for agent in self.all_agents:
            if self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{agent.upper()}"):
                active.append(agent)
        return active

    def resolve_agent_name_target(self, session_name: str, requested: str) -> str:
        raw = str(requested or "").strip()
        lowered = raw.lower()
        if not lowered:
            raise AgentSendError("Agent target is required.")

        available = self.active_agent_instances(session_name)
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
        reserved.update(agent.casefold() for agent in self.active_agent_instances(session_name))
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
        names = self.agent_names(session_name)

        def queue(agent_name: str, pane_id: str) -> None:
            if not agent_name or not pane_id:
                return
            panes_by_target[agent_name] = pane_id

        for raw_target in [item.strip() for item in (target_spec or "").split(",") if item.strip()]:
            resolved_name = self.resolve_agent_name(raw_target)
            if resolved_name and resolved_name != "user":
                base_name = agent_base_name(resolved_name)
                if re.search(r"-\d+$", resolved_name):
                    upper = resolved_name.upper().replace("-", "_")
                    pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{upper}")
                    if not pane:
                        raise AgentSendError(f"Target pane not found: {resolved_name}")
                    queue(resolved_name, pane)
                    continue

                agents_str = self.tmux_env(session_name, "AGENT_WINDOW_AGENTS")
                found = False
                if agents_str:
                    for instance in [x.strip() for x in agents_str.split(",") if x.strip()]:
                        if instance == base_name or instance.startswith(f"{base_name}-"):
                            pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{instance.upper().replace('-', '_')}")
                            if pane:
                                queue(instance, pane)
                                found = True
                if not found:
                    pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{base_name.upper()}")
                    if pane:
                        queue(base_name, pane)
                        found = True
                if not found:
                    raise AgentSendError(f"Target pane not found: {raw_target}")
                continue

            alias_matches = [
                canonical
                for canonical, display in names.items()
                if display.casefold() == raw_target.casefold()
            ]
            if len(alias_matches) == 1:
                canonical = alias_matches[0]
                pane = self.resolve_pane(
                    session_name,
                    f"AGENT_WINDOW_PANE_{canonical.upper().replace('-', '_')}",
                )
                if not pane:
                    raise AgentSendError(f"Target pane not found: {raw_target}")
                queue(canonical, pane)
                continue
            if len(alias_matches) > 1:
                raise AgentSendError(f'Agent name is ambiguous: "{raw_target}"')

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
                agents_str = self.tmux_env(session_name, "AGENT_WINDOW_AGENTS")
                if agents_str:
                    for instance in [x.strip() for x in agents_str.split(",") if x.strip()]:
                        if sender_role != "user" and instance == sender_role:
                            continue
                        pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{instance.upper().replace('-', '_')}")
                        if pane:
                            queue(instance, pane)
                else:
                    for agent in self.all_agents:
                        if sender_role != "user" and agent == sender_role:
                            continue
                        pane = self.resolve_pane(session_name, f"AGENT_WINDOW_PANE_{agent.upper()}")
                        if pane:
                            queue(agent, pane)
                continue

            raise AgentSendError(f"Unknown target: {raw_target}")

        for name, pane in panes_by_target.items():
            targets.append(DeliveryTarget(agent_name=name, pane_id=pane))
        return targets

    def _mark_agent_running(self, session_name: str, agent_name: str) -> bool:
        name = str(agent_name or "").strip()
        if not session_name or not name:
            return False
        base = agent_base_name(name)
        if base not in self.all_agents:
            return False
        upper = name.upper().replace("-", "_")
        target = self.resolve_tmux_session_name()
        if not target:
            print(f"Failed to mark {name} running: tmux session could not be resolved", file=sys.stderr)
            return False
        result = self.tmux.run(["set-environment", "-t", target, f"AGENT_WINDOW_RUNNING_{upper}", "1"])
        if result.returncode != 0:
            detail = (result.stderr or result.stdout or "").strip()
            print(f"Failed to mark {name} running: {detail or 'tmux set-environment failed'}", file=sys.stderr)
            return False
        return True

    def send_to_pane(
        self,
        pane_id: str,
        payload: str,
        agent_name: str = "",
        *,
        session_name: str = "",
    ) -> bool:
        if not pane_id:
            return False
        if self.tmux.run(["send-keys", "-t", pane_id, "-l", "--", payload]).returncode != 0:
            return False
        time.sleep(delivery_paste_delay_seconds(env=self.env))
        if self.tmux.run(["send-keys", "-t", pane_id, "", "Enter"]).returncode != 0:
            return False
        return True

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
        sender_role = self.current_pane_role(session_name) or self.env.get("AGENT_WINDOW_AGENT_NAME") or "user"
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
            if self.send_to_pane(
                target.pane_id,
                delivery_payload,
                target.agent_name,
                session_name=session_name,
            ):
                self._mark_agent_running(session_name, target.agent_name)
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

        target_names = ", ".join(successful_targets)
        display = delivery_payload if len(delivery_payload) <= 200 else delivery_payload[:200] + "..."
        print(f"The following was sent to {target_names}:\n{display}")

        return not failed_any
