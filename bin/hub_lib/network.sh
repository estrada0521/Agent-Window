#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_NETWORK_SH:-}" ]]; then
  return 0
fi
HUB_LIB_NETWORK_SH=1

hub_is_up() {
  local timeout_sec="${1:-0}"
  PYTHONPATH="$HUB_PYTHONPATH" python3 - "$HUB_PORT" "$timeout_sec" <<'PYEOF'
import http.client
import json
import sys
import time

from server.branding import APP_DISPLAY_NAME

port = int(sys.argv[1])
deadline = time.monotonic() + float(sys.argv[2])
while True:
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
        conn.request("GET", "/hub.webmanifest")
        resp = conn.getresponse()
        if resp.status == 200 and json.loads(resp.read())["name"] == APP_DISPLAY_NAME:
            sys.exit(0)
    except (OSError, ValueError, KeyError, http.client.HTTPException):
        pass
    if time.monotonic() >= deadline:
        sys.exit(1)
    time.sleep(0.1)
PYEOF
}

port_has_listener() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}
