from dataclasses import dataclass

@dataclass(frozen=True)
class PaneBindingRequest:
    agent: str
    pane_id: str
    pane_pid: str


@dataclass(frozen=True)
class NativeLogBinding:
    agent: str
    path: str


def binding_for_path(
    *,
    agent: str,
    path: str,
) -> NativeLogBinding | None:
    resolved = str(path or "").strip()
    if not resolved:
        return None
    return NativeLogBinding(agent=agent, path=resolved)
