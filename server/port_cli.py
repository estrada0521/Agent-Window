from __future__ import annotations

import sys

from backend_core.access.settings import default_chat_port


def main(argv: list[str] | None = None) -> None:
    argv = list(sys.argv[1:] if argv is None else argv)
    if len(argv) != 1:
        raise SystemExit("usage: python -m server.port_cli <session_name>")
    session_name = argv[0] or "default"
    print(default_chat_port(session_name))


if __name__ == "__main__":
    main()
