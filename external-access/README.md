# External access

Hub binds to loopback HTTP. A phone reaches it through Tailscale, which supplies the HTTPS the mobile PWA needs. There is no Tailscale code here.

This directory is the other off-LAN path: Cloudflare Access.

## Tailscale

Configured outside this repository. Once the Mac is on the tailnet, Hub is reached as a Tailscale host.

## Cloudflare Access

A named Cloudflare tunnel in front of Hub, with Cloudflare Access in front of the hostname.

- `cloudflare` — named tunnel, Access, and LaunchAgent
- `public_edge.py` — loopback HTTP edge that Cloudflare `cloudflared` forwards to

Entry point from the repository root:

```bash
./bin/agent-window-cloudflare
```
