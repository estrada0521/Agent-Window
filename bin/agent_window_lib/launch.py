from __future__ import annotations

def _q(value: str) -> str:
    import shlex

    return shlex.quote(str(value))


def build_agent_launch_command(
    *,
    executable: str,
    launch_extra: str = "",
    launch_flags: str = "",
    launch_env: str = "",
) -> str:
    cmd_parts = ""
    if launch_env:
        cmd_parts = f"{cmd_parts}{launch_env} "
    cmd_parts = f"{cmd_parts}exec"
    if launch_extra:
        cmd_parts = f"{cmd_parts} {launch_extra}"
    cmd_parts = f"{cmd_parts} {_q(executable)}"
    if launch_flags:
        cmd_parts = f"{cmd_parts} {launch_flags}"
    return cmd_parts
