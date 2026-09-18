#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_NETWORK_SH:-}" ]]; then
  return 0
fi
HUB_LIB_NETWORK_SH=1

port_serves_expected_url() {
  local port="$1"
  local path="$2"
  python3 - "$port" "$path" <<'PYEOF'
import http.client
import sys

port = int(sys.argv[1])
path = sys.argv[2]

try:
    conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
    conn.request("GET", path, headers={"Host": f"127.0.0.1:{port}"})
    resp = conn.getresponse()
    resp.read(1)
    conn.close()
    if 200 <= resp.status < 500:
        sys.exit(0)
except Exception:
    pass
sys.exit(1)
PYEOF
}

wait_for_expected_url() {
  local port="$1"
  local path="$2"
  local timeout_sec="${3:-6}"
  python3 - "$port" "$path" "$timeout_sec" <<'PYEOF'
import http.client
import sys
import time

port = int(sys.argv[1])
path = sys.argv[2]
timeout_sec = float(sys.argv[3])
deadline = time.monotonic() + timeout_sec

while time.monotonic() < deadline:
    try:
        conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
        conn.request("GET", path, headers={"Host": f"127.0.0.1:{port}"})
        resp = conn.getresponse()
        resp.read(1)
        conn.close()
        if 200 <= resp.status < 500:
            sys.exit(0)
    except Exception:
        pass
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        break
    time.sleep(min(0.1, remaining))
sys.exit(1)
PYEOF
}

port_has_listener() {
  local port="$1"
  lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1
}
