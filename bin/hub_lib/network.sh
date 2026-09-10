#!/usr/bin/env bash

set -euo pipefail

if [[ -n "${HUB_LIB_NETWORK_SH:-}" ]]; then
  return 0
fi
HUB_LIB_NETWORK_SH=1

detect_local_ip() {
  python3 - <<'PYEOF'
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
try:
    sock.connect(("8.8.8.8", 80))
    print(sock.getsockname()[0])
except OSError:
    pass
finally:
    sock.close()
PYEOF
}

port_serves_expected_url() {
  local scheme="$1"
  local port="$2"
  local path="$3"
  python3 - "$scheme" "$port" "$path" <<'PYEOF'
import http.client
import ssl
import sys

scheme = sys.argv[1]
port = int(sys.argv[2])
path = sys.argv[3]

try:
    if scheme == "https":
        conn = http.client.HTTPSConnection(
            "127.0.0.1",
            port,
            timeout=1.0,
            context=ssl._create_unverified_context(),
        )
    else:
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
  local scheme="$1"
  local port="$2"
  local path="$3"
  local timeout_sec="${4:-6}"
  python3 - "$scheme" "$port" "$path" "$timeout_sec" <<'PYEOF'
import http.client
import ssl
import sys
import time

scheme = sys.argv[1]
port = int(sys.argv[2])
path = sys.argv[3]
timeout_sec = float(sys.argv[4])
deadline = time.monotonic() + timeout_sec

while time.monotonic() < deadline:
    try:
        if scheme == "https":
            conn = http.client.HTTPSConnection(
                "127.0.0.1",
                port,
                timeout=1.0,
                context=ssl._create_unverified_context(),
            )
        elif scheme == "http":
            conn = http.client.HTTPConnection("127.0.0.1", port, timeout=1.0)
        else:
            sys.exit(1)
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
