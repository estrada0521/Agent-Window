# External access

Files for using Agent Window from **outside the LAN**.

LAN use (Hub, the mobile PWA, mkcert) is documented in the repository README. This directory is not that. It is the place for off-LAN reachability.

Two paths are in use:

## Tailscale

Configured outside this repository. Once the Mac is on the tailnet, Hub is reached as a Tailscale host. There is no Tailscale code here.

## Cloudflare Access

A named Cloudflare tunnel in front of Hub, with Cloudflare Access in front of the hostname.

- `cloudflare` — named tunnel, Access, and LaunchAgent
- `public_edge.py` — loopback HTTP edge that Cloudflare `cloudflared` forwards to

Entry point from the repository root:

```bash
./bin/agent-window-cloudflare
```
