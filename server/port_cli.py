from __future__ import annotations

import sys

from backend_core.access.settings import workspace_chat_port


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit("usage: python -m server.port_cli <workspace>")
    workspace = str(argv[0] or "").strip()
    if not workspace:
        raise SystemExit("usage: python -m server.port_cli <workspace>")
    print(workspace_chat_port(workspace))


if __name__ == "__main__":
    main()
